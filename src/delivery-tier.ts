import type {StoryPlan} from './journey-types.ts';

/** Bumped when the wording or set of soft items changes, so old notes are never silently reinterpreted. */
export const DELIVERY_TIER_VERSION='delivery-tier-v1';

export type SoftItem='S1'|'S2'|'S3';
export interface DegradedNote {soft:SoftItem;stage:string;detail:string;dimension?:string;score?:number;}
export interface DeliveryTier {tier:'standard'|'degraded';notes:DegradedNote[];}
export interface ReviewTier {accepted:string[];degraded:Array<{candidateId:string;notes:DegradedNote[]}>;blocked:Array<{candidateId:string;reasons:string[]}>;}

const LABEL:Record<string,string>={detail:'细节偏少',agency:'角色缺少具体主动选择',connection:'事件到感受的推进偏弱',standalone_payoff:'这一次的收获偏淡',visual:'画面表现偏平',novelty:'与近期故事差异有限',naturalness:'反应或语气略显生硬'};
const MAX_REASON=80;
const clip=(value:unknown)=>typeof value==='string'?[...value.trim()].slice(0,MAX_REASON).join(''):'';

/** One note per low-scoring dimension. Novelty is its own soft item: structure duplication still blocks separately. */
export function scoreNote(dimension:string,score:number,reason?:unknown,stage='story-review'):DegradedNote {
 const novelty=dimension==='novelty';
 const basis=clip(reason);
 return {soft:novelty?'S2':'S1',stage,dimension,score,
  detail:(novelty?'与近期故事的新意评分偏低（':'评分偏低（')+score+'/3，2 分为具体自然可用）：'+(basis||LABEL[dimension]||'该维度偏弱')+(novelty?'；结构重复仍会阻断，不会因接受普通成品而放行换皮故事':'；已按可接受瑕疵交付，未调高评分')};
}

/**
 * Business tiering of a seven-dimension review. Structural validation stays in validateStoryReview;
 * this only decides whether a pass is clean, degraded-but-usable, or still blocked.
 * Rule issues are never degraded: they cover fabricated sources, unsupported knowledge and impossible continuity.
 */
export function assessStoryReview(review:any,plans:StoryPlan[]):ReviewTier {
 const accepted:string[]=[],degraded:ReviewTier['degraded']=[],blocked:ReviewTier['blocked']=[];
 const reviews=Array.isArray(review?.reviews)?review.reviews:[];
 for(const r of reviews){
  const plan=plans.find(p=>p.id===r?.candidateId);
  if(!plan)throw Error('故事评审引用了不存在的候选');
  if(Array.isArray(r.ruleIssues)&&r.ruleIssues.length){blocked.push({candidateId:plan.id,reasons:r.ruleIssues.map((x:unknown)=>String(x))});continue;}
  const low=(Array.isArray(r.ratings)?r.ratings:[]).filter((x:any)=>x&&x.dimension!=='novelty'&&typeof x.score==='number'&&x.score<2);
  const novelty=(Array.isArray(r.ratings)?r.ratings:[]).find((x:any)=>x&&x.dimension==='novelty');
  const lowNovelty=!!novelty&&typeof novelty.score==='number'&&novelty.score<2;
  if(r.decision==='pending'){blocked.push({candidateId:plan.id,reasons:['评审未给出结论（pending），不能当作通过']});continue;}
  if(r.decision==='reject'){blocked.push({candidateId:plan.id,reasons:['评审结论为拒绝，且未列出可降级的软性问题']});continue;}
  if(r.decision==='accept'&&!low.length&&!lowNovelty){accepted.push(plan.id);continue;}
  if(r.decision==='accept'||r.decision==='revise'){
   const notes:DegradedNote[]=[...low.map((x:any)=>scoreNote(x.dimension,x.score,x.reason)),...(lowNovelty?[scoreNote('novelty',novelty.score,novelty.reason)]:[])];
   if(notes.length){degraded.push({candidateId:plan.id,notes});continue;}
  }
  blocked.push({candidateId:plan.id,reasons:['评审未通过，但没有可记录的软性项；不能只把结论改成通过']});
 }
 return {accepted,degraded,blocked};
}

/** Expressive repetition is a soft item: keep the delivered moment, label it, never fabricate new beats. */
export function repetitionNotes(issues:string[],stage='story-review'):DegradedNote[] {
 return issues.map(issue=>({soft:'S3' as const,stage,detail:issue+'；已按可接受瑕疵交付，角色身份与图文矛盾仍会阻断'}));
}

export function mergeNotes(...groups:DegradedNote[][]):DegradedNote[] {
 const seen=new Set<string>(),result:DegradedNote[]=[];
 for(const note of groups.flat()){
  const key=[note.soft,note.stage,note.dimension??'',note.detail].join('|');
  if(seen.has(key))continue;seen.add(key);result.push(note);
 }
 return result;
}

export function tierOf(notes:DegradedNote[]):DeliveryTier {return {tier:notes.length?'degraded':'standard',notes};}

/** Validates the persisted tier file; a hash mismatch means the plan changed and the note no longer applies. */
export function parseDeliveryTier(value:unknown,planHash:string):DeliveryTier {
 const v=value as any;
 if(!v||v.schema!==1||v.version!==DELIVERY_TIER_VERSION||v.planHash!==planHash||!['standard','degraded'].includes(v.tier)||!Array.isArray(v.notes))return {tier:'standard',notes:[]};
 const notes=v.notes.filter((n:any)=>n&&['S1','S2','S3'].includes(n.soft)&&typeof n.detail==='string'&&typeof n.stage==='string').map((n:any)=>({soft:n.soft,stage:n.stage,detail:[...n.detail].slice(0,300).join(''),...(typeof n.dimension==='string'?{dimension:n.dimension}:{}),...(typeof n.score==='number'?{score:n.score}:{})}));
 if(v.tier==='degraded'&&!notes.length)return {tier:'standard',notes:[]};
 return {tier:v.tier,notes};
}
