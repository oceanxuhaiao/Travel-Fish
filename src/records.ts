import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Card, TravelStore } from './travel.ts';

export interface RecordsQuery {
  query?: string;
  limit?: number;
  offset?: number;
  includeDevelopment?: boolean;
}

export const RECORD_EVIDENCE_BOUNDARY = '标题与短笺是已保存的虚拟旅行文字记录，不证明画面中的全部细节或真实到访。匹配只表示原文含有检索词，不是语义判断。生成提示词和内部场景类别不是成图事实；用户没有同行，点击和查询不证明喜欢、已读或共同回忆。';

/** Reads collection evidence without creating an index, marking mail read or changing trips. */
export class PostcardRecords {
  constructor(private store: TravelStore) {}

  private development(card: Card): boolean {
    return card.generation?.fixture === true || card.generation?.developmentFixture === true
      || /^(?:开发验证|开发数据|隔离验证|演示卡|测试成品|测试样张)/u.test(card.title.trim())
      || /^(?:开发验证|开发数据|隔离验证|演示卡|测试成品|测试样张)/u.test(card.note.trim());
  }

  private source(card: Card) {
    const relative = `postcard/collection/${card.tripId}`;
    return {
      kind: this.development(card) ? 'development_fixture' : 'saved_virtual_trip',
      record: `${relative}/record.json`,
      recordSha256: createHash('sha256').update(readFileSync(join(this.store.collection, card.tripId, 'record.json'))).digest('hex'),
      image: `${relative}/postcard.png`,
      imageSha256: card.sha256,
      textSha256: createHash('sha256').update(JSON.stringify({title:card.title,note:card.note})).digest('hex'),
      collectedAt: card.completedAt,
    };
  }

  read(tripId: string) {
    const card = this.store.card(tripId);
    if (!card) throw new Error('没有这份已完成收藏');
    return {tripId:card.tripId, scene:card.scene, ...(card.sceneLabel ? {sceneLabel:card.sceneLabel} : {}),
      title:card.title, note:card.note, completedAt:card.completedAt, sha256:card.sha256,
      source:this.source(card), evidenceBoundary:RECORD_EVIDENCE_BOUNDARY};
  }

  search(options: RecordsQuery = {}) {
    const {query = '', limit = 5, offset = 0, includeDevelopment = false} = options;
    if (typeof query !== 'string' || query.length > 120) throw new Error('检索词须为不超过120字的文字');
    if (!Number.isInteger(limit) || limit < 1 || limit > 10) throw new Error('每页数量须为1到10');
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('分页位置须为非负整数');
    if (typeof includeDevelopment !== 'boolean') throw new Error('演示记录选项须为布尔值');
    const terms = [...new Set(query.trim().toLocaleLowerCase().split(/\s+/u).filter(Boolean))];
    const matches = this.store.cards().filter(card => {
      if (!includeDevelopment && this.development(card)) return false;
      const text = `${card.title}\n${card.note}`.toLocaleLowerCase();
      return terms.every(term => text.includes(term));
    }).sort((a,b) => b.completedAt-a.completedAt || a.tripId.localeCompare(b.tripId));
    const cards = matches.slice(offset, offset + limit).map(candidate => {
      const card = this.store.card(candidate.tripId)!;
      const firstMatch = terms.length ? card.note.toLocaleLowerCase().indexOf(terms[0]) : -1;
      const start = Math.max(0, firstMatch - 50);
      const end = Math.min(card.note.length, start + 240);
      return {tripId:card.tripId,title:card.title.slice(0,160),titleTruncated:card.title.length>160,
        completedAt:card.completedAt, source:this.source(card),
        evidence:{field:'note',quote:card.note.slice(start,end),start,end},
        matchedTerms:terms};
    });
    return {query,matchMode:'literal_all_terms',total:matches.length,offset,limit,
      nextOffset:offset+cards.length<matches.length ? offset+cards.length : null,
      cards,evidenceBoundary:RECORD_EVIDENCE_BOUNDARY};
  }
}
