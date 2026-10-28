import {it,expect,beforeEach,afterEach,vi} from 'vitest';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {TravelService,TravelStore} from '../src/travel.ts';
import {MailboxStore} from '../src/mailbox.ts';
import {PostcardWorld} from '../src/world.ts';
import {POSTCARD_DEFAULTS} from '../src/config.ts';
import {FakeHost} from './helpers/fake-host.ts';
let root:string,now:number,service:TravelService,mail:MailboxStore;
const artifact={image:Buffer.from('89504e470d0a1a0a00000000','hex'),title:'远方的一刻',note:'想把这一刻寄给你。'};
beforeEach(()=>{root=mkdtempSync(join(tmpdir(),'postcard-mailbox-'));now=100;service=new TravelService(new TravelStore(root),async()=>artifact,()=>now,true);service.open();mail=new MailboxStore(service,()=>now);mail.open();});
afterEach(async()=>{await service.close();rmSync(root,{recursive:true,force:true});});
it('预制不提前出信，固定两小时到期入藏后才有新信，展示不增加生成',async()=>{
 const trip=service.start('surprise',120);await service.tick();expect(mail.snapshot()).toMatchObject({phase:'traveling',progress:0,unreadCount:0,cards:[]});
 now=trip.startedAt+3600000;expect(mail.snapshot()).toMatchObject({progress:.5,remainingMs:3600000});
 now=trip.dueAt-1;await service.tick();expect(mail.snapshot().cards).toHaveLength(0);
 now=trip.dueAt;await service.tick();expect(mail.snapshot()).toMatchObject({phase:'mail_waiting',unreadCount:1});
 expect(mail.snapshot().cards[0].tripId).toBe(trip.id);await service.tick();expect(mail.snapshot().unreadCount).toBe(1);
 mail.markRead(trip.id);expect(mail.snapshot()).toMatchObject({phase:'idle',unreadCount:0});expect(service.store.cards()).toHaveLength(1);
});
it('取消已预制旅行不出信；没有同意即未创建旅程，不会推进旅行',async()=>{
 expect(mail.snapshot()).toMatchObject({phase:'idle',trip:null,cards:[]});
 const trip=service.start('surprise',120);await service.tick();service.cancel(trip.id);now=trip.dueAt+1;await service.tick();expect(mail.snapshot()).toMatchObject({phase:'idle',unreadCount:0,cards:[]});
 expect(()=>mail.markRead(trip.id)).toThrow('已入藏');
});
it('到期无服务保持100%等待，不伪造新信',async()=>{
 await service.close();service=new TravelService(new TravelStore(root),undefined,()=>now,true);service.open();mail=new MailboxStore(service,()=>now);mail.open();
 const trip=service.start('surprise',120);now=trip.dueAt+100;await service.tick();expect(mail.snapshot()).toMatchObject({phase:'waiting',progress:1,remainingMs:0,unreadCount:0,cards:[]});
});
it('未读跨重启保留，下一趟旅行不覆盖，重复已读不重复入藏',async()=>{
 const one=service.start('surprise',120);now=one.dueAt;await service.tick();expect(mail.snapshot().unreadCount).toBe(1);
 await service.close();service=new TravelService(new TravelStore(root),async()=>artifact,()=>now,true);service.open();mail=new MailboxStore(service,()=>now);mail.open();expect(mail.snapshot().unreadCount).toBe(1);
 const two=service.start('surprise',120);expect(mail.snapshot()).toMatchObject({phase:'traveling',unreadCount:1});now=two.dueAt;await service.tick();expect(mail.snapshot().unreadCount).toBe(2);
 mail.markRead(one.id);mail.markRead(one.id);expect(mail.snapshot().unreadCount).toBe(1);
 await service.close();service=new TravelService(new TravelStore(root),undefined,()=>now,true);service.open();mail=new MailboxStore(service,()=>now);mail.open();expect(mail.snapshot().unreadCount).toBe(1);expect(service.store.cards()).toHaveLength(2);
});
it('首次升级把旧收藏作为已读基线，不改旧旅程时间，之后新入藏仍未读',async()=>{
 const trip=service.start('surprise',30);now=trip.dueAt;await service.tick();rmSync(join(root,'mailbox.json'));mail=new MailboxStore(service,()=>now);mail.open();expect(mail.snapshot().unreadCount).toBe(0);expect(service.status()!.dueAt-trip.startedAt).toBe(1800000);
 const next=service.start('surprise',120);now=next.dueAt;await service.tick();expect(mail.snapshot().unreadCount).toBe(1);
});
it('预制后关闭，跨到期重开无生成器也能入藏并显示未读',async()=>{
 const trip=service.start('surprise',120);await service.tick();await service.close();now=trip.dueAt+60000;
 service=new TravelService(new TravelStore(root),undefined,()=>now,true);service.open();mail=new MailboxStore(service,()=>now);mail.open();await service.tick();expect(mail.snapshot()).toMatchObject({phase:'mail_waiting',unreadCount:1});
});
it('损坏已读记录不覆盖原文件，正式收藏仍可读',async()=>{
 const trip=service.start('surprise',120);now=trip.dueAt;await service.tick();writeFileSync(join(root,'mailbox.json'),'{broken');expect(()=>new MailboxStore(service).open()).toThrow();expect(service.store.card(trip.id)?.title).toBe(artifact.title);
});
it('World邮箱记录损坏或运行时缺失，旅行收藏面板仍可用',async()=>{
 const dataDir=join(root,'world');const world=new PostcardWorld({cfg:{...POSTCARD_DEFAULTS,mailboxEnabled:false},dataDir});await world.start(new FakeHost());await world.stop();writeFileSync(join(dataDir,'postcard/mailbox.json'),'{broken');
 const restored=new PostcardWorld({cfg:POSTCARD_DEFAULTS,dataDir});await restored.start(new FakeHost());try{expect(restored.panel.snapshot().cards).toEqual([]);await expect(restored.openMailbox()).rejects.toThrow('损坏');}finally{await restored.stop();}
});
