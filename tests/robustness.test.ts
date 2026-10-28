import {it,expect,vi} from 'vitest';
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {TravelService,TravelStore,type Status} from '../src/travel.ts';import {PostcardWorld} from '../src/world.ts';import {PickupQueue} from '../src/pickup.ts';import {POSTCARD_DEFAULTS} from '../src/config.ts';import {FakeHost} from './helpers/fake-host.ts';
const artifact={image:Buffer.from('89504e470d0a1a0a00000000','hex'),title:'鲁棒性验证',note:'隔离数据，不是真实生图'};
it.each(['traveling','generating','awaiting_service','failed'] as Status[])('%s期间100次再次出发全部拒绝，不生成第二趟或额外prepare',async(status)=>{
 const root=mkdtempSync(join(tmpdir(),'postcard-rb-start-'));const generator=Object.assign(vi.fn(async()=>artifact),{prepare:vi.fn(()=>({test:true}))});const service=new TravelService(new TravelStore(root),generator,()=>100,true);service.open();
 try{const trip=service.start('surprise',120),state=service.store.snapshot();state.trips[0].status=status;service.store.save(state);const results=await Promise.allSettled(Array.from({length:100},async()=>service.start('surprise',120)));expect(results.every(r=>r.status==='rejected')).toBe(true);expect(service.store.snapshot().trips).toHaveLength(1);expect(service.status()!.id).toBe(trip.id);expect(generator.prepare).toHaveBeenCalledTimes(1);expect(generator).not.toHaveBeenCalled();}finally{await service.close();rmSync(root,{recursive:true,force:true});}
});
it('旧生成忽略abort并迟到返回，取消后新旅行不被覆盖也不并发生成',async()=>{
 const root=mkdtempSync(join(tmpdir(),'postcard-rb-cancel-'));let release!:(a:typeof artifact)=>void;const generator=vi.fn().mockImplementationOnce(()=>new Promise(r=>{release=r;})).mockResolvedValue(artifact);const service=new TravelService(new TravelStore(root),generator,()=>100,true);service.open();
 try{const old=service.start('surprise',120);const flight=service.tick();service.cancel(old.id);const next=service.start('surprise',120);const duplicate=Array.from({length:100},()=>service.tick());expect(generator).toHaveBeenCalledTimes(1);release(artifact);await Promise.all([flight,...duplicate]);expect(service.store.card(old.id)).toBeNull();expect(service.status()!.id).toBe(next.id);await service.tick();expect(generator).toHaveBeenCalledTimes(2);expect(service.status()!.status).toBe('traveling');expect(service.store.stagedArtifact(next.id)).not.toBeNull();}finally{await service.close();rmSync(root,{recursive:true,force:true});}
});
async function fixture(run:(ctx:any)=>Promise<void>){const root=mkdtempSync(join(tmpdir(),'postcard-rb-click-'));let now=100;const generator=vi.fn(async()=>artifact),world=new PostcardWorld({cfg:{...POSTCARD_DEFAULTS,mailboxEnabled:false},dataDir:root,now:()=>now,generator}),host=new FakeHost();await world.start(host);
 try{vi.spyOn(world.mailboxWindow,'placement').mockReturnValue({to:.66,screenWidth:1920});const trip=world.service.start('surprise',120);now=trip.dueAt;await world.pulse();world.onRunPhase({state:'idle',running:[],enteredAt:''});await run({world,host,generator,root,trip,advance:(n:number)=>{now+=n;},now:()=>now});}finally{await world.stop();rmSync(root,{recursive:true,force:true});}}
