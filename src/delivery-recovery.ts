import {outputFeedback,type OutputContract} from './model-feedback.ts';

export const RECOVERY_VERSION='local-output-repair-v1';
/** One-node plans only: a bare grounding object is the single item, so wrapping it invents nothing. */
function singleNodePlans(value:any):any[]{
 const out:any[]=[],add=(v:any)=>{if(v&&typeof v==='object'&&!Array.isArray(v)&&Array.isArray(v.nodes)&&v.nodes.length===1)out.push(v)};
 if(value&&typeof value==='object'&&!Array.isArray(value)){add(value.plan);if(Array.isArray(value.candidates))value.candidates.forEach(add);add(value);}
 return out;
}
/** Only representation repairs: never invent facts, approval, identity or conflict judgments. */
export function recoverOutput(stage:string,value:any,contract:OutputContract,prompt=''){
 const original=outputFeedback(stage,contract,value);
 if(original.valid)return {value,feedback:original,repairs:[] as string[]};
 const candidate=structuredClone(value),repairs:string[]=[];
 if(candidate&&typeof candidate==='object'&&!Array.isArray(candidate)){
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
