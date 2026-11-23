import {it,expect,vi,beforeEach,afterEach} from 'vitest';
import {mkdtempSync,mkdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {TravelService,TravelStore} from '../src/travel.ts';
import {PipelineError} from '../src/generation.ts';

const grantsOf=(file:string)=>JSON.parse(readFileSync(file,'utf8')).grants as any[];
const roots:string[]=[];
const scratch=()=>{const root=mkdtempSync(join(tmpdir(),'grant-window-'));roots.push(root);return root;};
afterEach(()=>{while(roots.length)rmSync(roots.pop()!,{recursive:true,force:true});});

/** A trip that already exhausted its stage: the only way forward is one explicit, separately confirmed grant. */
async function exhausted(){
 const root=scratch(),grants=join(root,'retry-grants.json');
 let time=0;
 const generate=vi.fn(async()=>{throw new PipelineError('本阶段两次结构提交已耗尽','budget_exhausted','plan-1');});
 const service=new TravelService(new TravelStore(root),generate,()=>time,false,120);
 service.open();
 const trip=service.startShort();
 time=trip.dueAt+1;await service.tick();
 expect(generate).toHaveBeenCalledTimes(1);
 const grant=service.grantRetry(trip.id);
 service.retry(trip.id,false,grant.grantId);
 expect(grantsOf(grants)[0]).toMatchObject({state:'reserved',consumedBy:trip.id});
 return {root,grants,service,generate,trip,grant};
}

it('开始记录写不进去时不派发，授权保持可复用',async()=>{
 const {grants,service,generate,trip,grant}=await exhausted();
 try{
  vi.spyOn(service.store,'save').mockImplementationOnce(()=>{throw new Error('disk full');});
  await expect(service.tick()).rejects.toThrow('disk full');
  expect(generate).toHaveBeenCalledTimes(1);
  // The start record never landed, so the grant is untouched and the trip still waits on it: the next tick resumes it.
  expect(grantsOf(grants)[0]).toMatchObject({state:'reserved'});
  const saved=JSON.parse(readFileSync(join(service.store.root,'state.json'),'utf8')).trips.find((t:any)=>t.id===trip.id);
  expect(saved.status).toBe('traveling');
  expect(saved.grantRef).toBe(grant.grantId);
  // Disk recovered: the same reserved grant is reused for the dispatch instead of asking the user to confirm again.
  await service.tick();
  expect(generate).toHaveBeenCalledTimes(2);
  expect(grantsOf(grants)[0]).toMatchObject({state:'running'});
 }finally{await service.close();}
});

it('授权派发记录写失败时不静默继续收费，授权仍为已预占',async()=>{
 const {grants,service,generate,trip}=await exhausted();
 try{
  const original=(service as any).saveGrants.bind(service);
  (service as any).saveGrants=()=>{throw new Error('grants full');};
  await service.tick();
  (service as any).saveGrants=original;
  expect(generate).toHaveBeenCalledTimes(1);
  expect(grantsOf(grants)[0]).toMatchObject({state:'reserved'});
  const saved=service.store.snapshot().trips.find(t=>t.id===trip.id)!;
  expect(saved.status).toBe('failed');
  expect(saved.error).toContain('授权派发记录写入失败');
  expect(saved.grantRef).toBeUndefined();
 }finally{await service.close();}
});

/** Writes the state a crash leaves behind: the trip is generating, the grant looks spent, nothing else exists yet. */
function crashed(root:string,grantState:'running'|'reserved'){
 const id=randomUUID();
 writeFileSync(join(root,'state.json'),JSON.stringify({schema:1,notified:[],journeys:[],trips:[{id,scene:'coast',startedAt:0,dueAt:1000,status:'generating',grantRef:'g1',failure:{kind:'budget_exhausted',stage:'plan-1',message:'旧失败',at:1}}]}));
 writeFileSync(join(root,'retry-grants.json'),JSON.stringify({schema:1,grants:[{id:'g1',tripId:id,owner:id,stage:'plan-1',kind:'text',createdAt:1,consumedAt:2,consumedBy:id,state:grantState,dispatchedAt:Date.now()}]}));
 return id;
}

it('崩溃在首次请求之前：重启把授权退回可复用，用户不必再确认一次',async()=>{
 const root=scratch(),id=crashed(root,'running');
 const service=new TravelService(new TravelStore(root),undefined,()=>10);
 try{
  service.open();
  const trip=service.store.snapshot().trips.find(t=>t.id===id)!;
  expect(trip.status).toBe('failed');
  expect(trip.grantRef).toBeUndefined();
  expect(trip.failure).toMatchObject({kind:'budget_exhausted'});
  expect(trip.failure!.message).toContain('派发前中断');
  expect(grantsOf(join(root,'retry-grants.json'))[0]).toMatchObject({state:'reserved'});
  expect(()=>service.retry(id,false,'g1')).not.toThrow();
  expect(service.store.snapshot().trips.find(t=>t.id===id)!.status).toBe('traveling');
 }finally{await service.close();}
});

it('带授权编号的请求记录按可能已计费处理：不自动重发，需要重新确认一次追加',async()=>{
 const root=scratch(),id=crashed(root,'running');
 mkdirSync(join(root,'journey-tasks',id),{recursive:true});
 writeFileSync(join(root,'journey-tasks',id,'plan-1.json'),JSON.stringify({attempts:3,grant:'g1'}));
 const service=new TravelService(new TravelStore(root),undefined,()=>10);
 try{
  service.open();
  const trip=service.store.snapshot().trips.find(t=>t.id===id)!;
  expect(trip.failure!.message).toContain('结果不明');
  expect(grantsOf(join(root,'retry-grants.json'))[0]).toMatchObject({state:'running'});
  expect(()=>service.retry(id,false,'g1')).toThrow('已经用过');
  const again=service.grantRetry(id);
  expect(again.grantId).not.toBe('g1');
 }finally{await service.close();}
});

it('不带授权编号的旧记录只能按时间归属：按无法确认处理，不退回也不重发',async()=>{
 const root=scratch(),id=crashed(root,'running');
 mkdirSync(join(root,'journey-tasks',id),{recursive:true});
 writeFileSync(join(root,'journey-tasks',id,'plan-1-request.json'),JSON.stringify({model:'host-model',prompt:'旧版本写下的请求'}));
 const service=new TravelService(new TravelStore(root),undefined,()=>10);
 try{
  service.open();
  const trip=service.store.snapshot().trips.find(t=>t.id===id)!;
  expect(trip.failure!.message).toContain('无法确认');
  expect(grantsOf(join(root,'retry-grants.json'))[0]).toMatchObject({state:'running'});
 }finally{await service.close();}
});
