import {it,expect,beforeEach,afterEach,vi} from 'vitest';
import {mkdtempSync,rmSync,mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {InvitationSchedule,invitationText,shouldRecap} from '../src/invitations.ts';
import {PostcardWorld} from '../src/world.ts';
import {POSTCARD_DEFAULTS} from '../src/config.ts';
import {FakeHost} from './helpers/fake-host.ts';
let root:string,now:number;
beforeEach(()=>{root=mkdtempSync(join(tmpdir(),'postcard-invites-'));now=0;});
afterEach(()=>rmSync(root,{recursive:true,force:true}));
it('首次等完整间隔，跨过多个周期只询问一次',async()=>{
 const s=new InvitationSchedule(root,()=>now),emit=vi.fn(async()=>{});s.open();await s.tick(true,1,true,emit);now=59999;await s.tick(true,1,true,emit);expect(emit).not.toHaveBeenCalled();
 now=600000;await s.tick(true,1,true,emit);await s.tick(true,1,true,emit);expect(emit).toHaveBeenCalledTimes(1);expect(s.snapshot()?.nextAt).toBe(660000);
});
it('重启保留时间，修改间隔/关闭再打开都重新计时',async()=>{
 let s=new InvitationSchedule(root,()=>now);s.open();const emit=vi.fn(async()=>{});await s.tick(true,1,true,emit);now=30000;
 s=new InvitationSchedule(root,()=>now);s.open();await s.tick(true,1,true,emit);expect(s.snapshot()?.nextAt).toBe(60000);
 await s.tick(true,2,true,emit);expect(s.snapshot()?.nextAt).toBe(150000);await s.tick(false,2,true,emit);now=900000;await s.tick(false,2,true,emit);expect(emit).not.toHaveBeenCalled();await s.tick(true,2,true,emit);expect(s.snapshot()?.nextAt).toBe(1020000);
});
it('旅行中/未连接服务不询问，恢复可用后等完整间隔',async()=>{
 const s=new InvitationSchedule(root,()=>now),emit=vi.fn(async()=>{});s.open();await s.tick(true,1,true,emit);now=50000;await s.tick(true,1,false,emit);now=600000;await s.tick(true,1,false,emit);expect(emit).not.toHaveBeenCalled();await s.tick(true,1,true,emit);expect(s.snapshot()?.nextAt).toBe(660000);now=660000;await s.tick(true,1,true,emit);expect(emit).toHaveBeenCalledTimes(1);
});
it('事件写入失败有限退避，不会每秒重试询问',async()=>{
 const s=new InvitationSchedule(root,()=>now),emit=vi.fn(async()=>{throw Error('transport failed');});s.open();await s.tick(true,1,true,emit);now=60000;await expect(s.tick(true,1,true,emit)).rejects.toThrow('transport');now=61000;await s.tick(true,1,true,emit);expect(emit).toHaveBeenCalledTimes(1);expect(s.snapshot()?.lastInvitedAt).toBeNull();
});
it('World只发询问事件，未同意绝不自行建旅程或调用生图',async()=>{
 const generate=vi.fn(async()=>({image:new Uint8Array(),title:'unused',note:'unused'}));const world=new PostcardWorld({cfg:{...POSTCARD_DEFAULTS,proactiveIntervalMinutes:1},dataDir:root,generator:generate,now:()=>now}),host=new FakeHost();await world.start(host);
 try{now=60000;await world.pulse();await world.pulse();const invites=host.events.filter(e=>e.type==='postcard.invitation_due');expect(invites).toHaveLength(1);expect(world.service.status()).toBeNull();expect(generate).not.toHaveBeenCalled();expect(world.invitations.snapshot()?.lastInvitedAt).toBe(60000);}finally{await world.stop();}
});

it('询问日程损坏时只暂停询问，旅行和收藏继续可用',async()=>{
 mkdirSync(join(root,'postcard'));writeFileSync(join(root,'postcard/invitations.json'),'{broken');
 const world=new PostcardWorld({cfg:POSTCARD_DEFAULTS,dataDir:root,now:()=>now}),host=new FakeHost();await world.start(host);
 try{await world.pulse();expect(world.service.store.cards()).toEqual([]);expect(world.service.start('surprise',1).status).toBe('traveling');expect(host.events.filter(e=>e.type==='postcard.invitation_due')).toHaveLength(0);}finally{await world.stop();}
});

it('邀请文本带上已寄回节点的标题与短笺摘录，不透露未来',()=>{
 expect(invitationText(30,null)).toContain('目前没有未结束旅行');
 const one=invitationText(30,{delivered:1,cards:[{title:'水洼里的白贝壳',note:'潮池水清，礁石上落着几枚白贝壳。'}]});
 expect(one).toContain('1/3');expect(one).toContain('《水洼里的白贝壳》');expect(one).toContain('潮池');
 expect(one).toContain('还差2段');expect(one).not.toContain('2/3');
 const two=invitationText(30,{delivered:2,cards:[{title:'雪把台阶铺成了糖',note:'雪巷里窗灯亮成一条线。'},{title:'水洼里的白贝壳',note:'潮池边落着白贝壳。'}]});
 expect(two).toContain('2/3');expect(two).toContain('还差1段');expect(two.indexOf('雪把台阶')).toBeLessThan(two.indexOf('水洼里'));
 const long=invitationText(30,{delivered:1,cards:[{title:'长信',note:'很长的原文。'.repeat(40)}]});
 expect(long).toContain('…');expect(long).toContain('很长的原文。'.repeat(19));expect(long).not.toContain('很长的原文。'.repeat(21));
});

it('只有新节点晚于上次邀请时才带回顾',()=>{
 expect(shouldRecap(null,1000)).toBe(true);
 expect(shouldRecap(2000,1000)).toBe(false);
 expect(shouldRecap(1000,1000)).toBe(false);
 expect(shouldRecap(1000,undefined)).toBe(false);
});

it('等待继续时第一次询问带一件具体见闻，下一次回到通用问法且不出发',async()=>{
 const generate=vi.fn(async()=>({image:new Uint8Array(),title:'unused',note:'unused'}));
 const world=new PostcardWorld({cfg:{...POSTCARD_DEFAULTS,proactiveIntervalMinutes:1},dataDir:root,generator:generate,now:()=>now}),host=new FakeHost();
 await world.start(host);
 try{
  const trip=world.service.startSeries();world.service.cancel(trip.id);
  world.service.store.commit(trip,{image:Buffer.from('89504e470d0a1a0a00000000','hex'),title:'水洼里的白贝壳',note:'潮池水清得能看见底，礁石上落着几枚白贝壳。'},1000);
  now=60000;await world.pulse();
  const invites=host.events.filter(e=>e.type==='postcard.invitation_due');
  expect(invites).toHaveLength(1);
  expect(invites[0].text).toContain('1/3');expect(invites[0].text).toContain('《水洼里的白贝壳》');expect(invites[0].text).toContain('潮池');
  now=660000;await world.pulse();
  const next=host.events.filter(e=>e.type==='postcard.invitation_due');
  expect(next).toHaveLength(2);
  expect(next[1].text).not.toContain('水洼里的白贝壳');
  expect(next[1].text).toContain('当前系列尚未完成');expect(next[1].text).not.toContain('目前没有未结束旅行');
  expect(world.service.status()?.status).toBe('cancelled');expect(generate).not.toHaveBeenCalled();
 }finally{await world.stop();}
});

it('邀请包装保留原文问号且不叠加句号，通用新程与续程状态分开',()=>{
 const note='我看见一角屋檐，你猜猜看？';const text=invitationText(30,{delivered:1,cards:[{title:'瓦檐',note}]});
 expect(text).toContain(note);expect(text).not.toContain('？。');expect(text).toContain('\n旅程还差2段');
 expect(invitationText(30,null,true)).toContain('尚未完成');expect(invitationText(30,null,false)).toContain('没有未结束旅行');
});

it('World第三轮邀请只含前两张已交付卡，重复不复述，完成后回新程邀请且不生成',async()=>{
 const generate=vi.fn(async()=>({image:new Uint8Array(),title:'unused',note:'unused'}));
 const world=new PostcardWorld({cfg:{...POSTCARD_DEFAULTS,proactiveIntervalMinutes:1},dataDir:root,generator:generate,now:()=>now}),host=new FakeHost();await world.start(host);
 const deliver=(title:string,at:number)=>{const t=world.service.startSeries();world.service.cancel(t.id);world.service.store.commit(t,{image:Buffer.from('89504e470d0a1a0a00000000','hex'),title,note:title+'，这是已交付的原文。'},at);};
 try{
  deliver('第一张屋檐',1000);now=60000;await world.pulse();
  deliver('第二张小路',65000);now=120000;await world.pulse();
  const events=()=>host.events.filter(e=>e.type==='postcard.invitation_due');
  expect(events()[1].text).toContain('2/3');expect(events()[1].text).toContain('第一张屋檐');expect(events()[1].text).toContain('第二张小路');expect(events()[1].text).toContain('还差1段');
  now=180000;await world.pulse();expect(events()[2].text).toContain('当前系列尚未完成');expect(events()[2].text).not.toContain('第二张小路');
  deliver('第三张终点',181000);now=240000;await world.pulse();
  expect(events()[3].text).toContain('目前没有未结束旅行');expect(events()[3].text).not.toContain('旅程还差');expect(generate).not.toHaveBeenCalled();expect(world.service.store.cards()).toHaveLength(3);
 }finally{await world.stop();}
});
