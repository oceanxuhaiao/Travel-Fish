import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {mkdtempSync,readFileSync,readdirSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {ToolCallContext} from 'cortico/core/types.ts';
import {TravelService,TravelStore,type Artifact} from '../src/travel.ts';
import {PostcardRecords} from '../src/records.ts';
import {Reminiscence} from '../src/reminiscence.ts';
import {PostcardWorld} from '../src/world.ts';
import {POSTCARD_DEFAULTS} from '../src/config.ts';
import {FakeHost} from './helpers/fake-host.ts';

let root:string,service:TravelService,records:PostcardRecords,reminiscence:Reminiscence,now:number,enabled:boolean;
const png=Buffer.from('89504e470d0a1a0a00000000','hex');
function add(title:string,note:string,generation:Record<string,unknown>={}){
  const trip=service.start('forest',1);service.cancel(trip.id);
  return service.store.commit(trip,{image:png,title,note,generation} as Artifact,++now);
}
function files(folder:string):Record<string,string>{
  return Object.fromEntries(readdirSync(folder,{withFileTypes:true}).flatMap(entry=>{
    const path=join(folder,entry.name);
    return entry.isDirectory()?Object.entries(files(path)):[[path,createHash('sha256').update(readFileSync(path)).digest('hex')]];
  }));
}
function reopen(){reminiscence=new Reminiscence(root,service.store,records,()=>now,()=>enabled);return reminiscence.open();}
beforeEach(()=>{
  root=mkdtempSync(join(tmpdir(),'postcard-recall-'));now=Date.UTC(2026,9,31,2,0,0);enabled=true;
  service=new TravelService(new TravelStore(root),undefined,()=>now);service.open();
  records=new PostcardRecords(service.store);reminiscence=new Reminiscence(root,service.store,records,()=>now,()=>enabled);reminiscence.open();
});
afterEach(async()=>{await service.close();rmSync(root,{recursive:true,force:true});});

it('字面命中返回原文证据与来源哈希，可核对片段位置',()=>{
  const card=add('避雨的旧书店','我在书店躲雨，翻到一张旧照片，屋檐下滴着水。');
  const result=reminiscence.recall('旧照片');
  expect(result.eligible).toBe(true);
  const hit=result.candidates[0];
  expect(hit.tripId).toBe(card.tripId);expect(hit.match.kind).toBe('literal');
  expect(hit.evidence.field).toBe('note');
  expect(card.note.slice(hit.evidence.start,hit.evidence.end)).toBe(hit.evidence.quote);
  expect(hit.evidence.quote).toContain('旧照片');
  expect(hit.source.recordSha256).toBe(createHash('sha256').update(readFileSync(join(root,'collection',card.tripId,'record.json'))).digest('hex'));
  expect(JSON.stringify(hit)).not.toContain('/private/');
});

it('近义词只在有触发词时扩召回，并标明不是原文原句',()=>{
  add('潮声','傍晚的石板路湿漉漉的，风里有点咸味。');
  const related=reminiscence.recall('下雨');
  expect(related.candidates).toHaveLength(1);
  expect(related.candidates[0].match.kind).toBe('related');
  expect(related.candidates[0].match.terms).toContain('湿');
  expect(related.candidates[0].evidence.quote).toContain('湿');
  expect(related.guidance).toContain('不是原文原句');
});

it('无关话题返回空候选，且不消耗当天机会',()=>{
  add('避雨的旧书店','我在书店躲雨，翻到一张旧照片。');
  const miss=reminiscence.recall('编程');
  expect(miss.eligible).toBe(true);expect(miss.candidates).toEqual([]);expect(miss.reason).toContain('没有匹配');
  expect(reminiscence.recall('旧照片').candidates).toHaveLength(1);
});

it('开发标记卡默认不参与回忆，明确正常卡仍可召回',()=>{
  add('开发验证：避雨的书店','我在书店躲雨，翻到一张旧照片。',{fixture:true});
  const normal=add('避雨的旧书店','我在书店躲雨，翻到一张旧照片。');
  const result=reminiscence.recall('旧照片');
  expect(result.candidates.map(c=>c.tripId)).toEqual([normal.tripId]);
});

it('每天一次、同一天多次调用被拒，隔天可换另一张，重启不重置额度',()=>{
  const first=add('旧照片','一张旧照片夹在书里。');
  const second=add('旧照片之二','另一张旧照片压在抽屉底。');
  const one=reminiscence.recall('旧照片',1);
  expect(one.candidates[0].tripId).toBe(second.tripId);
  expect(reminiscence.recall('旧照片',1)).toMatchObject({eligible:false,candidates:[]});
  now+=13*3600000;
  expect(reminiscence.recall('旧照片',1).eligible).toBe(false);
  now+=24*3600000;
  const next=reminiscence.recall('旧照片',1);
  expect(next.eligible).toBe(true);expect(next.candidates[0].tripId).toBe(first.tripId);
  expect(reopen()).toBe(true);
  expect(reminiscence.recall('旧照片',1).eligible).toBe(false);
});

it('同一张七天内不重复，超过冷却可以再提',()=>{
  add('旧照片','一张旧照片夹在书里。');
  expect(reminiscence.recall('旧照片').candidates).toHaveLength(1);
  now+=6*86400000;
  const cooling=reminiscence.recall('旧照片');
  expect(cooling.eligible).toBe(true);expect(cooling.candidates).toEqual([]);
  now+=2*86400000;
  expect(reminiscence.recall('旧照片').candidates).toHaveLength(1);
});

it('关闭开关后不写日志也不给候选，明确查卡仍可用',()=>{
  const card=add('旧照片','一张旧照片夹在书里。');
  enabled=false;
  expect(reminiscence.recall('旧照片')).toMatchObject({eligible:false,candidates:[]});
  expect(()=>readFileSync(join(root,'reminiscence.json'))).toThrow();
  expect(records.search({query:'旧照片'}).cards[0].tripId).toBe(card.tripId);
});

it('回忆日志损坏只关闭自然回忆，收藏与查卡不受影响',()=>{
  const card=add('旧照片','一张旧照片夹在书里。');
  writeFileSync(join(root,'reminiscence.json'),'{"schema":1,"cards":');
  expect(reopen()).toBe(false);
  const result=reminiscence.recall('旧照片');
  expect(result).toMatchObject({eligible:false,candidates:[]});expect(result.reason).toContain('损坏');
  expect(records.search({query:'旧照片'}).cards[0].tripId).toBe(card.tripId);
  expect(()=>reminiscence.feedback(card.tripId,'mentioned')).toThrow('损坏');
});

it('关键词与数量边界无效时拒绝，伪造编号不接受反馈',()=>{
  add('旧照片','一张旧照片夹在书里。');
  expect(()=>reminiscence.recall('')).toThrow();expect(()=>reminiscence.recall('a'.repeat(61))).toThrow();
  expect(()=>reminiscence.recall('旧照片',3)).toThrow();
  expect(()=>reminiscence.feedback('../../state.json','mentioned')).toThrow('收藏');
  expect(()=>reminiscence.feedback('3c54fd68-9b1e-421e-a3fc-d291693540f6','mentioned')).toThrow('收藏');
});

it('实际World工具零生成、不改收藏与未读，反馈只抑制不当作已读',async()=>{
  await service.close();const generator=vi.fn(async()=>({image:png,title:'旧照片',note:'一张旧照片夹在书里。'}));
  const world=new PostcardWorld({cfg:{...POSTCARD_DEFAULTS,cloudEnabled:false,mailboxEnabled:false,proactiveEnabled:false},dataDir:root,generator,now:()=>now});
  const host=new FakeHost();await world.start(host);
  try{
    const trip=world.service.start('forest',1);world.service.cancel(trip.id);
    const card=world.service.store.commit(trip,{image:png,title:'旧照片',note:'一张旧照片夹在书里。'},now);
    world.mailbox.snapshot();const before=files(join(root,'postcard','collection'));
    const tool=(name:string)=>world.tools().find(t=>t.name===name)!;
    const recall=JSON.parse(await tool('postcard_recall').handler({query:'旧照片'},{} as ToolCallContext) as string);
    expect(recall.candidates[0].tripId).toBe(card.tripId);
    expect(files(join(root,'postcard','collection'))).toEqual(before);
    expect(world.mailbox.snapshot().unreadCount).toBe(1);expect(generator).not.toHaveBeenCalled();
    const feedback=JSON.parse(await tool('postcard_recall_feedback').handler({tripId:card.tripId,kind:'mentioned'},{} as ToolCallContext) as string);
    expect(feedback).toMatchObject({tripId:card.tripId,kind:'mentioned'});
    expect(world.mailbox.snapshot().unreadCount).toBe(1);
    now+=86400000;
    expect(JSON.parse(await tool('postcard_recall').handler({query:'旧照片'},{} as ToolCallContext) as string).candidates).toEqual([]);
  }finally{await world.stop();}
});
