import {it,expect,vi} from 'vitest';
import {createHash,randomUUID} from 'node:crypto';
import {existsSync,mkdirSync,mkdtempSync,readdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PNG} from 'pngjs';
import {StoryEngine} from '../src/story.ts';
import {TravelService,TravelStore,type Trip} from '../src/travel.ts';
import {objectContract} from '../src/model-feedback.ts';
import {validateGroundedPlan} from '../src/story-quality.ts';
import {qualifyLocalRecovery} from '../src/recovery-audit.ts';

const plans=JSON.parse(readFileSync(new URL('./fixtures/story-candidates.json',import.meta.url),'utf8'));
const contract=objectContract('single-story-plan-v2',v=>validateGroundedPlan(v.plan,3));
const hints={nodeCount:3,rootGroundingMove:true};

const savedPrompt='saved prompt';
const textHash=(value:string)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const checkpoint=(extra:Record<string,unknown>)=>({requestHash:textHash(savedPrompt),prompt:savedPrompt,attempts:1,...extra});

function withoutGrounding(){const plan=structuredClone(plans[0]);const grounding=plan.grounding;delete (plan as any).grounding;return {plan,grounding};}

function fixture(){
 const root=mkdtempSync(join(tmpdir(),'old-task-'));
 const service=new TravelService(new TravelStore(root),undefined,()=>1000,true);
 service.open();
 const owner=randomUUID();
 return {root,service,owner,folder:join(root,'journey-tasks',owner)};
}

it('旧故事缓存按新修复规则重新复验：根级grounding搬移成功且不新增调用、不改计数',async()=>{
 const {root,service,owner,folder}=fixture(),transport=vi.fn(async()=>{throw Error('不应调用模型');});
 try{
  mkdirSync(folder,{recursive:true});
  writeFileSync(join(folder,'v2-expand-1.json'),JSON.stringify(checkpoint({response:withoutGrounding()})));
  const engine=new StoryEngine(service,transport as any);
  const value=await (engine as any).call(owner,'v2-expand-1',savedPrompt,new AbortController().signal,contract,hints);
  expect(transport).not.toHaveBeenCalled();
  expect(value.plan.grounding).toHaveLength(3);expect(value.grounding).toBeUndefined();
  const saved=JSON.parse(readFileSync(join(folder,'v2-expand-1.json'),'utf8'));
  expect(saved.attempts).toBe(1);expect(saved.response.plan.grounding).toHaveLength(3);
  const record=JSON.parse(readFileSync(join(folder,'v2-expand-1-local-recovery.json'),'utf8'));
  expect(record).toMatchObject({source:'cached-response',version:'local-output-repair-v2'});
 }finally{await service.close();rmSync(root,{recursive:true,force:true});}
});

it('曾被拒的原始提交可直接复用，不再花一次尝试，也不删除历史',async()=>{
 const {root,service,owner,folder}=fixture(),transport=vi.fn(async()=>{throw Error('不应调用模型');});
 try{
  mkdirSync(folder,{recursive:true});
  writeFileSync(join(folder,'v2-expand-1.json'),JSON.stringify(checkpoint({rejectedResponse:withoutGrounding()})));
  const engine=new StoryEngine(service,transport as any);
  const value=await (engine as any).call(owner,'v2-expand-1',savedPrompt,new AbortController().signal,contract,hints);
  expect(value.plan.grounding).toHaveLength(3);expect(transport).not.toHaveBeenCalled();
  const saved=JSON.parse(readFileSync(join(folder,'v2-expand-1.json'),'utf8'));
  expect(saved.attempts).toBe(1);expect(saved.rejectedResponse).toBeUndefined();
  expect(JSON.parse(readFileSync(join(folder,'v2-expand-1-local-recovery.json'),'utf8')).source).toBe('rejected-response');
 }finally{await service.close();rmSync(root,{recursive:true,force:true});}
});

it('旧缓存与当前契约不再兼容时保留原结果并说明原因，不静默删除也不清零',async()=>{
 const {root,service,owner,folder}=fixture(),transport=vi.fn(async()=>{throw Error('不应调用模型');});
 try{
  mkdirSync(folder,{recursive:true});
  const broken={plan:{...(structuredClone(plans[0]) as any),grounding:undefined},note:'not usable'};
  delete broken.plan.grounding;
  writeFileSync(join(folder,'v2-expand-1.json'),JSON.stringify(checkpoint({response:broken})));
  const engine=new StoryEngine(service,transport as any);
  await expect((engine as any).call(owner,'v2-expand-1',savedPrompt,new AbortController().signal,contract,hints)).rejects.toThrow('grounding');
  expect(transport).not.toHaveBeenCalled();
  const saved=JSON.parse(readFileSync(join(folder,'v2-expand-1.json'),'utf8'));
  expect(saved).toEqual(checkpoint({response:broken}));
  const invalid=JSON.parse(readFileSync(join(folder,'v2-expand-1-cache-invalid.json'),'utf8'));
  expect(invalid.errors.length).toBeGreaterThan(0);
 }finally{await service.close();rmSync(root,{recursive:true,force:true});}
});

const png=()=>{const image=new PNG({width:512,height:768});image.data.fill(200);return PNG.sync.write(image);};
const sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
const fingerprint=(root:string):Record<string,string>=>{
 const map:Record<string,string>={};
 const walk=(folder:string,prefix:string)=>{for(const name of readdirSync(folder,{withFileTypes:true})){const full=join(folder,name.name),key=prefix+name.name;if(name.isDirectory())walk(full,key+'/');else map[key]=sha(readFileSync(full));}};
 walk(root,'');return map;
};

