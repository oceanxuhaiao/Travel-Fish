import {it,expect} from 'vitest';
import {createHash} from 'node:crypto';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {decodeAndRecover,stripSurplusTail} from '../src/delivery-recovery.ts';
import {objectContract} from '../src/model-feedback.ts';
import {validateGroundedPlan} from '../src/story-quality.ts';
import {HostModelBridge} from '../src/host-model.ts';
import {FakeHost} from './helpers/fake-host.ts';

const plans=JSON.parse(readFileSync(new URL('./fixtures/story-candidates.json',import.meta.url),'utf8'));
const longContract=objectContract('three-node-grounding-v1',v=>validateGroundedPlan(v.plan??v,3));
const nodeHint={nodeCount:3,rootGroundingMove:true};
const planText=()=>JSON.stringify({plan:structuredClone(plans[0])});
const withoutGrounding=()=>{const p=structuredClone(plans[0]);const g=p.grounding;delete (p as any).grounding;return {plan:p,grounding:g};};

it('A 严格合法JSON不变；末尾单个}或]可修复；其余尾部与超长仍拒绝',()=>{
 const good=planText(),ok=decodeAndRecover('v2-expand-1',good,longContract);
 expect(ok.feedback.valid).toBe(true);expect(ok.repairs).toEqual([]);
 const brace=decodeAndRecover('v2-expand-1',good+'}',longContract);
 expect(brace.feedback.valid).toBe(true);expect(brace.repairs.join()).toContain('多余');
 expect(brace.value).toEqual(ok.value);
 const bracket=decodeAndRecover('v2-expand-1','```json\n'+good+']\n```',longContract);
 expect(bracket.feedback.valid).toBe(true);expect(bracket.repairs.join()).toContain(']');
 const themed=structuredClone(plans[0]);themed.theme='海边的}}]发亮\\片';
 const escaped=decodeAndRecover('v2-expand-1',JSON.stringify({plan:themed})+'}',longContract);
 expect(escaped.feedback.valid).toBe(true);
 expect((escaped.value as any).plan.theme).toBe('海边的}}]发亮\\片');
 for(const raw of [good+'}}',good+']}',good+' 说明文字',good+'{"a":1}',good.slice(0,-12),'{"a":1,}']){
  const d=decodeAndRecover('v2-expand-1',raw,longContract);
  expect(d.feedback.valid,raw.slice(-12)).toBe(false);
 }
 expect(decodeAndRecover('v2-expand-1','x'.repeat(20001),longContract).feedback.valid).toBe(false);
 expect(stripSurplusTail('{"a":"}"} }')).toEqual({text:'{"a":"}"}',symbol:'}'});
 expect(stripSurplusTail('{"a":1}}}')).toBeNull();
});

it('B 根级grounding仅在单计划展开契约下原样搬移，可与尾部修复组合',()=>{
 const {plan,grounding}=withoutGrounding(),raw=JSON.stringify({plan,grounding});
 const moved=decodeAndRecover('v2-expand-1',raw,longContract,undefined,nodeHint);
 expect(moved.feedback.valid).toBe(true);expect(moved.repairs.join()).toContain('plan.grounding');
 expect((moved.value as any).plan.grounding).toEqual(grounding);
 expect((moved.value as any).grounding).toBeUndefined();
 expect((moved.value as any).plan).toEqual({...plan,grounding});
 const combined=decodeAndRecover('v2-expand-1',raw+'}',longContract,undefined,nodeHint);
 expect(combined.feedback.valid).toBe(true);expect(combined.repairs).toHaveLength(2);
 const noHint=decodeAndRecover('v2-expand-1',raw,longContract);
 expect(noHint.feedback.valid).toBe(false);expect((noHint.value as any).grounding).toEqual(grounding);
 const short=decodeAndRecover('v2-expand-1',JSON.stringify({plan,grounding:grounding.slice(0,2)}),longContract,undefined,nodeHint);
 expect(short.feedback.valid).toBe(false);
 const conflicted=JSON.stringify({plan:{...plan,grounding},grounding});
 const keep=decodeAndRecover('v2-expand-1',conflicted,longContract,undefined,nodeHint);
 expect(keep.repairs).toEqual([]);expect((keep.value as any).grounding).toEqual(grounding);
 const wrapped=decodeAndRecover('v2-expand-1',JSON.stringify({candidates:[plan],grounding}),longContract,undefined,nodeHint);
 expect(wrapped.feedback.valid).toBe(false);
});

