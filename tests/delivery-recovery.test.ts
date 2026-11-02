import {it,expect} from 'vitest';
import {createHash} from 'node:crypto';import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {recoverOutput,parseBoundedOutput} from '../src/delivery-recovery.ts';
import {objectContract,generationContract} from '../src/model-feedback.ts';import {validatePortrayal,validateGroundedPlan} from '../src/story-quality.ts';
const plans=JSON.parse(readFileSync(new URL('./fixtures/story-candidates.json',import.meta.url),'utf8'));
const shortPlan=()=>{const p=structuredClone(plans[0]);p.nodes=p.nodes.slice(0,1);p.grounding=[p.grounding[0]];return p;};
const oneNodeContract=objectContract('single-node-grounding-v1',v=>{const plan=v.plan??v;if(!Array.isArray(plan.nodes)||plan.nodes.length!==1)throw Error('需要单节点');validateGroundedPlan(plan,1);});
const oneNodeCandidatesContract=objectContract('short-candidates-grounding-v1',v=>{if(!Array.isArray(v.candidates))throw Error('需要候选数组');for(const p of v.candidates)validateGroundedPlan(p,1);});
const longContract=objectContract('three-node-grounding-v1',v=>{const plan=v.plan??v;validateGroundedPlan(plan,3);});
import {imageAccepted} from '../src/generation.ts';import {HostModelBridge} from '../src/host-model.ts';import {FakeHost} from './helpers/fake-host.ts';
const value=()=>({scene_match:true,character_match:true,usable:true,background_conflicts:[],issues:[],facts:['可见背景一','可见背景二','可见角色'],portrayal:{orientation:'three-quarter-back',action:'bend',expression:'not-visible',subjectHeightRatio:.7}});
const contract=objectContract('image-review-expressive-v1',v=>{generationContract('image-1-review',false).validate(v);validatePortrayal(v.portrayal);});
it('repairs only a known orientation alias; original output and hard rejection are preserved',()=>{
 const raw=value(),r=recoverOutput('image-1-review',raw,contract);expect(r.feedback.valid).toBe(true);expect(r.value.portrayal.orientation).toBe('three-quarter');expect(raw.portrayal.orientation).toBe('three-quarter-back');expect(r.repairs).toHaveLength(1);
 const bad=value();bad.character_match=false;const repaired=recoverOutput('image-1-review',bad,contract);expect(repaired.value.character_match).toBe(false);expect(imageAccepted(repaired.value)).toBe(false);
 const missing:any=value();delete missing.usable;expect(recoverOutput('image-1-review',missing,contract).feedback.valid).toBe(false);
 const invalid=value();invalid.portrayal.subjectHeightRatio=70;expect(recoverOutput('image-1-review',invalid,contract).feedback.valid).toBe(false);
});
it('only explicit empty history permits not-applicable novelty; decision and other scores are never raised',()=>{
 const v={reviews:[{decision:'reject',ratings:[{dimension:'novelty',score:0},{dimension:'detail',score:1}]}]};
 const c=objectContract('review',v=>{if(v.reviews[0].ratings[0].score!==null)throw Error('null required');});
 const r=recoverOutput('plan-review-1',v,c,'资料：{"history":[]}');expect(r.value.reviews[0]).toMatchObject({decision:'reject',ratings:[{score:null},{score:1}]});
 expect(recoverOutput('plan-review-1',v,c,'资料：{"history":[{}]}').feedback.valid).toBe(false);expect(recoverOutput('plan-review-1',v,c).feedback.valid).toBe(false);
});
it('wraps a bare grounding object only for one-node plans, without inventing a second item',()=>{
 const plan=shortPlan(),bare=structuredClone(plan);bare.grounding=bare.grounding[0];
 const wrapped=recoverOutput('v2-expand-1',{plan:bare},oneNodeContract);
 expect(wrapped.feedback.valid).toBe(true);expect(wrapped.repairs.join()).toContain('grounding');
 expect(Array.isArray(wrapped.value.plan.grounding)).toBe(true);expect(wrapped.value.plan.grounding).toHaveLength(1);
 expect(wrapped.value.plan.grounding[0].sourceSituation).toBe(plan.grounding[0].sourceSituation);
 expect(Array.isArray((bare as any).grounding)).toBe(false);
 const candidates=recoverOutput('short-plan-1',{candidates:[bare]},oneNodeCandidatesContract);
 expect(candidates.feedback.valid).toBe(true);expect(Array.isArray(candidates.value.candidates[0].grounding)).toBe(true);
 const two=structuredClone(shortPlan());two.grounding=[two.grounding[0],{...two.grounding[0],nodeIndex:1}];
 const noGuess=recoverOutput('v2-expand-1',{plan:two},oneNodeContract);
 expect(noGuess.feedback.valid).toBe(false);expect(noGuess.repairs).toHaveLength(0);
 const long=structuredClone(plans[0]);long.grounding=long.grounding[0];
 const rejected=recoverOutput('v2-expand-1',{plan:long},longContract);
 expect(rejected.feedback.valid).toBe(false);expect(rejected.repairs).toHaveLength(0);
 expect(rejected.feedback.errors[0].path).toBe('grounding');expect(rejected.feedback.errors[0].expected).toContain('数组');
});

