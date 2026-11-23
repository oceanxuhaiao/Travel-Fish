import {createHash} from 'node:crypto';
import {outputFeedback,type OutputContract,type OutputFeedback} from './model-feedback.ts';

export const RECOVERY_VERSION='local-output-repair-v2';
/** Frozen-contract hints come from the saved task, never from the model's own node array. */
export interface RepairHints {nodeCount?:number;rootGroundingMove?:boolean;}
export interface DecodedOutput {value:any;feedback:OutputFeedback;repairs:string[];textHash:string;valueHash:string;}

/** One-node plans only: a bare grounding object is the single item, so wrapping it invents nothing. */
function singleNodePlans(value:any):any[]{
 const out:any[]=[],add=(v:any)=>{if(v&&typeof v==='object'&&!Array.isArray(v)&&Array.isArray(v.nodes)&&v.nodes.length===1)out.push(v)};
 if(value&&typeof value==='object'&&!Array.isArray(value)){add(value.plan);if(Array.isArray(value.candidates))value.candidates.forEach(add);add(value);}
 return out;
}
/** Scanner that understands strings, escapes and nesting; it never rewrites the inside of a string. */
function rootValueEnd(text:string):number{
 let i=0;while(i<text.length&&/\s/.test(text[i]!))i++;
 if(text[i]!=='{'&&text[i]!=='[')return -1;
 let depth=0,inString=false,escape=false;
 for(;i<text.length;i++){
  const ch=text[i]!;
  if(inString){if(escape){escape=false;continue;}if(ch==='\\'){escape=true;continue;}if(ch==='"')inString=false;continue;}
  if(ch==='"'){inString=true;continue;}
  if(ch==='{'||ch==='[')depth++;
  else if(ch==='}'||ch===']'){depth--;if(depth===0)return i+1;if(depth<0)return -1;}
 }
 return -1;
}
/** Exactly one surplus } or ] after a complete root value. Missing closers, an unclosed string, two surplus
 *  symbols, a second JSON value, trailing prose and trailing commas stay rejected. No eval, no repeated trimming. */
