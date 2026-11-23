import {createHash} from 'node:crypto';
import {existsSync,readFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import type {Trip} from './travel.ts';
import {decodeAndRecover,RECOVERY_VERSION} from './delivery-recovery.ts';
import {objectContract} from './model-feedback.ts';
import {decodePng} from './generation.ts';

export const RECOVERY_AUDIT_VERSION='local-recovery-audit-v1';

export interface StageFinding {stage:string;source:'prepared'|'image'|'story'|'host';reusable:boolean;
 /** True only when this finding can actually release the stage that is currently blocking the trip. */
 unblocks:boolean;detail:string;}
export interface RecoveryQualification {
 version:typeof RECOVERY_AUDIT_VERSION;recoveryVersion:string;tripId:string;status:string;blockingStage:string|null;
 verdict:'reusable'|'needs_grant'|'no_local_result';localModelCalls:0;stages:StageFinding[];notes:string[];
}

const AUDIT_CONTRACT=objectContract('recovery-audit-object-v1',value=>{
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('本地缓存不是JSON对象');
});
const sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
const listJson=(folder:string):string[]=>{try{return readdirSync(folder).filter(name=>name.endsWith('.json'));}catch{return [];}};
const skip=(name:string)=>/(-feedback|-local-recovery|-issues|-invalid|-outcome|-request|-response|delivery-tier|checkpoint|artifact)\.json$/.test(name);
/** Cheap shape gate before claiming a local candidate: an object with the expected stage container, not an arbitrary blob. */
const plausible=(value:any):boolean=>!!value&&typeof value==='object'&&(Array.isArray(value.nodes)||Array.isArray(value.plan?.nodes)||!!value.node||Array.isArray(value.reviews)||Array.isArray(value.directions)||Array.isArray(value.assessments)||Array.isArray(value.candidates)||Array.isArray(value.paragraphs));

/**
 * Read-only eligibility re-check for an already failed trip. It never calls a model, never writes a file and never
 * changes the trip, so an old "not recoverable" verdict can be revised by a newer local repairer at any time.
 * A finding only "unblocks" when it belongs to the stage that actually failed: an earlier stage's cached result
 * cannot promise that the blocking stage will pass, so it never decides the verdict on its own.
 */
export function qualifyLocalRecovery(root:string,trip:Readonly<Trip>):RecoveryQualification {
 const stages:StageFinding[]=[],notes:string[]=[];
 const blocked=trip.failure?.stage??null;
 const unblocks=(source:StageFinding['source'],name:string):boolean=>{
  if(!blocked)return true;
  if(source==='prepared')return trip.prepareDuringTravel===true;
  if(name===blocked)return true;
  if(blocked==='image'&&source==='image')return true;
  if(blocked==='note'&&/-note-\d+$/.test(name))return true;
  return false;
 };
 const tripFolder=join(root,'trips',trip.contentId??trip.id);
 const preparedFolder=join(root,'prepared',trip.id);

 const artifactFile=join(preparedFolder,'artifact.json');
 if(existsSync(artifactFile)){
  let reusable=false;
  try{const meta=JSON.parse(readFileSync(artifactFile,'utf8')),image=readFileSync(join(preparedFolder,'postcard.png'));
   decodePng(image);reusable=meta.sha256===sha(image)&&typeof meta.title==='string'&&typeof meta.note==='string';
  }catch{reusable=false;}
  stages.push({stage:'prepared-artifact',source:'prepared',reusable,unblocks:unblocks('prepared','prepared-artifact'),detail:reusable?'已保存待交付成品，校验哈希一致，可直接入藏而不重新生成':'待交付成品损坏或哈希不符，不能直接复用'});
 }

 const imageFiles=(()=>{try{return readdirSync(tripFolder).filter(name=>/^image-\d+\.png$/.test(name)).sort();}catch{return [];}})();
 for(const name of imageFiles){
  const index=name.slice('image-'.length,-'.png'.length);
  const file=join(tripFolder,name);
  const rejected=existsSync(join(tripFolder,'image-'+index+'-rejected.json'));
  let reusable=!rejected;
  try{const image=readFileSync(file),manifest=join(file+'.json');decodePng(image);if(!existsSync(manifest)||JSON.parse(readFileSync(manifest,'utf8')).sha256!==sha(image))reusable=false;}
  catch{reusable=false;}
  stages.push({stage:'image-'+index,source:'image',reusable,unblocks:unblocks('image','image-'+index),detail:reusable?'本地候选图可解码且哈希一致，重试会先复用，不重新生图':rejected?'这张候选图曾被审核判为不合格；自动流程不会拿它交付':'本地候选图损坏或缺少哈希清单'});
 }

 const owner=trip.series?.id??trip.id,storyFolder=join(root,'journey-tasks',owner);
 for(const name of listJson(storyFolder)){
  if(skip(name))continue;
  let value:any;
  try{value=JSON.parse(readFileSync(join(storyFolder,name),'utf8'));}catch{continue;}
  if(!value||typeof value!=='object')continue;
  const label=name.replace(/\.json$/,'');
  for(const [field,source] of [['response','已保存的通过结果'],['rejectedResponse','曾被拒的原始提交']] as const){
   if(value[field]===undefined)continue;
   const decoded=decodeAndRecover(label,JSON.stringify(value[field]),AUDIT_CONTRACT);
   const usable=decoded.feedback.valid&&plausible(value[field]);
   stages.push({stage:label,source:'story',reusable:usable,unblocks:unblocks('story',label),detail:decoded.feedback.valid?source+'可在本地重新复验，重试会先复用且不新增调用':source+'在当前修复规则下仍不可读，需要新的模型调用或显式追加'});
  }
 }

 for(const name of listJson(join(root,'host-tasks'))){
  if(!/^[a-f0-9]{64}\.json$/.test(name))continue;
  let task:any;
  try{task=JSON.parse(readFileSync(join(root,'host-tasks',name),'utf8'));}catch{continue;}
  // A host task is owned either by the trip itself (image/note stages) or by the journey (story stages).
  if(!task||(task.tripId!==trip.id&&task.tripId!==owner))continue;
  if(task.result){
   const decoded=decodeAndRecover(task.label,JSON.stringify(task.result),AUDIT_CONTRACT);
   const usable=decoded.feedback.valid&&plausible(task.result);
   stages.push({stage:task.label,source:'host',reusable:usable,unblocks:unblocks('host',task.label),detail:decoded.feedback.valid?'已有宿主结果可在本地复验，重试不会重新发起宿主任务':'已有宿主结果已损坏，不能当作原结果复用'});
   continue;
  }
  const submissions=Array.isArray(task.submissions)?task.submissions:[];
  const readable=submissions.filter((s:any)=>typeof s?.resultJson==='string'&&decodeAndRecover(task.label,s.resultJson,AUDIT_CONTRACT).feedback.valid).length;
  if(submissions.length)stages.push({stage:task.label,source:'host',reusable:readable>0,unblocks:unblocks('host',task.label),detail:readable?submissions.length+' 次原始提交中有 '+readable+' 次可在本地重新复验，重试会先复用且不新增宿主调用':submissions.length+' 次原始提交在当前修复规则下都不可读'});
 }

 const reusable=stages.filter(s=>s.reusable).length,releasing=stages.filter(s=>s.reusable&&s.unblocks).length;
 if(reusable)notes.push('找到 '+reusable+' 处本地候选，其中 '+releasing+' 处对应当前失败阶段'+(blocked?'（'+blocked+'）':'')+'；已交付卡片、候选图和计数都不会被清零。');
 if(reusable&&!releasing)notes.push('这些候选属于其他阶段，不能解除当前阻塞；它们不会被当作当前阶段已通过的证据。');
 notes.push('本次核查只读本地文件：没有调用模型、没有发起生图、没有改变旅行状态与预算。');
 notes.push('本地候选不等于当前阶段一定能通过：真正的复验要按该阶段完整契约执行，不通过时不会伪装成通过；可以先做一次不产生调用的本地修复，仍不够再追加授权。');
 const verdict:RecoveryQualification['verdict']=releasing?'reusable':trip.failure?.kind==='budget_exhausted'?'needs_grant':'no_local_result';
 return {version:RECOVERY_AUDIT_VERSION,recoveryVersion:RECOVERY_VERSION,tripId:trip.id,status:String(trip.status),blockingStage:blocked,verdict,localModelCalls:0,stages,notes};
}
