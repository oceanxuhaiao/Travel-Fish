import type {StoryPlan,StoryNode,Portrayal} from './journey-types.ts';
export const EMOTIONAL_GUIDANCE='每节点写emotionalBeat{before,trigger,response,after}：原先期待/心境→具体发生的小事→自己的选择或反应→此刻感受。情绪可细微，也可留下小遗憾；不强求冲突、补偿或升华。平静可以有层次，但三节点不能只是换三处景物再重复心慢下来。至少两节点有具体可辨的主动选择，情感由事件引起，不堆情绪形容词。';
export const VISUAL_GUIDANCE='每节点写visualBeat{orientation:front|side|three-quarter-back,action,expression}。三节点至少两种朝向、两种实际动作和两种神态；动作服务当前事件，表情可含蓄，不能三张都正面直立看镜头。由每节点composition决定近景、中景或远景及人物大小，不设统一人物占比；环境细节与当前景别和事件相适应。保留身份服装，不照搬参考图的姿态和脸部表情。';
export function validateExpressiveNode(node:StoryNode){
 const e=node.emotionalBeat,v=node.visualBeat;
 if(!e||!['before','trigger','response','after'].every(k=>typeof (e as any)[k]==='string'&&(e as any)[k].trim()))throw Error('emotionalBeat缺少before/trigger/response/after，需具体事件、角色反应及感受');
 if(!v||!['front','side','three-quarter-back'].includes(v.orientation)||!v.action?.trim()||!v.expression?.trim())throw Error('visualBeat须有受控orientation、具体action和expression');
}
export function validateExpressivePlan(p:StoryPlan){
 p.nodes.forEach(validateExpressiveNode);
 if(new Set(p.nodes.map(n=>n.visualBeat!.orientation)).size<2||new Set(p.nodes.map(n=>n.visualBeat!.action.trim())).size<2||new Set(p.nodes.map(n=>n.visualBeat!.expression.trim())).size<2)throw Error('三节点角色表现重复：至少两种朝向、动作、神态，不能只换背景');
 if(new Set(p.nodes.map(n=>n.emotionalBeat!.trigger.trim())).size<2||new Set(p.nodes.map(n=>n.emotionalBeat!.response.trim())).size<2)throw Error('情绪发展重复：不同节点须有各自具体触发与角色反应');
}
export function validatePortrayal(p:any):asserts p is Portrayal {
 if(!p||!['front','side','three-quarter','back','uncertain'].includes(p.orientation)||!['idle','walk','sit','bend','reach','interact','other','uncertain'].includes(p.action)||!['neutral','curious','focused','surprised','pleased','disappointed','amused','not-visible','other','uncertain'].includes(p.expression)||!(p.subjectHeightRatio===null||typeof p.subjectHeightRatio==='number'&&p.subjectHeightRatio>0&&p.subjectHeightRatio<=1))throw Error('portrayal须按约定枚举报告真实朝向/动作/神态，subjectHeightRatio为0至1比例或无法判断时null');
}
export const PORTRAYAL_INSTRUCTION='另返回portrayal{orientation:front|side|three-quarter|back|uncertain,action:idle|walk|sit|bend|reach|interact|other|uncertain,expression:neutral|curious|focused|surprised|pleased|disappointed|amused|not-visible|other|uncertain,subjectHeightRatio:含帽全身高度/画布高度的估计比例或无法判断时null}。必须报告实际看见的状态，不复述生成要求；侧背面看不到神态用not-visible。';
export function portrayalIssues(current:Portrayal,previous?:Portrayal):string[]{
 const issues:string[]=[];
 if(previous&&current.orientation!=='uncertain'&&current.action!=='uncertain'&&!['uncertain','not-visible'].includes(current.expression)&&current.orientation===previous.orientation&&current.action===previous.action&&current.expression===previous.expression)issues.push('与上一张实际朝向、动作、神态三项全部相同，请保留角色身份但改变事件相关动作或朝向与表情，不能只换背景');
 return issues;
}

export const GROUNDING_GUIDANCE='真实游记改编必须保留可辨认的处境—行动—结果，不能只抽取观察/好奇机制后发明整段经历。每节点给grounding一项{nodeIndex,motifId,sourceSituation,sourceAction,sourceResult,retained,adaptation,originalDetails:字符串数组,knowledgeClaims:[{statement,basis:source|character_guess,evidence}]}。motifId须属于本故事素材。前三字段只写资料明确提供的内容，不从未读照片猜。retained说明保留的具体经历关系；adaptation说明虚构地点角色和跨轮调整；originalDetails标出原创物件/动作/情绪，不伪称原文。知识性因果结论只能有来源证据或明确保留为未证实猜想，禁止从鞋尖划沙等单次动作推导自然规律。三个节点应有不同的具体生活处境和行动结果，不将同一观察拆成三次伪行程；无需强塞衣食住行全套。';
export function validateGroundedPlan(p:StoryPlan){
 const g=p.grounding;
 if(!Array.isArray(g)||g.length!==3||new Set(g.map(a=>a.nodeIndex)).size!==3)throw Error('grounding须逐一覆盖三个节点的真实处境、行动和结果');
 for(const a of g){
  if(![1,2,3].includes(a.nodeIndex)||!p.motifIds.includes(a.motifId)||!['sourceSituation','sourceAction','sourceResult','retained','adaptation'].every(k=>typeof (a as any)[k]==='string'&&(a as any)[k].trim())||!Array.isArray(a.originalDetails)||a.originalDetails.some(x=>typeof x!=='string'||!x.trim())||!Array.isArray(a.knowledgeClaims))throw Error('grounding来源映射不完整，不能只提供素材编号');
  for(const c of a.knowledgeClaims)if(!c.statement?.trim()||!['source','character_guess'].includes(c.basis)||!c.evidence?.trim())throw Error('知识结论必须说明来源证据或明确未证实的猜想');
 }
}
