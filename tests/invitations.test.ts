import {it,expect,beforeEach,afterEach,vi} from 'vitest';
import {mkdtempSync,rmSync,mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {InvitationSchedule} from '../src/invitations.ts';
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
