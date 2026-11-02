import type {StoryPlan,StoryNode,Portrayal} from './journey-types.ts';
import {OutputValidationError} from './model-feedback.ts';
export const EMOTIONAL_GUIDANCE='每节点写emotionalBeat{before,trigger,response,after}：原先期待/心境→具体发生的小事→自己的选择或反应→此刻感受。情绪可细微，也可留下小遗憾；不强求冲突、补偿或升华。平静可以有层次，但三节点不能只是换三处景物再重复心慢下来。至少两节点有具体可辨的主动选择，情感由事件引起，不堆情绪形容词。';
export const VISUAL_GUIDANCE='每节点写visualBeat{orientation:front|side|three-quarter-back,action,expression}。三节点至少两种朝向、两种实际动作和两种神态；动作服务当前事件，表情可含蓄，不能三张都正面直立看镜头。由每节点composition决定近景、中景或远景及人物大小，不设统一人物占比；环境细节与当前景别和事件相适应。保留身份服装，不照搬参考图的姿态和脸部表情。';
export function validateExpressiveNode(node:StoryNode){
 const e=node.emotionalBeat,v=node.visualBeat;
 if(!e||!['before','trigger','response','after'].every(k=>typeof (e as any)[k]==='string'&&(e as any)[k].trim()))throw Error('emotionalBeat缺少before/trigger/response/after，需具体事件、角色反应及感受');
 if(!v||!['front','side','three-quarter-back'].includes(v.orientation)||!v.action?.trim()||!v.expression?.trim())throw Error('visualBeat须有受控orientation、具体action和expression');
}
export function validateExpressivePlan(p:StoryPlan,nodeCount=3){
 p.nodes.forEach(validateExpressiveNode);
 if(nodeCount<2)return;
 if(new Set(p.nodes.map(n=>n.visualBeat!.orientation)).size<2||new Set(p.nodes.map(n=>n.visualBeat!.action.trim())).size<2||new Set(p.nodes.map(n=>n.visualBeat!.expression.trim())).size<2)throw Error('三节点角色表现重复：至少两种朝向、动作、神态，不能只换背景');
 if(new Set(p.nodes.map(n=>n.emotionalBeat!.trigger.trim())).size<2||new Set(p.nodes.map(n=>n.emotionalBeat!.response.trim())).size<2)throw Error('情绪发展重复：不同节点须有各自具体触发与角色反应');
}
export function validatePortrayal(p:any):asserts p is Portrayal {
 const enums={orientation:['front','side','three-quarter','back','uncertain'],action:['idle','walk','sit','bend','reach','interact','other','uncertain'],expression:['neutral','curious','focused','surprised','pleased','disappointed','amused','not-visible','other','uncertain']};
 for(const [field,allowed] of Object.entries(enums))if(!p||!allowed.includes(p[field]))throw new OutputValidationError('portrayal.'+field,allowed.join('|'),'portrayal.'+field+'不在识别词表中；请按实际观察选择'+allowed.join('/')+'，看不清不要猜测');
 if(!(p.subjectHeightRatio===null||typeof p.subjectHeightRatio==='number'&&p.subjectHeightRatio>0&&p.subjectHeightRatio<=1))throw new OutputValidationError('portrayal.subjectHeightRatio','大于0且不超过1的比例或null','人物比例须为0至1比例或无法判断时null');
}
export const PORTRAYAL_INSTRUCTION='另返回portrayal{orientation:front|side|three-quarter|back|uncertain,action:idle|walk|sit|bend|reach|interact|other|uncertain,expression:neutral|curious|focused|surprised|pleased|disappointed|amused|not-visible|other|uncertain,subjectHeightRatio:含帽全身高度/画布高度的估计比例或无法判断时null}。必须报告实际看见的状态，不复述生成要求；侧背面看不到神态用not-visible。';
export function portrayalIssues(current:Portrayal,previous?:Portrayal):string[]{
 const issues:string[]=[];
 if(previous&&current.orientation!=='uncertain'&&current.action!=='uncertain'&&!['uncertain','not-visible'].includes(current.expression)&&current.orientation===previous.orientation&&current.action===previous.action&&current.expression===previous.expression)issues.push('与上一张实际朝向、动作、神态三项全部相同，请保留角色身份但改变事件相关动作或朝向与表情，不能只换背景');
 return issues;
}