it('资格核查只读本地：找到可复用图与旧提交，不调用模型也不留下新文件',()=>{
 const root=mkdtempSync(join(tmpdir(),'audit-')),id=randomUUID(),owner=randomUUID();
 const image=png(),manifest={sha256:sha(image),width:512,height:768};
 mkdirSync(join(root,'trips',id),{recursive:true});writeFileSync(join(root,'trips',id,'image-1.png'),image);writeFileSync(join(root,'trips',id,'image-1.png.json'),JSON.stringify(manifest));
 mkdirSync(join(root,'journey-tasks',owner),{recursive:true});writeFileSync(join(root,'journey-tasks',owner,'v2-expand-1.json'),JSON.stringify({attempts:2,rejectedResponse:withoutGrounding()}));
 const trip:Trip={id,scene:'coast',series:{id:owner,mark:'旅迹·test',nodeIndex:1,total:3},startedAt:0,dueAt:0,status:'failed',failure:{kind:'budget_exhausted',stage:'v2-expand-1',message:'两次上限',at:1}};
 try{
  const before=fingerprint(root);const result=qualifyLocalRecovery(root,trip);const after=fingerprint(root);
  expect(after).toEqual(before);
  expect(result.verdict).toBe('reusable');expect(result.localModelCalls).toBe(0);
  expect(result.stages.find(s=>s.stage==='image-1')).toMatchObject({source:'image',reusable:true});
  expect(result.stages.find(s=>s.stage==='v2-expand-1')).toMatchObject({source:'story',reusable:true});
  expect(result.notes.join(' ')).toContain('没有调用模型');
 }finally{rmSync(root,{recursive:true,force:true});}
});

it('没有本地结果时按失败类别给出结论：预算耗尽需要追加授权，其余不改原结论',()=>{
 const root=mkdtempSync(join(tmpdir(),'audit-empty-')),id=randomUUID();
 try{
  const spent=qualifyLocalRecovery(root,{id,scene:'coast',startedAt:0,dueAt:0,status:'failed',failure:{kind:'budget_exhausted',stage:'image',message:'上限',at:1}});
  expect(spent.verdict).toBe('needs_grant');expect(spent.stages).toEqual([]);
  const blocked=qualifyLocalRecovery(root,{id,scene:'coast',startedAt:0,dueAt:0,status:'failed',failure:{kind:'policy_blocked',stage:'plan-1',message:'过滤',at:1}});
  expect(blocked.verdict).toBe('no_local_result');
 }finally{rmSync(root,{recursive:true,force:true});}
});

it('被审核判为不合格的候选图不会被当作可复用结果，待交付成品可复用',()=>{
 const root=mkdtempSync(join(tmpdir(),'audit-image-')),id=randomUUID(),image=png();
 mkdirSync(join(root,'trips',id),{recursive:true});
 writeFileSync(join(root,'trips',id,'image-2.png'),image);writeFileSync(join(root,'trips',id,'image-2.png.json'),JSON.stringify({sha256:sha(image)}));writeFileSync(join(root,'trips',id,'image-2-rejected.json'),JSON.stringify({rejected:true}));
 mkdirSync(join(root,'prepared',id),{recursive:true});writeFileSync(join(root,'prepared',id,'postcard.png'),image);writeFileSync(join(root,'prepared',id,'artifact.json'),JSON.stringify({sha256:sha(image),title:'旧来信',note:'已经写好的短笺，等待入藏。'}));
 try{
  const result=qualifyLocalRecovery(root,{id,scene:'coast',startedAt:0,dueAt:0,status:'failed'});
  expect(result.stages.find(s=>s.stage==='image-2')).toMatchObject({reusable:false});
  expect(result.stages.find(s=>s.stage==='prepared-artifact')).toMatchObject({reusable:true});
  expect(result.verdict).toBe('reusable');
  expect(existsSync(join(root,'trips',id,'image-2-rejected.json'))).toBe(true);
 }finally{rmSync(root,{recursive:true,force:true});}
});

it('其他阶段的候选不解除当前阻塞；长途宿主任务按journey owner匹配',()=>{
 const root=mkdtempSync(join(tmpdir(),'audit-scope-')),id=randomUUID(),owner=randomUUID(),image=png();
 mkdirSync(join(root,'trips',id),{recursive:true});
 writeFileSync(join(root,'trips',id,'image-1.png'),image);writeFileSync(join(root,'trips',id,'image-1.png.json'),JSON.stringify({sha256:sha(image)}));
 const trip:Trip={id,scene:'coast',series:{id:owner,mark:'旅迹·test',nodeIndex:2,total:3},startedAt:0,dueAt:0,status:'failed',failure:{kind:'budget_exhausted',stage:'v2-expand-2',message:'两次上限',at:1}};
 try{
  const onlyImage=qualifyLocalRecovery(root,trip);
  expect(onlyImage.blockingStage).toBe('v2-expand-2');
  expect(onlyImage.stages.find(s=>s.stage==='image-1')).toMatchObject({reusable:true,unblocks:false});
  expect(onlyImage.verdict).toBe('needs_grant');
  expect(onlyImage.notes.join(' ')).toContain('属于其他阶段');

  // Story stages of a long journey live under the journey id, not under the trip id.
  const digest='a'.repeat(64);
  mkdirSync(join(root,'host-tasks'),{recursive:true});
  writeFileSync(join(root,'host-tasks',digest+'.json'),JSON.stringify({id:digest,digest,tripId:owner,label:'v2-expand-2',createdAt:1,submissions:[{resultJson:JSON.stringify(withoutGrounding())}]}));
  const withHost=qualifyLocalRecovery(root,trip);
  expect(withHost.stages.find(s=>s.stage==='v2-expand-2')).toMatchObject({source:'host',reusable:true,unblocks:true});
  expect(withHost.verdict).toBe('reusable');
 }finally{rmSync(root,{recursive:true,force:true});}
});