it('C 缺项、重复nodeIndex、错误素材与无依据知识仍拒绝',()=>{
 const three=structuredClone(plans[0]);
 const dup=structuredClone(three);dup.grounding[1].nodeIndex=1;
 expect(decodeAndRecover('v2-expand-1',JSON.stringify({plan:dup}),longContract).feedback.valid).toBe(false);
 const missing=structuredClone(three);missing.grounding.pop();
 expect(decodeAndRecover('v2-expand-1',JSON.stringify({plan:missing}),longContract).feedback.valid).toBe(false);
 const motif=structuredClone(three);motif.grounding[0].motifId='not-in-story';
 expect(decodeAndRecover('v2-expand-1',JSON.stringify({plan:motif}),longContract).feedback.valid).toBe(false);
 const claim=structuredClone(three);claim.grounding[0].knowledgeClaims=[{statement:'沙纹能预测潮汐',basis:'rumour',evidence:'据说'}];
 expect(decodeAndRecover('v2-expand-1',JSON.stringify({plan:claim}),longContract).feedback.valid).toBe(false);
 const object=structuredClone(three);object.grounding=object.grounding[0];
 expect(decodeAndRecover('v2-expand-1',JSON.stringify({plan:object}),longContract).feedback.valid).toBe(false);
});

const payloadFor=(label:string)=>({model:'host-model',__postcardTask:{tripId:'one',label},__postcardOutputContract:longContract.id,messages:[{content:[{type:'text',text:'saved request'}]}]});
const savedTask=(root:string,label:string,submissions:Array<{resultJson:string}>)=>{
 const payload=payloadFor(label),id=createHash('sha256').update(JSON.stringify(payload)).digest('hex');
 writeFileSync(join(root,id+'.json'),JSON.stringify({id,digest:id,payload,tripId:'one',label,createdAt:1,submissions}));
 return {payload,id,file:join(root,id+'.json')};
};
const bridgeAt=(root:string)=>{const bridge=new HostModelBridge(root),host=new FakeHost();host.modelFacts.accepts=()=>true;bridge.attach(host);return {bridge,host};};
const cacheOnly={outputContract:longContract,cacheOnly:true,repairHints:nodeHint};

it('E 缓存回放按新→旧选择首个通过当前契约的提交，已有result优先',async()=>{
 const root=mkdtempSync(join(tmpdir(),'replay-order-')),{bridge,host}=bridgeAt(root);
 try{
  const good=JSON.stringify(withoutGrounding());
  const first=savedTask(root,'v2-expand-1',[{resultJson:good},{resultJson:'{broken'}]);
  const r=await bridge.transport('text',first.payload,new AbortController().signal,cacheOnly);
  expect((JSON.parse((r.choices as any)[0].message.content) as any).plan.grounding).toHaveLength(3);
  let disk=JSON.parse(readFileSync(first.file,'utf8'));expect(disk.recovery).toMatchObject({sourceSubmission:1,selection:'earlier-valid'});
  expect(disk.submissions).toHaveLength(2);expect(host.events).toHaveLength(0);

  const second=savedTask(root,'v2-plan',[{resultJson:'{broken'},{resultJson:JSON.stringify({plan:structuredClone(plans[0])})}]);
  const r2=await bridge.transport('text',second.payload,new AbortController().signal,{...cacheOnly,repairHints:{nodeCount:3}});
  expect((JSON.parse((r2.choices as any)[0].message.content) as any).plan.id).toBe(plans[0].id);
  disk=JSON.parse(readFileSync(second.file,'utf8'));expect(disk.recovery).toMatchObject({sourceSubmission:2,selection:'latest-valid'});

  const both=savedTask(root,'v2-plan',[{resultJson:JSON.stringify({plan:{...structuredClone(plans[0]),theme:'早'}})},{resultJson:JSON.stringify({plan:{...structuredClone(plans[0]),theme:'晚'}})}]);
  const r3=await bridge.transport('text',both.payload,new AbortController().signal,{...cacheOnly,repairHints:{nodeCount:3}});
  expect((JSON.parse((r3.choices as any)[0].message.content) as any).plan.theme).toBe('晚');
  disk=JSON.parse(readFileSync(both.file,'utf8'));expect(disk.recovery.selection).toBe('latest-valid');

  const none=savedTask(root,'v2-plan',[{resultJson:'{broken'},{resultJson:'{"a":1}'}]);
  await expect(bridge.transport('text',none.payload,new AbortController().signal,{...cacheOnly,repairHints:{nodeCount:3}})).rejects.toThrow('暂缓交付');
  expect(host.events).toHaveLength(0);

  const done=savedTask(root,'v2-plan',[]);
  const doneDisk=JSON.parse(readFileSync(done.file,'utf8'));doneDisk.result={plan:structuredClone(plans[0])};writeFileSync(done.file,JSON.stringify(doneDisk));
  const r4=await bridge.transport('text',done.payload,new AbortController().signal,{...cacheOnly,repairHints:{nodeCount:3}});
  expect((JSON.parse((r4.choices as any)[0].message.content) as any).plan.id).toBe(plans[0].id);
 }finally{bridge.detach();rmSync(root,{recursive:true,force:true});}
});