export function stripSurplusTail(text:string):{text:string;symbol:string}|null{
 const end=rootValueEnd(text);if(end<0)return null;
 const rest=text.slice(end),m=/^\s*([}\]])[}\]\s]*$/.exec(rest);
 if(!m)return null;
 const only=rest.replace(/\s/g,'');
 return only.length===1?{text:text.slice(0,end),symbol:only}:null;
}
function rootGroundingEligible(value:any,hints:RepairHints):boolean{
 if(!hints.rootGroundingMove||!Number.isInteger(hints.nodeCount)||(hints.nodeCount??0)<1)return false;
 if(!value||typeof value!=='object'||Array.isArray(value))return false;
 const plan=value.plan;
 if(!plan||typeof plan!=='object'||Array.isArray(plan))return false;
 if(Object.prototype.hasOwnProperty.call(plan,'grounding'))return false;
 const grounding=value.grounding;
 return Array.isArray(grounding)&&grounding.length===hints.nodeCount;
}
/** Verbatim representation move for one-plan expand stages. Conflicts, wrong counts and candidate wrappers are left alone. */
function moveRootGrounding(value:any,hints:RepairHints):boolean{
 if(!rootGroundingEligible(value,hints))return false;
 value.plan.grounding=value.grounding;delete value.grounding;return true;
}
/** Only representation repairs: never invent facts, approval, identity or conflict judgments. */
export function recoverOutput(stage:string,value:any,contract:OutputContract,prompt='',hints:RepairHints={}){
 const original=outputFeedback(stage,contract,value);
 if(original.valid&&!rootGroundingEligible(value,hints))return {value,feedback:original,repairs:[] as string[]};
 const candidate=structuredClone(value),repairs:string[]=[];
 if(candidate&&typeof candidate==='object'&&!Array.isArray(candidate)){
  if(moveRootGrounding(candidate,hints))repairs.push('grounding:根级数组→plan.grounding（仅单计划展开，原样搬移，不补造）');
  for(const plan of singleNodePlans(candidate)){
   if(plan.grounding&&typeof plan.grounding==='object'&&!Array.isArray(plan.grounding)){
    plan.grounding=[plan.grounding];repairs.push('grounding:单个对象→[对象]（单节点计划，字段与内容不变，不凭空补造第二项）');
   }
  }
  if(/^image-[12]-review$/.test(stage)&&candidate.portrayal?.orientation==='three-quarter-back'){
   candidate.portrayal.orientation='three-quarter';repairs.push('portrayal.orientation:three-quarter-back→three-quarter（合并到斜向视角类别）');
  }
  if(/^(?:plan-review|short-review)-[12]$/.test(stage)){
   const marker='资料：',at=prompt.lastIndexOf(marker);let data:any;
   try{if(at>=0)data=JSON.parse(prompt.slice(at+marker.length));}catch{}
   if(Array.isArray(data?.history)&&data.history.length===0&&Array.isArray(candidate.reviews)){
    candidate.reviews.forEach((r:any,i:number)=>{if(Array.isArray(r.ratings))r.ratings.forEach((rating:any,j:number)=>{
     if(rating?.dimension==='novelty'&&typeof rating.score==='number'&&Number.isFinite(rating.score)){
      rating.score=null;repairs.push(`reviews[${i}].ratings[${j}].score:无历史比较时记为不适用`);
     }
    });});
   }
  }
 }
 const feedback=outputFeedback(stage,contract,candidate);
 return repairs.length&&feedback.valid?{value:candidate,feedback,repairs}:{value,feedback:original,repairs:[] as string[]};
}
export function parseBoundedOutput(raw:string){
 if(typeof raw!=='string'||raw.length>20000)throw Error('JSON结果须为不超过20000字符的字符串');
 const fenced=/^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/i.exec(raw);
 return JSON.parse(fenced?fenced[1]:raw);
}
const validHash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function parseFeedback(stage:string,message:string):OutputFeedback{
 return {schemaVersion:'model-feedback-v1',stage,valid:false,validation:'structure',errors:[{code:'JSON_PARSE',path:stage,message,expected:'不超过20000字符的有效JSON（可带完整代码围栏；根值后至多一个多余括号）'}],repairInstruction:'按原规范重新输出完整JSON；本地只允许移除根值后多余的一个}或]，不补字段、不截断、不改写字符串。'};
}
/** Strict parse → one-symbol tail repair → representation recovery → full contract check. */
export function decodeAndRecover(stage:string,raw:string,contract:OutputContract,prompt='',hints:RepairHints={}):DecodedOutput{
 const textHash=createHash('sha256').update(typeof raw==='string'?raw:'').digest('hex');
 const fail=(message:string):DecodedOutput=>({value:undefined,feedback:parseFeedback(stage,message),repairs:[],textHash,valueHash:''});
 if(typeof raw!=='string')return fail('结果必须是字符串');
 if(raw.length>20000)return fail('JSON结果超过20000字符上限；不接受截断后的结果');
 const fenced=/^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/i.exec(raw);
 const inner=fenced?fenced[1]!:raw;
 let value:any,repairs:string[]=[];
 try{value=JSON.parse(inner);}
 catch{
  const stripped=stripSurplusTail(inner);
  if(!stripped)return fail('结果不是有效的有界JSON：缺少闭合、字符串未闭合、存在第二个值、尾部解释文字或两个以上多余符号');
  try{value=JSON.parse(stripped.text);}catch{return fail('移除尾部多余“'+stripped.symbol+'”后仍不是有效JSON；内部结构或尾随逗号须由模型修正');}
  repairs.push('json:移除根值后多余的一个“'+stripped.symbol+'”');
 }
 const recovered=recoverOutput(stage,value,contract,prompt,hints);
 repairs=[...repairs,...recovered.repairs];
 return {value:recovered.value,feedback:recovered.feedback,repairs,textHash,valueHash:validHash(recovered.value)};
}
