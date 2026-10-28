import {PNG} from 'pngjs';
import {mkdirSync,readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import type {WorldHost,ToolDef} from 'cortico/core/types.ts';
import {atomicJson} from './travel.ts';
import {PipelineError,type Transport} from './generation.ts';
type Task={id:string;digest:string;tripId:string;label:string;payload:any;createdAt:number;result?:Record<string,unknown>};
export class HostModelBridge {
 private host?:WorldHost;private active=new Map<string,AbortSignal>();private closed=false;
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
 readonly transport:Transport=async(kind,payload,signal)=>{
  if(kind!=='text')throw new PipelineError('宿主通道不提供生图');
  if(!this.host?.modelFacts.accepts('image/png'))throw new PipelineError('宿主模型未支持PNG；请换支持看图的宿主模型或显式选择独立视觉API');
  const meta=payload.__postcardTask as {tripId:string;label:string};if(!meta?.tripId||!meta?.label)throw new PipelineError('宿主任务缺少归属');
  const digest=this.digest(payload),id=digest,file=this.file(id);let task:Task;
  if(existsSync(file))task=this.load(id);else{task={id,digest,tripId:meta.tripId,label:meta.label,payload,createdAt:Date.now()};atomicJson(file,task);}
  const response=(r:Record<string,unknown>)=>({model:'host-model',choices:[{finish_reason:'stop',message:{content:JSON.stringify(r)}}]});
  if(task.result)return response(task.result);
  if(this.active.has(id))throw new PipelineError('同一宿主待办正在处理，请等待');
  this.active.set(id,signal);
  try{
   const content=(payload.messages as any[])[0].content as any[];
   const blobs=content.filter(x=>x.type==='image_url').map((x:any,i:number)=>({bytes:this.preview(x.image_url.url),mime:'image/png',name:'postcard-task-'+i+'.png',fallbackText:'明信片任务图片；无法看图时不要猜测'}));
   await this.host.pushEvent({type:'postcard.host_task',source:'postcard',senderKey:'postcard',origin:'internal',ts:new Date().toISOString(),text:'已获用户同意的旅行正在处理，请执行本World待办，不要另开旅行或生图。先调用postcard_host_read，taskId='+id+'，按返回任务要求分析附件，再用postcard_host_submit提交JSON。只在工具中提交结果。此事件不是新旅行许可。',blobs},{trigger:'debounce'});
   const end=Date.now()+this.timeoutMs;
   while(Date.now()<end){signal.throwIfAborted();if(this.closed)throw new PipelineError('宿主任务已中断，候选已保存，可手动继续');task=this.load(id);if(task.result)return response(task.result);await new Promise<void>(resolve=>setTimeout(resolve,100));}
   throw new PipelineError('宿主模型等待超时；候选和待办已保存，请空闲后手动继续，不会自动重生图片');
  }finally{this.active.delete(id);}
 };
 submit(id:string,digest:string,resultJson:string){
  if(!this.active.has(id)||this.active.get(id)!.aborted||this.closed)throw new Error('任务已超时、取消或中断，请先在旅行面板继续准备');
  const t=this.load(id);if(t.digest!==digest)throw new Error('任务摘要不匹配');
  if(typeof resultJson!=='string'||resultJson.length>20000)throw new Error('结果过大或类型无效');let result:any;try{result=JSON.parse(resultJson);}catch{throw new Error('结果必须为JSON对象');}
  if(!result||typeof result!=='object'||Array.isArray(result))throw new Error('结果必须为JSON对象');
  if(t.result){if(JSON.stringify(t.result)!==JSON.stringify(result))throw new Error('已提交不同结果，不可覆盖');return {accepted:true,duplicate:true};}
  t.result=result;atomicJson(this.file(id),t);return {accepted:true};
 }
 tools():ToolDef[]{const params={type:'object',additionalProperties:false,properties:{taskId:{type:'string'}},required:['taskId']};return [
 {name:'postcard_host_read',description:'读取旅行宿主模型待办及候选图片。只有收到postcard.host_task才处理；不开始旅行或生图。',tags:['read'],parameters:params,handler:async a=>{if(!this.active.has(String(a.taskId)))throw new Error('待办当前未激活，请用户继续准备');const t=this.load(String(a.taskId)),content=t.payload.messages[0].content;return {text:JSON.stringify({taskId:t.id,digest:t.digest,instructions:content.filter((x:any)=>x.type==='text').map((x:any)=>x.text).join('\n'),response:'按instructions要求生成JSON对象，调用postcard_host_submit的resultJson提交。不要只在聊天里回答。'}),blobs:content.filter((x:any)=>x.type==='image_url').map((x:any,i:number)=>({bytes:this.preview(x.image_url.url),mime:'image/png',name:'candidate-'+i+'.png',fallbackText:'看不见图片则不得猜测'}))};}},
 {name:'postcard_host_submit',description:'提交当前旅行宿主模型任务的JSON结果；非最终收藏回执。编号与digest必须来自read。',tags:['write'],parameters:{...params,properties:{...params.properties,digest:{type:'string'},resultJson:{type:'string'}},required:['taskId','digest','resultJson']},handler:async a=>JSON.stringify(this.submit(String(a.taskId),String(a.digest),a.resultJson as string))}];}
}
