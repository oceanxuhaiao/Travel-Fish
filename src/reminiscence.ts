import {existsSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {atomicJson,type TravelStore} from './travel.ts';
import {isDevelopmentCard,type PostcardRecords} from './records.ts';

/**
 * Budget for unprompted recollection. A call that returns candidates counts as one offer even if
 * the host model decides not to speak: a wasted opportunity is cheaper than repeated nudging.
 */
export const RECALL_LIMITS = {perDay:1,gapHours:12,cardCooldownDays:7} as const;

/** Related words only widen the candidate set; they are never treated as card content. */
interface Concept {id:string;triggers:readonly string[];related:readonly string[];}
const CONCEPTS:readonly Concept[] = [
  {id:'rain',triggers:['雨','下雨','雨天','雨后'],related:['湿','水洼','积水','屋檐','潮']},
  {id:'sea',triggers:['海','海边','海滩','浪'],related:['潮','贝壳','礁石','沙滩','咸']},
  {id:'food',triggers:['吃','好吃','饿','饭','小吃','点心','汤'],related:['摊','碗','热气','甜','咸','一勺']},
  {id:'book',triggers:['书','书店','看书','翻书'],related:['书页','旧书','书架']},
  {id:'travel',triggers:['车','火车','列车','赶车','出发'],related:['站台','车厢','座位','班次']},
  {id:'night',triggers:['夜','晚上','天黑','夜里','傍晚'],related:['灯','路灯','暮色','昏暗','月亮']},
  {id:'cold',triggers:['冷','冬天','冻','起风'],related:['风','围巾','哈气']},
  {id:'flower',triggers:['花','花园','花田'],related:['花粉','篱笆','花瓣']},
];
const MAX_CONCEPTS = 2;
const QUOTE_LIMIT = 240;

export const RECALL_GUIDANCE = '只可引用 candidates[].evidence.quote 中的原文。match.kind=related 表示近义词或同组词命中，不是原文原句；只能说原文写了什么，不能把近义词当成卡片内容，也不能据此断定下雨、用户同行或真实到访。最多提一句，说完回到用户的话题。';

const RECALL_REASON = {
  disabled:'自然回忆已在设置中关闭；不要提起旧旅行',
  damaged:'回忆记录损坏，已暂停自然回忆；收藏和查卡仍可用',
  daily:'今天已经用掉一次回忆机会；不要提旧旅行，也不要向用户解释限额',
  gap:'距上次回忆还不到12小时；不要提旧旅行，也不要向用户解释限额',
  empty:'还没有可回忆的收藏；不要提旅行',
  none:'没有匹配的旧旅行；不要提旅行',
} as const;

interface CardUsage {offeredAt:number;mentionedAt?:number;dismissedAt?:number;}
interface State {schema:1;cards:Record<string,CardUsage>;day:{key:string;count:number;lastAt:number};}
interface RawCandidate {
  tripId:string;title:string;completedAt:number;note:string;lowerTitle:string;lowerNote:string;
  literal:string[];related:string[];
}

export interface RecallCandidate {
  tripId:string;title:string;titleTruncated:boolean;completedAt:number;
  match:{kind:'literal'|'related';terms:string[]};
  evidence:{field:'note'|'title';quote:string;start:number;end:number};
  source:ReturnType<PostcardRecords['read']>['source'];
}

const isId = (id:string) => /^[a-f0-9-]{36}$/.test(id);
const dayKey = (ms:number) => {const d=new Date(ms);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};

/** Suggests saved trips related to the current topic; never marks read, opens mail or writes Memory. */
export class Reminiscence {
  private state:State = {schema:1,cards:{},day:{key:'',count:0,lastAt:0}};
  private damaged = false;

  constructor(private root:string, private store:TravelStore, private records:PostcardRecords,
    private now:()=>number = Date.now, private enabled:()=>boolean = () => true) {}

  /** Reads the usage log. A damaged log disables recollection without touching the collection. */
  open(): boolean {
    const file = join(this.root,'reminiscence.json');
    if (!existsSync(file)) return true;
    try {
      const value = JSON.parse(readFileSync(file,'utf8')) as State;
      if (!value || value.schema !== 1 || !value.cards || typeof value.cards !== 'object' || Array.isArray(value.cards)
        || !value.day || typeof value.day.key !== 'string' || !Number.isInteger(value.day.count) || value.day.count < 0
        || !Number.isFinite(value.day.lastAt) || value.day.lastAt < 0) throw Error('回忆记录结构无效');
      for (const [id,usage] of Object.entries(value.cards)) {
        if (!isId(id) || !usage || !Number.isFinite(usage.offeredAt) || usage.offeredAt < 0
          || (usage.mentionedAt !== undefined && (!Number.isFinite(usage.mentionedAt) || usage.mentionedAt < 0))
          || (usage.dismissedAt !== undefined && (!Number.isFinite(usage.dismissedAt) || usage.dismissedAt < 0))) throw Error('回忆记录条目无效');
      }
      this.state = {schema:1,cards:value.cards,day:value.day};
      return true;
    } catch {
      this.damaged = true;
      return false;
    }
  }

  recall(rawQuery:string, rawLimit?:number) {
    const query = typeof rawQuery === 'string' ? rawQuery.trim() : '';
    if (!query || query.length > 60) throw Error('回忆关键词须为1到60字的文字');
    const limit = rawLimit ?? 2;
    if (!Number.isInteger(limit) || limit < 1 || limit > 2) throw Error('每次最多返回2条候选');
    const now = this.now();
    const gate = this.gate(now);
    if (!gate.ok) return {eligible:false,reason:gate.reason,candidates:[] as RecallCandidate[],limits:{...RECALL_LIMITS},guidance:RECALL_GUIDANCE};

    const terms = [...new Set(query.toLocaleLowerCase().split(/\s+/u).filter(Boolean))];
    const related = this.expand(query);
    const matches:RawCandidate[] = [];
    for (const card of this.store.cards()) {
      if (isDevelopmentCard(card)) continue;
      if (!this.cardAvailable(card.tripId,now)) continue;
      const lowerTitle = card.title.toLocaleLowerCase(), lowerNote = card.note.toLocaleLowerCase();
      const literal = terms.filter(term => lowerTitle.includes(term) || lowerNote.includes(term));
      const concept = related.filter(term => !literal.includes(term) && (lowerTitle.includes(term) || lowerNote.includes(term)));
      if (!literal.length && !concept.length) continue;
      matches.push({tripId:card.tripId,title:card.title,completedAt:card.completedAt,note:card.note,lowerTitle,lowerNote,literal,related:concept});
    }
    matches.sort((a,b) => (b.literal.length*100 + Math.min(b.related.length,5)*10) - (a.literal.length*100 + Math.min(a.related.length,5)*10)
      || b.completedAt - a.completedAt || a.tripId.localeCompare(b.tripId));
    const candidates = matches.slice(0,limit).map(candidate => this.candidate(candidate));
    if (!candidates.length) return {eligible:true,reason:RECALL_REASON.none,candidates,limits:{...RECALL_LIMITS},guidance:RECALL_GUIDANCE};
    this.recordOffer(candidates.map(candidate => candidate.tripId),now);
    return {eligible:true,candidates,limits:{...RECALL_LIMITS},guidance:RECALL_GUIDANCE};
  }

  /** Records what the host model actually did; it is not proof the user read, liked or remembered anything. */
  feedback(tripId:string,kind:'mentioned'|'dismissed') {
    if (this.damaged) throw Error('回忆记录损坏，暂不接受反馈；收藏和查卡不受影响');
    if (!isId(tripId) || !this.store.card(tripId)) throw Error('没有这份已完成收藏');
    if (kind !== 'mentioned' && kind !== 'dismissed') throw Error('反馈类型须为mentioned或dismissed');
    const now = this.now();
    const usage = this.state.cards[tripId] ?? {offeredAt:now};
    this.state.cards[tripId] = {...usage,...(kind === 'mentioned' ? {mentionedAt:now} : {dismissedAt:now})};
    this.save();
    return {tripId,kind,recordedAt:now,note:'只用于抑制重复提起，不表示用户已读、喜欢或共同回忆'};
  }

  private gate(now:number):{ok:true}|{ok:false;reason:string} {
    if (!this.enabled()) return {ok:false,reason:RECALL_REASON.disabled};
    if (this.damaged) return {ok:false,reason:RECALL_REASON.damaged};
    if (!this.store.cards().some(card => !isDevelopmentCard(card))) return {ok:false,reason:RECALL_REASON.empty};
    const key = dayKey(now);
    if (this.state.day.key === key && this.state.day.count >= RECALL_LIMITS.perDay) return {ok:false,reason:RECALL_REASON.daily};
    const last = this.lastOffer();
    if (last !== null && now - last < RECALL_LIMITS.gapHours*3600000) return {ok:false,reason:RECALL_REASON.gap};
    return {ok:true};
  }

  private lastOffer():number|null {
    const times = Object.values(this.state.cards).map(usage => Math.max(usage.offeredAt,usage.mentionedAt ?? 0,usage.dismissedAt ?? 0));
    times.push(this.state.day.lastAt);
    return times.length ? Math.max(...times) : null;
  }

  private cardAvailable(tripId:string,now:number):boolean {
    const usage = this.state.cards[tripId];
    if (!usage) return true;
    return now - Math.max(usage.offeredAt,usage.mentionedAt ?? 0) >= RECALL_LIMITS.cardCooldownDays*86400000;
  }

  private expand(query:string):string[] {
    const lower = query.toLocaleLowerCase();
    const concepts = CONCEPTS.filter(concept => concept.triggers.some(trigger => lower.includes(trigger.toLocaleLowerCase()))).slice(0,MAX_CONCEPTS);
    return [...new Set(concepts.flatMap(concept => [...concept.triggers,...concept.related]))];
  }

  private candidate(raw:RawCandidate):RecallCandidate {
    const terms = [...raw.literal,...raw.related];
    const term = terms[0];
    const noteAt = term ? raw.lowerNote.indexOf(term) : -1;
    if (noteAt >= 0) {
      const start = Math.max(0,noteAt-60),end = Math.min(raw.note.length,start+QUOTE_LIMIT);
      return {tripId:raw.tripId,title:raw.title.slice(0,160),titleTruncated:raw.title.length>160,completedAt:raw.completedAt,
        match:{kind:raw.literal.length ? 'literal' : 'related',terms},
        evidence:{field:'note',quote:raw.note.slice(start,end),start,end},
        source:this.records.read(raw.tripId).source};
    }
    const titleAt = term ? raw.lowerTitle.indexOf(term) : -1;
    const start = Math.max(0,titleAt);
    return {tripId:raw.tripId,title:raw.title.slice(0,160),titleTruncated:raw.title.length>160,completedAt:raw.completedAt,
      match:{kind:raw.literal.length ? 'literal' : 'related',terms},
      evidence:{field:'title',quote:raw.title.slice(start,start+QUOTE_LIMIT),start,end:Math.min(raw.title.length,start+QUOTE_LIMIT)},
      source:this.records.read(raw.tripId).source};
  }

  private recordOffer(tripIds:string[],now:number) {
    const key = dayKey(now);
    const day = this.state.day.key === key ? this.state.day : {key,count:0,lastAt:now};
    this.state.day = {key,count:day.count+1,lastAt:now};
    for (const tripId of tripIds) {
      this.state.cards[tripId] = {...(this.state.cards[tripId] ?? {offeredAt:now}),offeredAt:now};
    }
    this.save();
  }

  private save() {atomicJson(join(this.root,'reminiscence.json'),this.state);}
}
