import {PNG} from 'pngjs';
import {existsSync,mkdirSync,readFileSync} from 'node:fs';
import {join} from 'node:path';import {createHash} from 'node:crypto';
import {atomicJson,type TravelStore,type TravelService} from './travel.ts';import type {Transport} from './generation.ts';
import {objectContract,decisionContract,type OutputContract} from './model-feedback.ts';
import {validatePaperObservations} from './visible-state.ts';import {validatePlan} from './story.ts';
import {validateExpressivePlan,validateGroundedPlan} from './story-quality.ts';
/** Explicitly enabled local developer harness. It only asks the host for text on saved cards. */
export class DevelopmentValidation {
 private flight?:Promise<void>;private controller?:AbortController;
 constructor(private root:string,private store:TravelStore,private transport:Transport){}
 private path(id:string,suffix:string){if(!/^[a-z0-9-]{1,70}$/.test(id))throw Error('验证编号无效');return join(this.root,id+suffix+'.json');}
 startClock(service:TravelService,sourceId:string){
  if(service.roundMinutes!==120)throw Error('正式计时复验必须为120分钟');
  const card=this.store.card(sourceId);if(!card)throw Error('只能复用已入藏卡');const image=readFileSync(join(this.store.collection,sourceId,'postcard.png'));
  if(createHash('sha256').update(image).digest('hex')!==card.sha256)throw Error('源图哈希异常');
  if(existsSync(join(this.root,'formal-clock.json')))throw Error('正式计时复验已有记录，不重置计时');
  const trip=service.start('surprise',120);this.store.stageArtifact(trip,{image,title:'开发验证·正式两小时交付',note:'正式两小时计时复验，复用既有图片与成品，不是新增旅行经历或新图。',generation:{development:true,sourceTripId:sourceId,sourceImageHash:card.sha256}});
  mkdirSync(this.root,{recursive:true});const result={tripId:trip.id,sourceTripId:sourceId,startedAt:trip.startedAt,dueAt:trip.dueAt,configuredWaitMs:trip.dueAt-trip.startedAt,newImageCalls:0};atomicJson(join(this.root,'formal-clock.json'),result);return result;
 }
 status(id:string){const file=this.path(id,'-result');return existsSync(file)?JSON.parse(readFileSync(file,'utf8')):{status:'not_started'};}
 start(id:string){if(this.flight)throw Error('已有独立宿主验证正在执行');const old=this.status(id);if(old.status==='completed')return old;
  const file=this.path(id,'-request');const request=JSON.parse(readFileSync(file,'utf8'));
  if(typeof request.prompt!=='string'||request.prompt.length>42000||!['paper','note','plan','decision'].includes(request.kind))throw Error('验证请求无效');
  this.controller=new AbortController();this.flight=this.run(id,request,this.controller.signal).finally(()=>{this.flight=undefined;});return {status:'running',id};
 }
 private async run(id:string,r:any,signal:AbortSignal){mkdirSync(this.root,{recursive:true});const file=this.path(id,'-result');atomicJson(file,{id,status:'running',startedAt:Date.now()});
  try{let contract:OutputContract=objectContract('development-bounded-object-v1');
   if(r.kind==='paper')contract=objectContract('development-paper-v2',v=>validatePaperObservations(v.paperStates));
   if(r.kind==='note')contract=objectContract('development-note-v1',v=>{if(typeof v.title!=='string'||typeof v.note!=='string'||[...v.note].length<40||[...v.note].length>120)throw Error('title及40—120字note必需');});
   if(r.kind==='decision')contract=decisionContract;
   if(r.kind==='plan')contract=objectContract('development-grounded-plan-v1',v=>{validatePlan(v.plan,r.allowedMotifIds??[]);validateExpressivePlan(v.plan);validateGroundedPlan(v.plan);});
   const content:any[]=[{type:'text',text:r.prompt}];let imageSha:string|undefined;
   if(r.imageTripId){const card=this.store.card(r.imageTripId);if(!card)throw Error('只允许已入藏图');const bytes=readFileSync(join(this.store.collection,r.imageTripId,'postcard.png'));imageSha=createHash('sha256').update(bytes).digest('hex');if(imageSha!==card.sha256)throw Error('旧图哈希异常');content.push({type:'image_url',image_url:{url:'data:image/png;base64,'+bytes.toString('base64')}});
    if(r.imageCrop){const b=r.imageCrop;if(!Array.isArray(b)||b.length!==4||b.some((v:any)=>typeof v!=='number'||!Number.isFinite(v))||b[0]<0||b[1]<0||b[2]>1||b[3]>1||b[2]<=b[0]||b[3]<=b[1])throw Error('复验裁切范围须为有效的归一化矩形');const src=PNG.sync.read(bytes),x=Math.floor(b[0]*src.width),y=Math.floor(b[1]*src.height),w=Math.max(1,Math.ceil(b[2]*src.width)-x),h=Math.max(1,Math.ceil(b[3]*src.height)-y),dst=new PNG({width:w,height:h});PNG.bitblt(src,dst,x,y,w,h,0,0);const zoom=PNG.sync.write(dst);content.push({type:'image_url',image_url:{url:'data:image/png;base64,'+zoom.toString('base64')}});}
}
   const raw=await this.transport('text',{model:'host-model',stream:false,response_format:{type:'json_object'},max_tokens:7000,messages:[{role:'user',content}],__postcardTask:{tripId:'development-'+id,label:'development-'+id}},signal,{outputContract:contract});
   const choice=(raw.choices as any)?.[0];if(choice?.finish_reason!=='stop')throw Error('宿主结果截断');const result=JSON.parse(choice.message.content);contract.validate(result);atomicJson(file,{id,status:'completed',completedAt:Date.now(),kind:r.kind,imageSha,...(r.imageCrop?{imageCrop:r.imageCrop}:{}),result});
  }catch(e){atomicJson(file,{id,status:'failed',error:e instanceof Error?e.message:String(e)});}
 }
 async stop(){this.controller?.abort();await this.flight;}
}
