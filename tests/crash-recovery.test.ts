import {it,expect,vi} from 'vitest';
import {mkdtempSync,rmSync,readFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';import {spawnSync} from 'node:child_process';
import {TravelService,TravelStore} from '../src/travel.ts';import {MailboxStore} from '../src/mailbox.ts';import {PickupQueue} from '../src/pickup.ts';
const artifact={image:Buffer.from('89504e470d0a1a0a00000000','hex'),title:'隔离恢复验证',note:'开发数据，无云调用'};
it.each(['prepared','approaching','presenting'])('真实进程异常退出后恢复%s：不重新生成、不自动重演、不丢收藏',async(mode)=>{
 const root=mkdtempSync(join(tmpdir(),'postcard-r4-'));let service:TravelService|undefined;
 try{
 const travel=new URL('../src/travel.ts',import.meta.url).href,mailbox=new URL('../src/mailbox.ts',import.meta.url).href,pickup=new URL('../src/pickup.ts',import.meta.url).href;
 const script=`import {TravelService,TravelStore} from ${JSON.stringify(travel)};import {MailboxStore} from ${JSON.stringify(mailbox)};import {PickupQueue} from ${JSON.stringify(pickup)};import {writeFileSync} from 'node:fs';import {join} from 'node:path';let now=100;const service=new TravelService(new TravelStore(process.argv[1]),undefined,()=>now,true);service.open();const mail=new MailboxStore(service,()=>now);mail.open();const queue=new PickupQueue(process.argv[1],()=>mail.snapshot(),()=>({to:.66}),()=>now);queue.open();const trip=service.start('surprise',120);service.store.stageArtifact(trip,{image:Buffer.from('89504e470d0a1a0a00000000','hex'),title:'隔离恢复验证',note:'开发数据，无云调用'});let request=null;if(process.argv[2]!=='prepared'){now=trip.dueAt;await service.tick();request=queue.offer(true);queue.step(request.requestId,'approach');if(process.argv[2]==='presenting')queue.step(request.requestId,'arrived');}writeFileSync(join(process.argv[1],'fixture.json'),JSON.stringify({trip,request}));process.exit(73);`;
 const child=spawnSync(process.execPath,['--import','tsx','--input-type=module','-e',script,root,mode],{encoding:'utf8'});expect(child.status,child.stderr).toBe(73);expect(existsSync(join(root,'writer.lock'))).toBe(true);
 const fixture=JSON.parse(readFileSync(join(root,'fixture.json'),'utf8'));const now=fixture.trip.dueAt+7*86400000,generator=vi.fn(async()=>artifact);
 service=new TravelService(new TravelStore(root),generator,()=>now,true);service.open();const mail=new MailboxStore(service,()=>now);mail.open();const queue=new PickupQueue(root,()=>mail.snapshot(),()=>({to:.66}),()=>now);queue.open();
 await Promise.all(Array.from({length:100},()=>service!.tick()));expect(generator).not.toHaveBeenCalled();expect(service.store.cards()).toHaveLength(1);expect(queue.snapshot().active).toBeNull();expect(mail.snapshot().unreadCount).toBe(1);
 if(fixture.request){expect(()=>queue.step(fixture.request.requestId,'arrived')).toThrow();const replay=queue.offer(true,fixture.trip.id)!;queue.step(replay.requestId,'approach');queue.step(replay.requestId,'arrived');for(let n=0;n<100;n++)expect(queue.step(replay.requestId,'arrived')).toMatchObject({duplicate:true});queue.finish(replay.requestId,fixture.trip.id);expect(mail.snapshot().unreadCount).toBe(1);}
 }finally{await service?.close();rmSync(root,{recursive:true,force:true});}
});
