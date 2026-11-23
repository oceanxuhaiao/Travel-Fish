import {it,expect,vi} from 'vitest';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {StoryEngine} from '../src/story.ts';
import {TravelService,TravelStore} from '../src/travel.ts';
import {HostModelBridge} from '../src/host-model.ts';
import {PipelineError} from '../src/generation.ts';
import {objectContract} from '../src/model-feedback.ts';
import {validateGroundedPlan} from '../src/story-quality.ts';
import {FakeHost} from './helpers/fake-host.ts';

const plans=JSON.parse(readFileSync(new URL('./fixtures/story-candidates.json',import.meta.url),'utf8'));
const contract=objectContract('single-story-plan-v2',v=>validateGroundedPlan(v.plan,3));
const hints={nodeCount:3,rootGroundingMove:true};
const prompt='只展开所选direction，返回{plan:一个完整方案}。合成请求，不含真实剧情。';
const good=()=>JSON.stringify({plan:structuredClone(plans[0])});

const until=async(check:()=>boolean,ms=5000)=>{const end=Date.now()+ms;while(Date.now()<end){if(check())return;await new Promise(r=>setTimeout(r,10));}throw Error('等待宿主事件超时');};
const taskId=(host:FakeHost)=>String(host.events.at(-1)!.text).match(/taskId=([a-f0-9]{64})/)![1];

/**
 * The path the audit could not find: two real rejected submissions exhaust the stage, a separately confirmed grant is
 * persisted, the stage is activated again, and the third submission is accepted and saved by StoryEngine.
 */
for(const mode of ['long','short'] as const){
 it('真实宿主链路：两次拒绝→追加授权→再次激活→有效提交→StoryEngine保存response（'+mode+'）',async()=>{
  const root=mkdtempSync(join(tmpdir(),'grant-chain-')),grants=join(root,'retry-grants.json');
  const bridge=new HostModelBridge(join(root,'host-tasks'),5000,grants),host=new FakeHost();
  host.modelFacts.accepts=()=>true;bridge.attach(host);
  let time=0;
  const stub=vi.fn(async()=>{throw new PipelineError('本阶段两次结构提交已耗尽','budget_exhausted','v2-expand-1');});
  const service=new TravelService(new TravelStore(root),stub,()=>time,false,120);
  service.open();
  try{
   const trip=mode==='long'?service.startSeries():service.startShort();
   const owner=mode==='long'?trip.series!.id:trip.id;
   time=trip.dueAt+1;await service.tick();
   expect(service.store.snapshot().trips.find(t=>t.id===trip.id)!.failure).toMatchObject({kind:'budget_exhausted',stage:'v2-expand-1'});

   const engine=new StoryEngine(service,bridge.transport);
   const call=()=>(engine as any).call(owner,'v2-expand-1',prompt,new AbortController().signal,contract,undefined,hints) as Promise<any>;

   // First activation: two structural submissions are rejected inside the same host task.
   const first=call().then(()=>({ok:true,error:''}),e=>({ok:false,error:String(e)}));
   await until(()=>host.events.length===1);
   const id=taskId(host);
   expect(bridge.submit(id,id,'{"bad":true}')).toMatchObject({accepted:false,remainingSubmissions:1});
   expect(bridge.submit(id,id,'{"bad":true}')).toMatchObject({accepted:false,remainingSubmissions:0});
   const outcome=await first;
   expect(outcome.ok).toBe(false);expect(outcome.error).toContain('两次结构提交');
   let cp=JSON.parse(readFileSync(join(root,'journey-tasks',owner,'v2-expand-1.json'),'utf8'));
   expect(cp.attempts).toBe(1);expect(cp.response).toBeUndefined();

   // A second paid attempt is refused by the persisted limit before any event is pushed.
   const second: {ok:boolean;error:string}=await call().then(()=>({ok:true,error:''}),e=>({ok:false,error:String(e)}));
   expect(second.ok).toBe(false);expect(second.error).toContain('耗尽');
   expect(host.events).toHaveLength(1);

   // The user confirms exactly one extra call: it is written to disk before the trip moves.
   const grant=service.grantRetry(trip.id);
   expect(grant).toMatchObject({stage:'v2-expand-1',kind:'text'});
   service.retry(trip.id,false,grant.grantId);
   expect(service.store.snapshot().trips.find(t=>t.id===trip.id)!.status).toBe('traveling');
   expect(JSON.parse(readFileSync(grants,'utf8')).grants[0]).toMatchObject({id:grant.grantId,state:'reserved'});

   // Third activation accepts the extra attempt and the good submission is saved as the response.
   const third=call();
   await until(()=>host.events.length===2);
   expect(taskId(host)).toBe(id);
   expect(bridge.submit(id,id,good())).toMatchObject({accepted:true,remainingSubmissions:0});
   const value=await third;
   expect(value.plan.grounding).toHaveLength(3);
   cp=JSON.parse(readFileSync(join(root,'journey-tasks',owner,'v2-expand-1.json'),'utf8'));
   expect(cp.response.plan.id).toBe(plans[0].id);
   expect(cp.attempts).toBe(3);
   expect(host.events).toHaveLength(2);
  }finally{await service.close();bridge.detach();rmSync(root,{recursive:true,force:true});}
 });
}