it('bounded markdown JSON is accepted without guessing truncated or trailing content',()=>{
 expect(parseBoundedOutput('```json\n{"a":1}\n```')).toEqual({a:1});expect(()=>parseBoundedOutput('{"a":')).toThrow();expect(()=>parseBoundedOutput('{"a":1} explanation')).toThrow();expect(()=>parseBoundedOutput('x'.repeat(20001))).toThrow();
});
it('exhausted historical host submissions can be repaired cache-only with zero events and unchanged attempts',async()=>{
 const root=mkdtempSync(join(tmpdir(),'local-recovery-')),bridge=new HostModelBridge(root),host=new FakeHost();host.modelFacts.accepts=()=>true;bridge.attach(host);
 const payload={__postcardTask:{tripId:'old',label:'image-1-review'},__postcardOutputContract:contract.id,messages:[{content:[{type:'text',text:'saved request'}]}]};
 const id=createHash('sha256').update(JSON.stringify(payload)).digest('hex'),file=join(root,id+'.json'),raw=JSON.stringify(value());
 writeFileSync(file,JSON.stringify({id,digest:id,payload,tripId:'old',label:'image-1-review',createdAt:1,submissions:[{resultJson:raw},{resultJson:raw}]}));
 try{const r=await bridge.transport('text',payload,new AbortController().signal,{outputContract:contract,cacheOnly:true});expect(JSON.parse((r.choices as any)[0].message.content).portrayal.orientation).toBe('three-quarter');const saved=JSON.parse(readFileSync(file,'utf8'));expect(saved.submissions).toHaveLength(2);expect(saved.submissions[1].resultJson).toBe(raw);expect(saved.recovery.sourceSubmission).toBe(2);expect(host.events).toHaveLength(0);
 const noRepair=objectContract(contract.id,()=>{throw Error('hard invalid');});await expect(bridge.transport('text',payload,new AbortController().signal,{outputContract:noRepair,cacheOnly:true})).rejects.toThrow('hard invalid');expect(host.events).toHaveLength(0);
 }finally{bridge.detach();rmSync(root,{recursive:true,force:true});}
});
it('cache-only never creates a new task or wakes a model when no repair exists',async()=>{
 const root=mkdtempSync(join(tmpdir(),'no-recovery-')),bridge=new HostModelBridge(root),host=new FakeHost();host.modelFacts.accepts=()=>true;bridge.attach(host);
 try{await expect(bridge.transport('text',{__postcardTask:{tripId:'missing',label:'review'}},new AbortController().signal,{outputContract:contract,cacheOnly:true})).rejects.toThrow('暂缓交付');expect(host.events).toHaveLength(0);}finally{bridge.detach();rmSync(root,{recursive:true,force:true});}
});
