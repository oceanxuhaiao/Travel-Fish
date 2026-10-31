import {PNG} from 'pngjs';
import {mkdirSync,readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import type {WorldHost,ToolDef} from 'cortico/core/types.ts';
import {atomicJson} from './travel.ts';
import {PipelineError,type Transport} from './generation.ts';
import {objectContract,outputFeedback,type OutputContract,type OutputFeedback} from './model-feedback.ts';
type Task={id:string;digest:string;tripId:string;label:string;payload:any;createdAt:number;result?:Record<string,unknown>;submissions?:Array<{resultJson:string;feedback:OutputFeedback}>;feedback?:OutputFeedback};
export class HostModelBridge {
 private host?:WorldHost;private active=new Map<string,AbortSignal>();private closed=false;
 private contracts=new Map<string,OutputContract>();
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
  if(existsSync(file))task=this.load(id);else{task={id,digest,tripId:meta.tripId,label:meta.label,payload,createdAt:Date.now()};atomicJson(file,task);}
  const response=(r:Record<string,unknown>)=>({model:'host-model',choices:[{finish_reason:'stop',message:{content:JSON.stringify(r)}}]});
  if(task.result){route?.outputContract?.validate(task.result);return response(task.result);}
  if((task.submissions?.length??0)>=2)throw new PipelineError('本阶段两次结构提交已耗尽；请查看已保存反馈，不会自动重新收费');
  if(this.active.has(id))throw new PipelineError('同一宿主待办正在处理，请等待');
  this.active.set(id,signal);
  if(route?.outputContract)this.contracts.set(id,route.outputContract);
  try{
   const content=(payload.messages as any[])[0].content as any[];
   const blobs=content.filter(x=>x.type==='image_url').map((x:any,i:number)=>({bytes:this.preview(x.image_url.url),mime:'image/png',name:'postcard-task-'+i+'.png',fallbackText:'明信片任务图片；无法看图时不要猜测'}));
   await this.host.pushEvent({type:'postcard.host_task',source:'postcard',senderKey:'postcard',origin:'internal',ts:new Date().toISOString(),text:'已获用户明确同意的明信片制作任务（旅行或配置验证）正在处理，请执行本World待办，不要另开旅行或生图。配置验证不产生收藏或旅行；只有postcard_status/read确认后才可说已收到来信。先调用postcard_host_read，taskId='+id+'，按返回任务要求分析附件，再用postcard_host_submit提交JSON。只在工具中提交结果。此事件不是新旅行许可。',blobs},{trigger:'debounce'});
   const end=Date.now()+this.timeoutMs;
   while(Date.now()<end){signal.throwIfAborted();if(this.closed)throw new PipelineError('宿主任务已中断，候选已保存，可手动继续');task=this.load(id);if(task.result)return response(task.result);if((task.submissions?.length??0)>=2)throw new PipelineError('本阶段两次结构提交未通过：'+task.feedback?.errors.map(e=>e.message).join('；'));await new Promise<void>(resolve=>setTimeout(resolve,100));}
   throw new PipelineError('宿主模型等待超时；候选和待办已保存，请空闲后手动继续，不会自动重生图片');
  }finally{this.active.delete(id);this.contracts.delete(id);}
 };
 submit(id:string,digest:string,resultJson:string){
  if(!/^[a-f0-9]{64}$/.test(id))throw new Error('INVALID_TASK_ID：taskId必须是64位小写十六进制原文，当前长度='+id.length+'。请逐字复制本任务postcard_host_read或原事件返回的taskId，不要拼接或改写；这不表示原任务已超时，不要另开旅行或生图。');
  if(!this.active.has(id)||this.active.get(id)!.aborted||this.closed)throw new Error('TASK_NOT_ACTIVE：提交的taskId当前未激活，可能是编号抄错、超时、取消或中断；不能仅据此断言原任务已超时。先核对原事件/read中的完整编号；确实中断才请用户在旅行面板继续准备，不自行重试旅行或生图。');
  const t=this.load(id);if(t.digest!==digest)throw new Error('任务摘要不匹配');
  const contract=this.contracts.get(id);
  if(contract&&!t.result){
   if((t.submissions?.length??0)>=2)throw Error('本阶段提交次数已耗尽，请查看反馈');
   let value:unknown;let parseError='';
   try{if(typeof resultJson!=='string'||resultJson.length>20000)throw Error('JSON结果须为不超过20000字符的字符串');value=JSON.parse(resultJson);}catch(error){parseError=error instanceof Error?error.message:'JSON格式错误';}
   const check=parseError?objectContract(contract.id,()=>{throw Error(parseError);}):contract;
   const feedback=outputFeedback(t.label,check,parseError?{}:value);
   t.submissions??=[];t.submissions.push({resultJson:typeof resultJson==='string'?resultJson.slice(0,20000):'',feedback});t.feedback=feedback;
   if(feedback.valid)t.result=value as Record<string,unknown>;
   atomicJson(this.file(id),t);
   return {accepted:feedback.valid,feedback,remainingSubmissions:2-t.submissions.length,nextAction:feedback.valid?'等待后续业务评审与交付回执':t.submissions.length<2?'按反馈修正后向同一任务重新提交':'停止提交，保留结果待用户处理'};
  }
  if(typeof resultJson!=='string'||resultJson.length>20000)throw new Error('结果过大或类型无效');let result:any;try{result=JSON.parse(resultJson);}catch{throw new Error('结果必须为JSON对象');}
  if(!result||typeof result!=='object'||Array.isArray(result))throw new Error('结果必须为JSON对象');
  if(t.result){if(JSON.stringify(t.result)!==JSON.stringify(result))throw new Error('已提交不同结果，不可覆盖');return {accepted:true,duplicate:true,feedback:t.feedback??outputFeedback(t.label,objectContract('json-object-v1'),result)};}
  t.result=result;t.feedback=outputFeedback(t.label,objectContract('json-object-v1'),result);atomicJson(this.file(id),t);return {accepted:true,feedback:t.feedback};
 }
 tools():ToolDef[]{const params={type:'object',additionalProperties:false,properties:{taskId:{type:'string'}},required:['taskId']};return [
 {name:'postcard_host_read',description:'读取旅行宿主模型待办及候选图片。只有收到postcard.host_task才处理；不开始旅行或生图。',tags:['read'],parameters:params,handler:async a=>{if(!this.active.has(String(a.taskId)))throw new Error('待办当前未激活，请用户继续准备');const t=this.load(String(a.taskId)),content=t.payload.messages[0].content;return {text:JSON.stringify({taskId:t.id,digest:t.digest,feedback:t.feedback??null,remainingSubmissions:2-(t.submissions?.length??0),instructions:content.filter((x:any)=>x.type==='text').map((x:any)=>x.text).join('\n'),response:'按instructions要求生成JSON对象，调用postcard_host_submit的resultJson提交。不要只在聊天里回答。submit的accepted仅表示结构校验；若返回accepted=false，依反馈在remainingSubmissions范围内向同一任务修正提交，耗尽即停。'}),blobs:content.filter((x:any)=>x.type==='image_url').map((x:any,i:number)=>({bytes:this.preview(x.image_url.url),mime:'image/png',name:'candidate-'+i+'.png',fallbackText:'看不见图片则不得猜测'}))};}},
 {name:'postcard_host_submit',description:'提交当前旅行宿主模型任务的JSON结果；非最终收藏回执。编号与digest必须来自read。',tags:['write'],parameters:{...params,properties:{...params.properties,digest:{type:'string'},resultJson:{type:'string'}},required:['taskId','digest','resultJson']},handler:async a=>JSON.stringify(this.submit(String(a.taskId),String(a.digest),a.resultJson as string))}];}
}
