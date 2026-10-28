import {it,expect,beforeEach,afterEach,vi} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {TravelService,TravelStore} from '../src/travel.ts';
import {MailboxStore} from '../src/mailbox.ts';
import {PickupQueue} from '../src/pickup.ts';
import {PostcardWorld} from '../src/world.ts';
import {POSTCARD_DEFAULTS} from '../src/config.ts';
import {FakeHost} from './helpers/fake-host.ts';
let root:string,now:number,service:TravelService,mail:MailboxStore,queue:PickupQueue,placement:{to:number}|null;
const artifact={image:Buffer.from('89504e470d0a1a0a00000000','hex'),title:'取信验证',note:'已经保存的来信'};
beforeEach(()=>{root=mkdtempSync(join(tmpdir(),'postcard-pickup-'));now=100;placement={to:.66};service=new TravelService(new TravelStore(root),async()=>artifact,()=>now,true);service.open();mail=new MailboxStore(service,()=>now);mail.open();queue=new PickupQueue(root,()=>mail.snapshot(),()=>placement,()=>now);queue.open();});
afterEach(async()=>{await service.close();rmSync(root,{recursive:true,force:true});});
async function complete(){const t=service.start('surprise',120);now=t.dueAt;await service.tick();return t;}
it('预制不触发取信，到期入藏后才派发，重复通知只有一个请求',async()=>{
 const t=service.start('surprise',120);await service.tick();expect(queue.offer()).toBeNull();now=t.dueAt;await service.tick();const req=queue.offer()!;
 expect(queue.offer()?.requestId).toBe(req.requestId);expect(req.tripId).toBe(t.id);expect(service.store.cards()).toHaveLength(1);
});
it('必须先approach，再arrived；重复到达不重启演出，演出后仍未读',async()=>{
 const t=await complete(),req=queue.offer()!;expect(()=>queue.step(req.requestId,'arrived')).toThrow('先取得');
 expect(queue.step(req.requestId,'approach')).toMatchObject({to:.66});expect(queue.step(req.requestId,'arrived')).toMatchObject({accepted:true,spatiallyVerified:false});
 const start=queue.snapshot().active!.startedAt;now+=100;expect(queue.step(req.requestId,'arrived')).toMatchObject({duplicate:true});expect(queue.snapshot().active!.startedAt).toBe(start);
 queue.finish(req.requestId,t.id);expect(queue.snapshot().pending).toEqual([]);expect(mail.snapshot().unreadCount).toBe(1);expect(queue.offer()).toBeNull();expect(()=>queue.finish(req.requestId,t.id)).toThrow('失效');expect(queue.offer(true,t.id)?.requestId).not.toBe(req.requestId);
});
it('忙碌defer不自动重复催促，用户手动重试获得新编号，旧编号拒绝',async()=>{
 await complete();const first=queue.offer()!;queue.step(first.requestId,'defer');expect(queue.offer()).toBeNull();const next=queue.offer(true)!;expect(next.requestId).not.toBe(first.requestId);expect(()=>queue.step(first.requestId,'approach')).toThrow('过期');
});
it('超时请求不再演出或误领下一趟，收藏与未读不受影响',async()=>{
 const t=await complete(),first=queue.offer()!;now=first.expiresAt+1;expect(()=>queue.step(first.requestId,'approach')).toThrow('过期');expect(queue.offer()).toBeNull();
 const next=await complete();queue.offer(true,next.id);expect(()=>queue.finish(first.requestId,t.id)).toThrow('失效');expect(service.store.cards()).toHaveLength(2);expect(mail.snapshot().unreadCount).toBe(2);
});
it('邮箱关闭或位置变化停止演出，旧到达无效；重开后可手动补演',async()=>{
 await complete();const first=queue.offer()!;queue.step(first.requestId,'approach');placement=null;expect(()=>queue.step(first.requestId,'arrived')).toThrow('关闭');expect(queue.snapshot().active).toBeNull();
 placement={to:.5};const next=queue.offer(true)!;queue.step(next.requestId,'approach');placement={to:.8};expect(()=>queue.step(next.requestId,'arrived')).toThrow('位置');expect(mail.snapshot().unreadCount).toBe(1);
});
it('重启撤销approaching/presenting租约，不重演，不重画，待手动补演',async()=>{
 await complete();const old=queue.offer()!;queue.step(old.requestId,'approach');queue.step(old.requestId,'arrived');queue=new PickupQueue(root,()=>mail.snapshot(),()=>placement,()=>now);queue.open();expect(queue.snapshot().active).toBeNull();expect(queue.offer()).toBeNull();expect(queue.offer(true)?.requestId).not.toBe(old.requestId);expect(service.store.cards()).toHaveLength(1);
});
it('用户直接读信后迟到回执失效；取消旅程无取信任务',async()=>{
 const t=await complete(),req=queue.offer()!;queue.step(req.requestId,'approach');mail.markRead(t.id);expect(()=>queue.step(req.requestId,'arrived')).toThrow('过期');
 const cancelled=service.start('surprise',120);service.cancel(cancelled.id);expect(queue.offer()).toBeNull();
});
it('未就绪或关闭窗口不派发，已有历史收藏不自动演出',async()=>{
 await complete();placement=null;expect(queue.offer()).toBeNull();placement={to:.66};
 rmSync(join(root,'pickup.json'));queue=new PickupQueue(root,()=>mail.snapshot(),()=>placement,()=>now);queue.open();expect(queue.offer()).toBeNull();
});
it('到期空闲也不自动取信；点击后忙碌等待，空闲仅发送一次',async()=>{
 const world=new PostcardWorld({cfg:{...POSTCARD_DEFAULTS,mailboxEnabled:false},dataDir:join(root,'world'),now:()=>now,generator:async()=>artifact}),host=new FakeHost();
 await world.start(host);try{
  vi.spyOn(world.mailboxWindow,'placement').mockReturnValue({to:.66,screenWidth:1920});
  const t=world.service.start('surprise',120);now=t.dueAt;await world.pulse();
  world.onRunPhase({state:'idle',running:[],enteredAt:''});await world.pickupPulse();expect(host.events.filter(e=>e.type==='postcard.pickup_due')).toHaveLength(0);expect(world.pickup.snapshot().active).toBeNull();
  world.pickup.offer(true,t.id);world.onRunPhase({state:'model',running:[],enteredAt:''});await world.pickupPulse();expect(host.events.filter(e=>e.type==='postcard.pickup_due')).toHaveLength(0);
  world.onRunPhase({state:'idle',running:[],enteredAt:''});await world.pickupPulse();await world.pickupPulse();expect(host.events.filter(e=>e.type==='postcard.pickup_due')).toHaveLength(1);
 }finally{await world.stop();}
});
it('取信事件投递失败不自动重发或重画，用户仍可读已保存来信',async()=>{
 const generator=vi.fn(async()=>artifact),world=new PostcardWorld({cfg:{...POSTCARD_DEFAULTS,mailboxEnabled:false},dataDir:join(root,'world'),now:()=>now,generator}),host=new FakeHost();
 await world.start(host);try{
  vi.spyOn(world.mailboxWindow,'placement').mockReturnValue({to:.66,screenWidth:1920});const t=world.service.start('surprise',120);now=t.dueAt;await world.pulse();world.pickup.offer(true,t.id);world.onRunPhase({state:'idle',running:[],enteredAt:''});
  const original=host.pushEvent.bind(host);vi.spyOn(host,'pushEvent').mockImplementation(async(e,o)=>{if(e.type==='postcard.pickup_due')throw Error('offline');return original(e,o);});
  await expect(world.pickupPulse()).rejects.toThrow('未送达');await world.pickupPulse();expect(world.pickup.snapshot().active).toBeNull();expect(world.mailbox.snapshot().unreadCount).toBe(1);expect(generator).toHaveBeenCalledTimes(1);
 }finally{await world.stop();}
});

it('已读且演出完成的来信，用户点击仍可重新取信，不恢复未读或新增收藏',async()=>{
 const t=await complete(),first=queue.offer(true,t.id)!;queue.step(first.requestId,'approach');queue.step(first.requestId,'arrived');queue.finish(first.requestId,t.id);mail.markRead(t.id);
 expect(queue.offer()).toBeNull();const replay=queue.offer(true,t.id)!;expect(replay.replay).toBe(true);expect(queue.snapshot().active?.requestId).toBe(replay.requestId);queue.step(replay.requestId,'approach');queue.step(replay.requestId,'arrived');queue.finish(replay.requestId,t.id);expect(mail.snapshot().unreadCount).toBe(0);expect(service.store.cards()).toHaveLength(1);
});
