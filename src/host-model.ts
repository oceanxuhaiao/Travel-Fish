import {PNG} from 'pngjs';
import {mkdirSync,readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import type {WorldHost,ToolDef,RunPhase,EventEnvelope} from 'cortico/core/types.ts';
import {HostTaskObserver,type TaskTerminal} from './host-task-observer.ts';
import {atomicJson} from './travel.ts';
import {PipelineError,type Transport} from './generation.ts';
import {objectContract,outputFeedback,type OutputContract,type OutputFeedback} from './model-feedback.ts';
import {recoverOutput,parseBoundedOutput,RECOVERY_VERSION} from './delivery-recovery.ts';
type Task={id:string;digest:string;tripId:string;label:string;payload:any;createdAt:number;result?:Record<string,unknown>;submissions?:Array<{resultJson:string;feedback:OutputFeedback}>;feedback?:OutputFeedback;recovery?:{version:string;sourceSubmission:number;repairs:string[]};lifecycle?:{activation:number;deliveries:number;reads:number;queuedAt?:number;deliveredAt?:number;readAt?:number;lastProgressAt:number;state:string;responseId?:string;terminalReason?:string;terminals?:TaskTerminal[]}};
export class HostModelBridge {
 private host?:WorldHost;private active=new Map<string,AbortSignal>();private closed=false;
 private contracts=new Map<string,OutputContract>();
 private generations=new Map<string,number>();
 private observer=new HostTaskObserver(event=>queueMicrotask(()=>{
  if(this.generations.get(event.taskId)!==event.activation||!this.active.has(event.taskId))return;
  try{const task=this.load(event.taskId);if(task.result||task.lifecycle?.activation!==event.activation)return;
   task.lifecycle.state=event.reason;task.lifecycle.terminalReason=event.reason;task.lifecycle.responseId=event.responseId;task.lifecycle.lastProgressAt=event.at;
   task.lifecycle.terminals=[...(task.lifecycle.terminals??[]),event].slice(-16);atomicJson(this.file(task.id),task);
  }catch{this.host?.log.error('旅行待办终态记录失败；保留超时兜底');}
 }));
 outputTap(){return this.observer.tap;}
 onRunPhase(phase:RunPhase){this.observer.onRunPhase(phase);}
 onEventsSettled(events:readonly EventEnvelope[],outcome:'delivered'|'discarded'){
  for(const event of events){
   if(event.type!=='postcard.host_task'||event.source!=='postcard')continue;
   const id=String(event.text).match(/taskId=([a-f0-9]{64})/)?.[1],activation=id?this.generations.get(id):undefined;
   if(!id||activation===undefined)continue;
   queueMicrotask(()=>{if(this.generations.get(id)!==activation)return;try{const t=this.load(id);if(!t.lifecycle||t.result)return;
    if(outcome==='delivered')t.lifecycle.deliveredAt=Date.now();
    else{t.lifecycle.state='event_discarded';t.lifecycle.terminalReason='event_discarded';}
    t.lifecycle.lastProgressAt=Date.now();atomicJson(this.file(id),t);
   }catch{this.host?.log.error('旅行待办投递状态记录失败');}});
  }
 }
 constructor(private root:string,private timeoutMs=600000){mkdirSync(root,{recursive:true});}
 ready(){return !!this.host?.modelFacts.accepts('image/png');}
 attach(host:WorldHost){this.host=host;this.closed=false;}
 detach(){this.closed=true;this.host=undefined;}
 private file(id:string){if(!/^[a-f0-9]{64}$/.test(id))throw new Error('任务编号无效');return join(this.root,id+'.json');}
 private load(id:string):Task{const t=JSON.parse(readFileSync(this.file(id),'utf8'));if(t.id!==id||this.digest(t.payload)!==t.digest)throw new Error('宿主任务校验失败');return t;}
 private preview(url:string){
  const raw=Buffer.from(url.split(',')[1],'base64'),src=PNG.sync.read(raw),scale=Math.min(1,1024/Math.max(src.width,src.height));if(scale===1)return raw;
  const dst=new PNG({width:Math.round(src.width*scale),height:Math.round(src.height*scale)});
  for(let y=0;y<dst.height;y++)for(let x=0;x<dst.width;x++){const a=(Math.min(src.height-1,Math.floor(y/scale))*src.width+Math.min(src.width-1,Math.floor(x/scale)))*4;src.data.copy(dst.data,(y*dst.width+x)*4,a,a+4);}
  return PNG.sync.write(dst);
 }
 private digest(v:unknown){return createHash('sha256').update(JSON.stringify(v)).digest('hex');}
 readonly transport:Transport=async(kind,payload,signal,route)=>{
  if(kind!=='text')throw new PipelineError('宿主通道不提供生图');
  if(!this.host?.modelFacts.accepts('image/png'))throw new PipelineError('宿主模型未支持PNG；请换支持看图的宿主模型或显式选择独立视觉API');
  const meta=payload.__postcardTask as {tripId:string;label:string};if(!meta?.tripId||!meta?.label)throw new PipelineError('宿主任务缺少归属');
  if(route?.outputContract)payload={...payload,__postcardOutputContract:route.outputContract.id};
  const digest=this.digest(payload),id=digest,file=this.file(id);let task:Task;
  if(route?.cacheOnly&&!existsSync(file))throw new PipelineError('恢复预算已耗尽且没有可复用的宿主结果；已保存进度，暂缓交付');
  if(existsSync(file))task=this.load(id);else{task={id,digest,tripId:meta.tripId,label:meta.label,payload,createdAt:Date.now()};atomicJson(file,task);}
  const response=(r:Record<string,unknown>)=>({model:'host-model',choices:[{finish_reason:'stop',message:{content:JSON.stringify(r)}}]});
  if(task.result){route?.outputContract?.validate(task.result);return response(task.result);}
  const last=task.submissions?.at(-1);
  if(last&&route?.outputContract){
   try{const recovered=recoverOutput(task.label,parseBoundedOutput(last.resultJson),route.outputContract,task.payload.messages[0].content.filter((x:any)=>x.type==='text').map((x:any)=>x.text).join('\n'));
    if(recovered.feedback.valid&&recovered.repairs.length){task.result=recovered.value;task.recovery={version:RECOVERY_VERSION,sourceSubmission:task.submissions!.length,repairs:recovered.repairs};atomicJson(file,task);return response(task.result!);}
   }catch{/* Invalid historical output stays rejected; never spend an extra submission. */}
  }
  if(route?.cacheOnly)throw new PipelineError('恢复预算已耗尽，现有结果未通过本地修复校验；已保存进度，暂缓交付');
  if((task.submissions?.length??0)>=2)throw new PipelineError('本阶段两次结构提交已耗尽；继续准备不会增加次数，请先检查已保存反馈或决定结束原旅程，不会自动重新收费');
  if(this.active.has(id))throw new PipelineError('同一宿主待办正在处理，请等待');
  this.active.set(id,signal);
  const old=task.lifecycle;task.lifecycle={activation:(old?.activation??0)+1,deliveries:(old?.deliveries??0)+1,reads:old?.reads??0,lastProgressAt:Date.now(),state:'queued',terminals:old?.terminals};
  this.generations.set(id,task.lifecycle.activation);atomicJson(file,task);
  if(route?.outputContract)this.contracts.set(id,route.outputContract);
  try{
   const content=(payload.messages as any[])[0].content as any[];
   const blobs=content.filter(x=>x.type==='image_url').map((x:any,i:number)=>({bytes:this.preview(x.image_url.url),mime:'image/png',name:'postcard-task-'+i+'.png',fallbackText:'明信片任务图片；无法看图时不要猜测'}));
   await this.host.pushEvent({type:'postcard.host_task',source:'postcard',senderKey:'postcard',origin:'internal',ts:new Date().toISOString(),text:'已获用户明确同意的明信片制作任务（旅行或配置验证）正在处理，请执行本World待办，不要另开旅行或生图。配置验证不产生收藏或旅行；只有postcard_status/read确认后才可说已收到来信。先调用postcard_host_read，taskId='+id+'，按返回任务要求分析附件，再用postcard_host_submit提交JSON。只在工具中提交结果。此事件不是新旅行许可。',blobs},{trigger:'debounce'});
   task=this.load(id);if(task.lifecycle){task.lifecycle.queuedAt=Date.now();task.lifecycle.lastProgressAt=Date.now();atomicJson(file,task);}
   const started=Date.now(),hardEnd=started+this.timeoutMs*2;
   while(Date.now()<hardEnd){signal.throwIfAborted();if(this.closed)throw new PipelineError('宿主任务已中断，候选已保存，可手动继续');task=this.load(id);if(task.result)return response(task.result);
    if(task.lifecycle?.terminalReason==='output_truncated')throw new PipelineError((/plan|directions|selection|expand/.test(task.label)?'故事规划':'明信片文字任务')+'输出被截断（输出额度已用尽）；进度已保存，请手动继续，不会自动重画图片');
    if(task.lifecycle?.terminalReason==='output_filtered')throw new PipelineError('宿主模型未完成当前任务（内容过滤）；进度已保存，不自动重试');
    if(task.lifecycle?.terminalReason==='model_failed')throw new PipelineError('宿主模型本轮调用失败；进度已保存，请检查服务后手动继续');
    if(task.lifecycle?.terminalReason==='event_discarded')throw new PipelineError('旅行待办已从宿主队列清除；进度已保存，不自动重投');
    if((task.submissions?.length??0)>=2)throw new PipelineError('本阶段两次结构提交未通过：'+task.feedback?.errors.map(e=>e.message).join('；'));
    if(Date.now()>=(task.lifecycle?.lastProgressAt??started)+this.timeoutMs)break;
    await new Promise<void>(resolve=>setTimeout(resolve,100));}
   task=this.load(id);if(task.lifecycle){task.lifecycle.state='no_result_timeout';task.lifecycle.terminalReason='no_result_timeout';task.lifecycle.lastProgressAt=Date.now();atomicJson(file,task);}
   throw new PipelineError('宿主模型等待超时；候选和待办已保存，请空闲后手动继续，不会自动重生图片');
  }finally{this.active.delete(id);this.contracts.delete(id);this.generations.delete(id);this.observer.forget(id);}
 };
 /** Recovery hints enumerate live references only; never guess or route a submitted result. */
 private referenceError(code:string,path:string,message:string):never{
  const activeTasks:Array<{taskId:string;stage:string}>=[];
  if(!this.closed)for(const [id,signal] of this.active){
   if(signal.aborted)continue;
   try{const t=this.load(id);if(!t.result&&!t.lifecycle?.terminalReason)activeTasks.push({taskId:id,stage:t.label});}catch{/* Do not advertise unreadable tasks. */}
  }
  activeTasks.sort((a,b)=>a.taskId.localeCompare(b.taskId));
  throw Error(code+'：'+JSON.stringify({code,path,message,activeTasks:activeTasks.slice(0,8),moreActiveTasks:activeTasks.length>8,
   nextAction:activeTasks.length?'从activeTasks逐字复制taskId，先调用postcard_host_read核对该任务归属、instructions及digest，再向同一任务提交。多个任务时只处理原事件对应项；不能确定就停止，不把旧结果移交另一个任务。':'当前没有可处理的有效待办；不要自行激活或另开旅行。',
   budget:'本次编号/摘要校验失败未接受结果、未消耗结构提交次数、未延长等待或自动重投。不能据此断言原任务超时；不调用postcard_retry，不开始旅行或生图。'}));
 }
 private assertTaskActive(id:string){
  if(!/^[a-f0-9]{64}$/.test(id))this.referenceError('INVALID_TASK_ID','taskId','taskId必须是64位小写十六进制原文，当前长度='+id.length+'；可能是编号抄错，不要补写或猜测。');
  if(!this.active.has(id)||this.active.get(id)!.aborted||this.closed){
   if(!existsSync(this.file(id)))this.referenceError('UNKNOWN_TASK_ID','taskId','此编号不属于已保存待办，可能是编号抄错；这不说明原任务超时。');
   this.referenceError('TASK_NOT_ACTIVE','taskId','此编号的待办已保存但当前未激活，可能已完成、取消、超时或中断。不能据此推断其他待办状态。');
  }
 }
 submit(id:string,digest:string,resultJson:string){
  this.assertTaskActive(id);
  const t=this.load(id);if(t.digest!==digest)this.referenceError('TASK_DIGEST_MISMATCH','digest','任务摘要不匹配；必须重新read同一taskId并逐字复制digest，不要复用其他任务摘要。');
  const contract=this.contracts.get(id);
  if(contract&&!t.result){
   if((t.submissions?.length??0)>=2)throw Error('本阶段提交次数已耗尽，请查看反馈');
   let value:unknown;let parseError='';
   try{value=parseBoundedOutput(resultJson);}catch(error){parseError=error instanceof Error?error.message:'JSON格式错误';}
   const check=parseError?objectContract(contract.id,()=>{throw Error(parseError);}):contract;
   const rawFeedback=outputFeedback(t.label,check,parseError?{}:value);
   const recovered=!parseError?recoverOutput(t.label,value,contract,t.payload.messages[0].content.filter((x:any)=>x.type==='text').map((x:any)=>x.text).join('\n')):null;
   const feedback=recovered?.feedback??rawFeedback;
   t.submissions??=[];t.submissions.push({resultJson:typeof resultJson==='string'?resultJson.slice(0,20000):'',feedback:rawFeedback});t.feedback=feedback;
   if(feedback.valid){t.result=(recovered?.value??value) as Record<string,unknown>;if(t.lifecycle){t.lifecycle.state='submitted';delete t.lifecycle.terminalReason;t.lifecycle.lastProgressAt=Date.now();}}
   if(recovered?.repairs.length)t.recovery={version:RECOVERY_VERSION,sourceSubmission:t.submissions.length,repairs:recovered.repairs};
   atomicJson(this.file(id),t);
   return {accepted:feedback.valid,feedback,remainingSubmissions:2-t.submissions.length,nextAction:feedback.valid?'等待后续业务评审与交付回执':t.submissions.length<2?'按反馈修正后向同一任务重新提交':'停止提交，保留结果待用户处理'};
  }
  if(typeof resultJson!=='string'||resultJson.length>20000)throw new Error('结果过大或类型无效');let result:any;try{result=JSON.parse(resultJson);}catch{throw new Error('结果必须为JSON对象');}
  if(!result||typeof result!=='object'||Array.isArray(result))throw new Error('结果必须为JSON对象');
  if(t.result){if(JSON.stringify(t.result)!==JSON.stringify(result))throw new Error('已提交不同结果，不可覆盖');return {accepted:true,duplicate:true,feedback:t.feedback??outputFeedback(t.label,objectContract('json-object-v1'),result)};}
  t.result=result;t.feedback=outputFeedback(t.label,objectContract('json-object-v1'),result);if(t.lifecycle){t.lifecycle.state='submitted';delete t.lifecycle.terminalReason;t.lifecycle.lastProgressAt=Date.now();}atomicJson(this.file(id),t);return {accepted:true,feedback:t.feedback};
 }
 tools():ToolDef[]{const params={type:'object',additionalProperties:false,properties:{taskId:{type:'string'}},required:['taskId']};return [
 {name:'postcard_host_read',description:'读取旅行宿主模型待办及候选图片。只有收到postcard.host_task才处理；编号错误时按回执activeTasks核对并重新read，不推断原任务超时，不开始旅行或生图。',tags:['read'],parameters:params,handler:async a=>{this.assertTaskActive(String(a.taskId));const t=this.load(String(a.taskId)),content=t.payload.messages[0].content;if(t.lifecycle){t.lifecycle.reads++;t.lifecycle.readAt=Date.now();t.lifecycle.lastProgressAt=Date.now();t.lifecycle.state='read';atomicJson(this.file(t.id),t);this.observer.read(t.id,t.lifecycle.activation);}return {text:JSON.stringify({taskId:t.id,digest:t.digest,feedback:t.feedback??null,remainingSubmissions:2-(t.submissions?.length??0),instructions:content.filter((x:any)=>x.type==='text').map((x:any)=>x.text).join('\n'),response:'按instructions要求生成JSON对象，调用postcard_host_submit的resultJson提交。不要只在聊天里回答。submit的accepted仅表示结构校验；若返回accepted=false，依反馈在remainingSubmissions范围内向同一任务修正提交，耗尽即停。'}),blobs:content.filter((x:any)=>x.type==='image_url').map((x:any,i:number)=>({bytes:this.preview(x.image_url.url),mime:'image/png',name:'candidate-'+i+'.png',fallbackText:'看不见图片则不得猜测'}))};}},
 {name:'postcard_host_submit',description:'提交当前旅行宿主模型任务的JSON结果；非最终收藏回执。编号与digest必须逐字复制read；编号错误回执仅供找回引用，不能把旧结果改投其他任务。',tags:['write'],parameters:{...params,properties:{...params.properties,digest:{type:'string'},resultJson:{type:'string'}},required:['taskId','digest','resultJson']},handler:async a=>JSON.stringify(this.submit(String(a.taskId),String(a.digest),a.resultJson as string))}];}
}
