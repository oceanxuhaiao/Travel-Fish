import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {mkdtempSync,readFileSync,readdirSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {ToolCallContext} from 'cortico/core/types.ts';
import {TravelService,TravelStore,type Artifact} from '../src/travel.ts';
import {PostcardRecords} from '../src/records.ts';
import {MailboxStore} from '../src/mailbox.ts';
import {PostcardWorld} from '../src/world.ts';
import {POSTCARD_DEFAULTS} from '../src/config.ts';
import {FakeHost} from './helpers/fake-host.ts';

let root:string,service:TravelService,records:PostcardRecords,now:number;
const artifact:Artifact={image:Buffer.from('89504e470d0a1a0a00000000','hex'),title:'灯塔旁的书店',note:'我在书店躲雨，买到一张旧照片，留着下次给你看。',generation:{prompt:'不应当出现在事实回执中的生成提示',reference:'/private/reference.png'}};
function files(folder:string):Record<string,string>{
  return Object.fromEntries(readdirSync(folder,{withFileTypes:true}).flatMap(entry=>{
    const path=join(folder,entry.name);
    return entry.isDirectory()?Object.entries(files(path)):[[path,createHash('sha256').update(readFileSync(path)).digest('hex')]];
  }));
}
function add(value:Artifact=artifact){const trip=service.start('forest',1);service.cancel(trip.id);return service.store.commit(trip,value,++now);}
beforeEach(()=>{root=mkdtempSync(join(tmpdir(),'postcard-records-'));now=100;service=new TravelService(new TravelStore(root),undefined,()=>now);service.open();records=new PostcardRecords(service.store);});
afterEach(async()=>{await service.close();rmSync(root,{recursive:true,force:true});});

it('只检索入藏原文，空结果不以场景、提示词或近义推断补齐',()=>{
  const card=add();service.start('snow',120);
  expect(records.search({query:'书店 旧照片'}).cards.map(c=>c.tripId)).toEqual([card.tripId]);
  expect(records.search({query:'森林'}).cards).toEqual([]);
  expect(records.search({query:'不应当'}).cards).toEqual([]);
  expect(records.search({query:'下雪'}).cards).toEqual([]);
  expect(records.search({query:'海边'}).total).toBe(0);
});

it('原文证据与来源哈希可核对，读信不暴露生成参数或参考路径',()=>{
  const card=add(),result=records.search({query:'旧照片'}).cards[0],detail=records.read(card.tripId);
  expect(artifact.note.slice(result.evidence.start,result.evidence.end)).toBe(result.evidence.quote);
  expect(result.source.recordSha256).toBe(createHash('sha256').update(readFileSync(join(root,'collection',card.tripId,'record.json'))).digest('hex'));
  expect(result.source.textSha256).toBe(createHash('sha256').update(JSON.stringify({title:artifact.title,note:artifact.note})).digest('hex'));
  expect(detail.note).toBe(artifact.note);expect(detail.source.imageSha256).toBe(card.sha256);
  expect(JSON.stringify(detail)).not.toContain('/private/');expect(detail).not.toHaveProperty('generation');
});

it('超过一百张收藏可分页，摘要有界且无匹配不随机推荐',()=>{
  for(let i=0;i<105;i++)add({...artifact,title:`旧照片 ${i}`,note:'长短笺'.repeat(150)});
  const page=records.search({query:'旧照片',limit:10}),next=records.search({query:'旧照片',limit:10,offset:page.nextOffset!});
  expect(page.total).toBe(105);expect(page.cards).toHaveLength(10);expect(page.nextOffset).toBe(10);
  expect(next.cards.some(c=>page.cards.some(p=>p.tripId===c.tripId))).toBe(false);
  expect(page.cards.every(c=>c.evidence.quote.length<=240)).toBe(true);
  expect(records.search({offset:1000}).nextOffset).toBeNull();
  expect(records.search({query:'完全无关'}).cards).toEqual([]);
});

it('显式开发标记默认排除，明确查询演示仍可读且带标签',()=>{
  const normal=add(),fixture=add({...artifact,title:'开发验证：旧照片'});
  const marked=add({...artifact,generation:{fixture:true}});
  expect(records.search().cards.map(c=>c.tripId)).toEqual([normal.tripId]);
  expect(records.search({includeDevelopment:true}).total).toBe(3);
  expect(records.read(fixture.tripId).source.kind).toBe('development_fixture');
  expect(records.read(marked.tripId).source.kind).toBe('development_fixture');
});

it('查询和读取不改收藏、未读、状态或通知，重建服务后来源一致',async()=>{
  const mailbox=new MailboxStore(service,()=>now);mailbox.open();const card=add();mailbox.snapshot();
  const before=files(root),source=records.read(card.tripId).source;
  for(let i=0;i<10;i++){records.search({query:'书店'});records.read(card.tripId);}
  expect(files(root)).toEqual(before);expect(mailbox.snapshot().unreadCount).toBe(1);
  expect(service.pendingNotifications()).toHaveLength(1);
  await service.close();service=new TravelService(new TravelStore(root),undefined,()=>now);service.open();
  expect(new PostcardRecords(service.store).read(card.tripId).source).toEqual(source);
});

it('图片损坏拒绝提供事实；原文更新后返回当前证据及新哈希',()=>{
  const card=add(),before=records.read(card.tripId),path=join(root,'collection',card.tripId,'record.json');
  const record=JSON.parse(readFileSync(path,'utf8'));record.note='我在窗边读书。';writeFileSync(path,JSON.stringify(record));
  expect(records.search({query:'旧照片'}).total).toBe(0);
  expect(records.read(card.tripId).source.recordSha256).not.toBe(before.source.recordSha256);
  writeFileSync(join(root,'collection',card.tripId,'postcard.png'),'broken');
  expect(()=>records.search()).toThrow('校验');expect(()=>records.read(card.tripId)).toThrow('校验');
});

it('边界参数无效时拒绝，空收藏返回空页，伪造编号不能读取任意文件',()=>{
  expect(records.search().cards).toEqual([]);
  for(const options of [{limit:11},{limit:0},{offset:-1},{query:'a'.repeat(121)},{includeDevelopment:'yes'}])expect(()=>records.search(options as any)).toThrow();
  expect(()=>records.read('../../state.json')).toThrow('编号');
});

it('实际World工具在生图关闭时仍可查旧卡，查询零生成且不标已读',async()=>{
  await service.close();const generator=vi.fn(async()=>artifact),world=new PostcardWorld({cfg:{...POSTCARD_DEFAULTS,cloudEnabled:false,mailboxEnabled:false,proactiveEnabled:false},dataDir:root,generator}),host=new FakeHost();
  await world.start(host);
  try{
    const trip=world.service.start('forest',1);world.service.cancel(trip.id);world.service.store.commit(trip,artifact,now);
    world.mailbox.snapshot();const before=files(join(root,'postcard'));
    const tool=(name:string)=>world.tools().find(t=>t.name===name)!;
    const result=JSON.parse(await tool('postcard_records').handler({query:'旧照片'},{} as ToolCallContext) as string);
    const detail=JSON.parse(await tool('postcard_read').handler({tripId:trip.id},{} as ToolCallContext) as string);
    expect(result.cards[0].tripId).toBe(trip.id);expect(detail.note).toBe(artifact.note);
    expect(detail.narrativeContext).toContain('用户是收信人');expect(files(join(root,'postcard'))).toEqual(before);
    expect(world.mailbox.snapshot().unreadCount).toBe(1);expect(generator).not.toHaveBeenCalled();
  }finally{await world.stop();}
});