export const GROUNDING_GUIDANCE='真实游记改编必须保留可辨认的处境—行动—结果，不能只抽取观察/好奇机制后发明整段经历。grounding必须是数组：每个节点在数组中放一项（短途1项、长途3项），每项{nodeIndex,motifId,sourceSituation,sourceAction,sourceResult,retained,adaptation,originalDetails:字符串数组,knowledgeClaims:[{statement,basis:source|character_guess,evidence}]}；只有一项时也须写成grounding:[{...}]，不能把单个对象直接当作grounding。motifId须属于本故事素材，并逐字复制。前三字段只写资料明确提供的内容，不从未读照片猜。retained说明保留的具体经历关系；adaptation说明虚构地点角色和跨轮调整；originalDetails标出原创物件/动作/情绪，不伪称原文。知识性因果结论只能有来源证据或明确保留为未证实猜想，禁止从鞋尖划沙等单次动作推导自然规律。三个节点应有不同的具体生活处境和行动结果，不将同一观察拆成三次伪行程；无需强塞衣食住行全套。';
export function validateGroundedPlan(p:StoryPlan,nodeCount=3){
 const g=(p as any).grounding,nodeLabel=nodeCount===1?'短途节点':'三个节点';
 if(!Array.isArray(g))throw new OutputValidationError('grounding',"数组，每节点一项：[{nodeIndex,motifId,sourceSituation,...}]；短途也必须写成[{...}]",'grounding必须是数组（现为'+(g===null?'null':Array.isArray(g)?'数组':typeof g)+'）；'+nodeLabel+'要写成grounding:[{...}]，不能把单个对象直接作为grounding');
 if(g.length!==nodeCount)throw new OutputValidationError('grounding','恰好'+nodeCount+'项（'+nodeLabel+'各一项）','grounding现有'+g.length+'项，'+nodeLabel+'须逐一覆盖真实处境、行动和结果，每节点恰好一项');
 const indices=g.map((a:any)=>a?.nodeIndex);
 if(new Set(indices).size!==nodeCount)throw new OutputValidationError('grounding.nodeIndex','1至'+nodeCount+'各出现一次','grounding的nodeIndex须对应实际节点且不重复；当前='+JSON.stringify(indices));
 g.forEach((a:any,i:number)=>{
  const path='grounding['+i+']';
  if(!a||typeof a!=='object'||Array.isArray(a))throw new OutputValidationError(path,'对象','grounding每项须为{...}对象，不能是字符串或数组');
  if(!Number.isInteger(a.nodeIndex)||a.nodeIndex<1||a.nodeIndex>nodeCount)throw new OutputValidationError(path+'.nodeIndex','1至'+nodeCount+'的整数','nodeIndex须为对应节点的整数编号');
  if(!p.motifIds.includes(a.motifId))throw new OutputValidationError(path+'.motifId',p.motifIds.join('/'),'motifId须逐字复制本故事的素材ID，不能只给编号或新造ID');
  for(const key of ['sourceSituation','sourceAction','sourceResult','retained','adaptation'])if(typeof a[key]!=='string'||!a[key].trim())throw new OutputValidationError(path+'.'+key,'非空字符串','来源映射字段缺失或为空，不能只提供素材编号');
  if(!Array.isArray(a.originalDetails)||a.originalDetails.some((x:any)=>typeof x!=='string'||!x.trim()))throw new OutputValidationError(path+'.originalDetails','字符串数组；无原创细节用[]','原创细节须为字符串数组，用于区分原文与虚构');
  if(!Array.isArray(a.knowledgeClaims))throw new OutputValidationError(path+'.knowledgeClaims','数组；无结论用[]','知识结论须为数组');
  a.knowledgeClaims.forEach((c:any,j:number)=>{
   const cp=path+'.knowledgeClaims['+j+']';
   if(!c||typeof c.statement!=='string'||!c.statement.trim())throw new OutputValidationError(cp+'.statement','非空字符串','知识结论须写明确陈述');
   if(!['source','character_guess'].includes(c.basis))throw new OutputValidationError(cp+'.basis','source|character_guess','知识结论必须说明来源证据或明确未证实的猜想');
   if(typeof c.evidence!=='string'||!c.evidence.trim())throw new OutputValidationError(cp+'.evidence','非空字符串','须给出证据，或明确说明这是原创猜想');
  });
 });
}