const pickupEvents=(host:FakeHost)=>host.events.filter(e=>e.type==='postcard.pickup_due');
it('500次连点+100次轮询只唤醒一次；取信后500次查看走本地、不新增模型事件',()=>fixture(async({world,host,generator,trip,advance}:any)=>{
 const clicks=Array.from({length:500},()=>world.pickup.request(trip.id));expect(new Set(clicks.map(r=>r.request.requestId)).size).toBe(1);await Promise.all(Array.from({length:100},()=>world.pickupPulse()));expect(pickupEvents(host)).toHaveLength(1);
 const request=clicks[0].request;world.pickup.step(request.requestId,'approach');world.pickup.step(request.requestId,'arrived');world.pickup.finish(request.requestId,trip.id);
 for(let i=0;i<500;i++)expect(world.pickup.request(trip.id).kind).toBe('open_local');advance(86400000);expect(world.pickup.request(trip.id).kind).toBe('open_local');await world.pickupPulse();expect(pickupEvents(host)).toHaveLength(1);expect(generator).toHaveBeenCalledTimes(1);expect(world.service.store.cards()).toHaveLength(1);expect(world.mailbox.snapshot().unreadCount).toBe(1);
}));
it('忙碌暂缓后500次点击不新增模型输入，60秒后显式重试才产生新事件',()=>fixture(async({world,host,trip,advance}:any)=>{
 const req=world.pickup.request(trip.id).request;await world.pickupPulse();world.pickup.step(req.requestId,'defer');for(let i=0;i<500;i++)expect(world.pickup.request(trip.id).kind).toBe('cooldown');await world.pickupPulse();expect(pickupEvents(host)).toHaveLength(1);advance(60001);expect(world.pickup.request(trip.id).kind).toBe('requested');await world.pickupPulse();expect(pickupEvents(host)).toHaveLength(2);expect(()=>world.pickup.step(req.requestId,'arrived')).toThrow();
}));
it('重启不能绕过点击限流，损坏限流时间拒绝加载而不改收藏',()=>fixture(async({world,root,trip,now}:any)=>{
 world.pickup.request(trip.id);const queue=new PickupQueue(join(root,'postcard'),()=>world.mailbox.snapshot(),()=>({to:.66}),now);queue.open();expect(queue.request(trip.id).kind).toBe('cooldown');const path=join(root,'postcard/pickup.json'),data=JSON.parse(readFileSync(path,'utf8'));data.records[0].requestedAt='broken';writeFileSync(path,JSON.stringify(data));expect(()=>new PickupQueue(join(root,'postcard'),()=>world.mailbox.snapshot(),()=>({to:.66}),now).open()).toThrow('损坏');expect(world.service.store.cards()).toHaveLength(1);
}));
it('不存在的信件/伪造编号不唤醒模型；不同新信不受上一封限流影响',()=>fixture(async({world,host,trip,advance}:any)=>{
 for(let i=0;i<100;i++)expect(()=>world.pickup.request('00000000-0000-0000-0000-000000000000')).toThrow();await world.pickupPulse();expect(pickupEvents(host)).toHaveLength(0);
 const req=world.pickup.request(trip.id).request;world.pickup.step(req.requestId,'approach');world.pickup.step(req.requestId,'arrived');world.pickup.finish(req.requestId,trip.id);const next=world.service.start('surprise',120);advance(7200000);await world.pulse();expect(world.pickup.request(next.id).kind).toBe('requested');
}));
it('重复已读100次不改变收藏/重复写状态；演出请求历史集合保持有界',()=>fixture(async({world,host,trip,advance,root}:any)=>{
 world.mailbox.markRead(trip.id);const path=join(root,'postcard/mailbox.json'),before=readFileSync(path,'utf8');for(let i=0;i<100;i++)world.mailbox.markRead(trip.id);expect(readFileSync(path,'utf8')).toBe(before);
 for(let i=0;i<100;i++){advance(60001);const req=world.pickup.offer(true,trip.id);await world.pickupPulse();world.pickup.step(req.requestId,'approach');world.pickup.step(req.requestId,'arrived');world.pickup.finish(req.requestId,trip.id);}await world.pickupPulse();expect((world as any).pickupSent.size).toBe(0);expect(pickupEvents(host)).toHaveLength(100);expect(world.service.store.cards()).toHaveLength(1);expect(world.mailbox.snapshot().unreadCount).toBe(0);
}));

it('旧版演出已完成且没有限流字段的记录，升级后查看仍走本地、不唤醒模型',()=>fixture(async({world,host,trip,root,now}:any)=>{
 const req=world.pickup.offer(true,trip.id);world.pickup.step(req.requestId,'approach');world.pickup.step(req.requestId,'arrived');world.pickup.finish(req.requestId,trip.id);const queue=new PickupQueue(join(root,'postcard'),()=>world.mailbox.snapshot(),()=>({to:.66}),now);queue.open();expect(queue.request(trip.id).kind).toBe('open_local');await world.pickupPulse();expect(pickupEvents(host)).toHaveLength(0);expect(world.service.store.cards()).toHaveLength(1);
}));
