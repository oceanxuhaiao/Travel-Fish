import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {mkdtempSync,rmSync,readFileSync,readdirSync,unlinkSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {TravelStore,TravelService,type Artifact} from '../src/travel.ts';
const fault=vi.hoisted(()=>({imageDiskFull:false,jsonDiskFull:false}));
vi.mock('node:fs',async(importOriginal)=>{
 const actual=await importOriginal<typeof import('node:fs')>();
 return {...actual,writeFileSync:(path:any,...args:any[])=>{
  if((fault.imageDiskFull&&typeof path==='string'&&path.endsWith('postcard.png'))||(fault.jsonDiskFull&&typeof path==='number'))throw Object.assign(new Error('Simulated ENOSPC'),{code:'ENOSPC'});
  return (actual.writeFileSync as any)(path,...args);
 }};
});
let root:string,time:number;const services:TravelService[]=[];
const artifact:Artifact={image:Buffer.from('89504e470d0a1a0a00000000','hex'),title:'故障测试成品',note:'仅测试提交边界，不是真实生图。'};
function make(gen:ConstructorParameters<typeof TravelService>[1]){const service=new TravelService(new TravelStore(root),gen,()=>time);service.open();services.push(service);return service;}
beforeEach(()=>{root=mkdtempSync(join(tmpdir(),'postcard-faults-'));time=0;});
afterEach(async()=>{fault.imageDiskFull=false;fault.jsonDiskFull=false;for(const service of services.splice(0))await service.close();rmSync(root,{force:true,recursive:true});vi.restoreAllMocks();});
it('休眠跨多日后并发唤醒只结算一次，时钟倒退不提前生成',async()=>{
 const gen=vi.fn(async()=>artifact),s=make(gen),trip=s.start('forest',30);time=-3600000;await s.tick();expect(gen).not.toHaveBeenCalled();
 time=trip.dueAt+7*86400000;await Promise.all(Array.from({length:30},()=>s.tick()));expect(gen).toHaveBeenCalledTimes(1);expect(s.store.cards()).toHaveLength(1);
});
it('图片写盘ENOSPC不暴露半成品，修复后同编号提交且忽略遗留pending目录',async()=>{
 const s=make(async()=>artifact),trip=s.start('coast',1);time=trip.dueAt;fault.imageDiskFull=true;await s.tick();
 expect(s.status()?.status).toBe('failed');expect(s.store.cards()).toEqual([]);expect(existsSync(join(s.store.collection,trip.id))).toBe(false);
 expect(readdirSync(s.store.collection).some(n=>n.endsWith('.pending'))).toBe(true);
 fault.imageDiskFull=false;s.retry(trip.id);await s.tick();expect(s.store.cards()).toHaveLength(1);expect(s.store.cards()[0].tripId).toBe(trip.id);
});
it('快照ENOSPC保留原状态并清理未提交临时文件',()=>{
 const s=make(undefined),before=readFileSync(join(root,'state.json'),'utf8');fault.jsonDiskFull=true;
 expect(()=>s.start('snow',1)).toThrow('ENOSPC');fault.jsonDiskFull=false;
 expect(s.status()).toBeNull();expect(readFileSync(join(root,'state.json'),'utf8')).toBe(before);expect(readdirSync(root).some(n=>n.endsWith('.tmp'))).toBe(false);
});
it('没有独立收藏索引仍可恢复；删除state不会覆盖现有卡片',async()=>{
 const s=make(async()=>artifact),trip=s.start('snow',1);time=trip.dueAt;await s.tick();const old=readFileSync(join(s.store.collection,trip.id,'postcard.png'));await s.close();
 expect(existsSync(join(root,'index.json'))).toBe(false);unlinkSync(join(root,'state.json'));
 const b=make(undefined);expect(b.store.cards()[0].tripId).toBe(trip.id);expect(b.pendingNotifications()).toHaveLength(1);expect(b.start('forest',1).id).not.toBe(trip.id);
 expect(readFileSync(join(b.store.collection,trip.id,'postcard.png'))).toEqual(old);
});
it('真实子进程生成时退出，清理失效锁但不重发未知远端任务',async()=>{
 const moduleUrl=new URL('../src/travel.ts',import.meta.url).href;
 const script=`import {TravelStore} from ${JSON.stringify(moduleUrl)};import {randomUUID} from 'node:crypto';const store=new TravelStore(process.argv[1]);store.open();store.save({schema:1,trips:[{id:randomUUID(),scene:'forest',startedAt:0,dueAt:1,status:'generating'}],notified:[]});process.exit(0);`;
 const result=spawnSync(process.execPath,['--import','tsx','--input-type=module','-e',script,root],{encoding:'utf8'});expect(result.status,result.stderr).toBe(0);
 expect(existsSync(join(root,'writer.lock'))).toBe(true);const gen=vi.fn(async()=>artifact),s=make(gen);time=10000;await s.tick();
 expect(s.status()?.status).toBe('failed');expect(gen).not.toHaveBeenCalled();expect(s.store.cards()).toEqual([]);
});
it('通知投递失败保留待发收藏，重试通知不重生图或覆盖成品',async()=>{
 const gen=vi.fn(async()=>artifact),s=make(gen),trip=s.start('coast',1);time=trip.dueAt;await s.tick();await s.tick();
 expect(s.pendingNotifications()).toHaveLength(1);await s.close();const b=make(undefined);expect(b.pendingNotifications()[0].tripId).toBe(trip.id);b.acknowledge(trip.id);expect(b.pendingNotifications()).toEqual([]);expect(gen).toHaveBeenCalledTimes(1);
});
