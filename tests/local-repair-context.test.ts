import {it,expect} from 'vitest';
import {mkdtempSync,readFileSync,rmSync,existsSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PNG} from 'pngjs';
import {StoryEngine} from '../src/story.ts';
import {TravelService,TravelStore} from '../src/travel.ts';
import {HostModelBridge} from '../src/host-model.ts';
import {PipelineError} from '../src/generation.ts';
import {objectContract} from '../src/model-feedback.ts';
import {FakeHost} from './helpers/fake-host.ts';

const plans=JSON.parse(readFileSync(new URL('./fixtures/story-candidates.json',import.meta.url),'utf8'));
/** A tiny but real PNG: the store refuses anything that is not one. */
const png=(()=>{const img=new PNG({width:4,height:6});img.data.fill(200);return PNG.sync.write(img);})();
const artifact={image:png,title:'第一张',note:'第一张的正文，用于证明前序卡确实存在。'};

/**
 * A long journey has one owner id shared by three trips. Guessing "is this a local repair?" from that id used to pick the
 * first (finished) trip, so the second/third segment quietly left local-only mode and started paying. The engine now takes
 * the trip explicitly, and an ambiguous or unreadable owner blocks instead of degrading to a paid run.
 */
it('长途第二段的零调用标记不被第一段掩盖：没有任何宿主结果时一次调用也不发',async()=>{
 const root=mkdtempSync(join(tmpdir(),'local-context-')),grants=join(root,'retry-grants.json');
 const bridge=new HostModelBridge(join(root,'host-tasks'),5000,grants),host=new FakeHost();
 host.modelFacts.accepts=()=>true;bridge.attach(host);
 let time=0,calls=0;
 const stub=async()=>{calls++;throw new PipelineError('本阶段两次结构提交已耗尽','budget_exhausted','node-2-adapt-1');};
 const service=new TravelService(new TravelStore(root),stub,()=>time,false,120);
 service.open();
 try{
  const first=service.startSeries(),journeyId=first.series!.id;
  const state=service.store.snapshot(),firstTrip=state.trips.find(t=>t.id===first.id)!;
  service.store.commit(firstTrip,artifact,1000);
  firstTrip.status='completed';firstTrip.completedAt=1000;service.store.save(state);
  service.store.updateJourney(journeyId,j=>{j.plan=structuredClone(plans[0]);});

  const second=service.startSeries();
  expect(second.series).toMatchObject({id:journeyId,nodeIndex:2});
  time=second.dueAt+1;await service.tick();
  expect(service.store.snapshot().trips.find(t=>t.id===second.id)!.failure).toMatchObject({kind:'budget_exhausted'});
  expect(calls).toBe(1);
  service.retry(second.id,false,undefined,{localOnly:true});
  expect(service.store.snapshot().trips.find(t=>t.id===second.id)!).toMatchObject({status:'traveling',localRetry:true});

  const engine=new StoryEngine(service,bridge.transport);
  const trip=service.store.snapshot().trips.find(t=>t.id===second.id)!;
  await expect(engine.context(trip,new AbortController().signal)).rejects.toThrow('后续节点未通过');

  expect(host.events).toHaveLength(0);
  const folder=join(root,'journey-tasks',journeyId);
  const nodeFiles=existsSync(folder)?readdirSync(folder).filter(n=>n.startsWith('node-2-')&&n.endsWith('.json')&&!n.endsWith('-issues.json')):[];
  expect(nodeFiles).toEqual([]);
  expect(existsSync(grants)).toBe(false);
 }finally{await service.close();bridge.detach();rmSync(root,{recursive:true,force:true});}
});

it('同一系列有两趟都标记为本地修复时拒绝猜测，不发调用',async()=>{
 const root=mkdtempSync(join(tmpdir(),'local-ambiguous-'));
 const trips=[{id:'round-a',status:'traveling',localRetry:true,series:{id:'journey-z',nodeIndex:2,total:3}},{id:'round-b',status:'traveling',localRetry:true,series:{id:'journey-z',nodeIndex:3,total:3}}];
 const engine=new StoryEngine({store:{root,snapshot:()=>({trips})}} as any,async()=>{throw Error('不该调用模型');});
 try{
  const contract=objectContract('synthetic',v=>{if(v.ok!==true)throw Error('bad');});
  await expect((engine as any).call('journey-z','v2-expand-1','synthetic',new AbortController().signal,contract)).rejects.toThrow('归属不唯一');
 }finally{rmSync(root,{recursive:true,force:true});}
});

it('读不到状态时阻断而不是当作正常调用',async()=>{
 const root=mkdtempSync(join(tmpdir(),'local-nostore-'));
 const engine=new StoryEngine({store:{root}} as any,async()=>{throw Error('不该调用模型');});
 try{
  const contract=objectContract('synthetic',v=>{if(v.ok!==true)throw Error('bad');});
  await expect((engine as any).call('j','plan-1','synthetic',new AbortController().signal,contract)).rejects.toThrow('无法确认');
 }finally{rmSync(root,{recursive:true,force:true});}
});

it('零调用闸门兜住忘记带 cacheOnly 的调用',async()=>{
 const root=mkdtempSync(join(tmpdir(),'local-gate-'));
 const engine=new StoryEngine({store:{root,snapshot:()=>({trips:[]})}} as any,async()=>{throw Error('不该调用模型');});
 try{
  const contract=objectContract('synthetic',v=>{if(v.ok!==true)throw Error('bad');});
  expect(()=>(engine as any).dispatch({__postcardTask:{label:'plan-1'}},new AbortController().signal,{outputContract:contract,repairHints:{}},true)).toThrow('已阻断');
 }finally{rmSync(root,{recursive:true,force:true});}
});