it('F 本地重放幂等：重复调用不追加提交、不改编号与预算、不发事件',async()=>{
 const root=mkdtempSync(join(tmpdir(),'replay-idem-')),{bridge,host}=bridgeAt(root);
 try{
  const good=JSON.stringify(withoutGrounding()),{payload,file,id}=savedTask(root,'v2-expand-1',[{resultJson:good}]);
  const signal=new AbortController().signal;
  await bridge.transport('text',payload,signal,cacheOnly);
  const first=readFileSync(file,'utf8');
  await bridge.transport('text',payload,signal,cacheOnly);
  const second=readFileSync(file,'utf8');
  expect(second).toBe(first);
  const disk=JSON.parse(second);expect(disk.id).toBe(id);expect(disk.digest).toBe(id);expect(disk.submissions).toHaveLength(1);expect(host.events).toHaveLength(0);
 }finally{bridge.detach();rmSync(root,{recursive:true,force:true});}
});

it('D 实时提交首次可修复即接受并仍计一次提交；语义失败不赠送次数',async()=>{
 const root=mkdtempSync(join(tmpdir(),'live-repair-'));
 const bridge=new HostModelBridge(root,1000),host=new FakeHost();host.modelFacts.accepts=()=>true;bridge.attach(host);
 try{
  const payload=payloadFor('v2-expand-1');
  const p=bridge.transport('text',payload,new AbortController().signal,{outputContract:longContract,repairHints:nodeHint});
  await new Promise(r=>setTimeout(r,5));
  const id=String(host.events[0]!.text).match(/taskId=([a-f0-9]{64})/)![1];
  const good=JSON.stringify(withoutGrounding())+'}';
  const accepted=bridge.submit(id,id,good);
  expect(accepted).toMatchObject({accepted:true,remainingSubmissions:1});
  expect(accepted.feedback.valid).toBe(true);
  const disk=JSON.parse(readFileSync(join(root,id+'.json'),'utf8'));
  expect(disk.submissions).toHaveLength(1);expect(disk.submissions[0].resultJson).toBe(good);
  expect(disk.recovery.sourceSubmission).toBe(1);expect(disk.recovery.repairs.length).toBeGreaterThan(0);
  await p;
 }finally{bridge.detach();rmSync(root,{recursive:true,force:true});}
});

it('D2 追加授权把本代提交上限提高到三次，历史计数不被清零',async()=>{
 const root=mkdtempSync(join(tmpdir(),'extra-attempts-')),{bridge,host}=bridgeAt(root);
 try{
  const payload=payloadFor('v2-expand-1');
  const p=bridge.transport('text',payload,new AbortController().signal,{outputContract:longContract,repairHints:nodeHint,extraAttempts:1});
  await new Promise(r=>setTimeout(r,5));
  const id=String(host.events[0]!.text).match(/taskId=([a-f0-9]{64})/)![1];
  expect(bridge.submit(id,id,'{"bad":true}')).toMatchObject({accepted:false,remainingSubmissions:2});
  expect(bridge.submit(id,id,'{"bad":true}')).toMatchObject({accepted:false,remainingSubmissions:1});
  const good=JSON.stringify({plan:structuredClone(plans[0])});
  expect(bridge.submit(id,id,good)).toMatchObject({accepted:true,remainingSubmissions:0});
  const disk=JSON.parse(readFileSync(join(root,id+'.json'),'utf8'));
  expect(disk.submissions).toHaveLength(3);
  await p;
 }finally{bridge.detach();rmSync(root,{recursive:true,force:true});}
});
