import {IMAGE_BACKENDS,imageKeyName,imageWireRequest,normalizeImageResponse,validateImageSettings,type ImageBackend} from './image-protocol.ts';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { fetch, ProxyAgent, Agent } from 'undici';
import { atomicJson, type Generator, type Trip, type Artifact, type Scene } from './travel.ts';
import {CONTENT_POLICY,LEGACY_POLICY,selectCoastVariant,selectNoteVoice,notePrompt} from './content.ts';
import {freezeScene,type SceneSnapshot} from './scenes.ts';

export const POLICY = 'non-contradiction-cloud-v3';
export const IMAGE_MODEL = 'doubao-seedream-5-0-flash-260915';
export const VISION_MODEL = 'deepseek-flash';
export const SCENE_PROMPTS: Record<'forest'|'coast'|'snow',string> = {
  forest:'黄昏薄雾森林，女孩在长满苔藓的老树洞旁休息，身旁有温暖的小小萤光，蕨叶、细小林间溪流、朦胧树影。围绕树洞与溪流重新构图，不出现海水、沙滩、沙堡、螃蟹或雪。',
  coast:'安静的晴日海岸，女孩在浅色沙滩的小沙堡旁，身旁有小红螃蟹和贝壳，远处蓝绿海水和低矮绿海岬，天空清浅开阔。',
  snow:'蓝紫色雪夜小镇，女孩在面包店橱窗外木长椅旁休息，捧着冒轻柔热气的浅色杯子，积雪屋顶、小街、橱窗暖光和远处山影。围绕长椅与斜向街道重新构图，不出现海水、沙滩、沙堡或螃蟹。',
};
const COMMON = '生成完整收藏级旅行明信片，竖版2:3，单张。图1仅作角色身份与服装参考：保持图1的发色、发型、脸部、头饰、服装主色与独特配件，不能把不同服饰强改成冬装或鲸鱼帽；自定义角色也严格跟随图1。图2仅作浅淡透明水彩、细铅笔线、象牙白纸与通透留白参考；必须舍弃图2背景，不能搬用海天水平线或沙堡布局。人物含帽约占画面高度18%至33%，具体按本次景别，风景主导，角色自然融入环境光。细节克制，不画文字、日期、签名、logo、邮票；无贴纸感、多余肢体或其他人物。本次场景：';
type Json = Record<string,unknown>;
export interface ImageRoute {backend?:ImageBackend;baseUrl?:string;}
export function imageEndpoint(base:string){let u:URL;try{u=new URL(base);}catch{throw new PipelineError('生图API请求地址无效');}if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.search||u.hash)throw new PipelineError('生图接口只支持不含凭据或查询参数的HTTP(S)地址');return u.href.replace(/\/$/,'')+(u.pathname.replace(/\/$/,'').endsWith('/images/generations')?'':'/images/generations');}
export interface CloudOptions { imageBackend?:ImageBackend;imageBaseUrl?:string;imageSize?:string; imageModel?:string; hostReady?:()=>boolean; hostTransport?:Transport; useHostModel?:boolean; root:string; characterReference:string; styleReference:string; secret:(name:string)=>string; imageProxyUrl?:string; visionProxyUrl?:string; recentTitles?:()=>string[]; recentVariants?:(scene:Scene)=>string[]; }
export type Transport = (kind:'image'|'text', payload:Json, signal:AbortSignal,route?:ImageRoute)=>Promise<Json>;
interface Spec { imageBackend?:ImageBackend;imageBaseUrl?:string;imageSize?:string;policy:string; imageModel:string; visionModel:string; prompt:string; characterSha:string; styleSha:string; scenePrompt?:string; sceneVariant?:string; noteVoice?:string; sceneSnapshot?:SceneSnapshot; placeScopeVersion?:'v1'|'v2'; noteReviewVersion?:'v1'|'v2'|'v3'; }
interface Checkpoint { schema:1; imageAttempt:number; pendingImage:boolean; stage:string; textRequests:Record<string,number>; errors:string[]; }
export class PipelineError extends Error { constructor(message:string) {super(message);this.name='PostcardPipelineError';} }
export class HttpError extends Error { constructor(readonly status:number) {super('Cloud HTTP '+status);} }
const hash = (b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
const load = <T>(file:string):T=>JSON.parse(readFileSync(file,'utf8')) as T;
function validateId(id:string):void { if (!/^[a-f0-9-]{36}$/.test(id)) throw new PipelineError('旅行编号无效'); }
export function decodePng(bytes:Buffer): {width:number;height:number} {
  if (bytes.length>40*1024*1024 || bytes.length<24 || !bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'))) throw new PipelineError('图片不是有效PNG');
  const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);
  if (width<512 || height<512 || width>4096 || height>4096) throw new PipelineError('图片尺寸超出允许范围');
  try { PNG.sync.read(bytes, {checkCRC:true}); } catch {throw new PipelineError('图片解码或完整性校验失败');}
  return {width,height};
}
function binary(file:string, bytes:Buffer):void {
  const temporary=file+'.'+randomUUID()+'.tmp';writeFileSync(temporary,bytes,{flag:'wx'});renameSync(temporary,file);
}
function strings(value:unknown,min=0,max=20):value is string[] {return Array.isArray(value)&&value.length>=min&&value.length<=max&&value.every(s=>typeof s==='string'&&s.trim().length>0);}
export function imageAccepted(review:Json):boolean {return ['scene_match','character_match','usable'].every(k=>review[k]===true)&&Array.isArray(review.background_conflicts)&&review.background_conflicts.length===0&&strings(review.facts,3,8);}
export function noteFormatted(note:Json):boolean {return typeof note.title==='string'&&[...note.title].length>=4&&[...note.title].length<=20&&typeof note.note==='string'&&[...note.note].length>=40&&[...note.note].length<=120;}
/** Deterministic format repair only: retain complete original sentences. No invented text. */
export function formatNote(raw:Json):Json {
  if(typeof raw.note!=='string'||[...raw.note].length<=120)return raw;
  const sentences=raw.note.match(/[^。！？]+[。！？]/gu)??[];
  const chosen=new Set<number>();
  if(sentences.length){chosen.add(0);if(sentences.length>1&&[...sentences[0]+sentences.at(-1)!].length<=120)chosen.add(sentences.length-1);}
  for(let i=1;i<sentences.length;i++){
    const indices=[...chosen,i].filter((n,k,a)=>a.indexOf(n)===k).sort((a,b)=>a-b);
    if([...indices.map(n=>sentences[n]).join('')].length<=120)chosen.add(i);
  }
  const note=[...chosen].sort((a,b)=>a-b).map(n=>sentences[n]).join('');
  return note&&[...note].length<=120?{...raw,note}:raw;
}
export function textAccepted(review:Json,structured=true):boolean {if(structured&&Array.isArray(review.checks)&&review.checks.some(c=>c&&typeof c==='object'&&(c as Json).clear_conflict===true))return false;return review.has_explicit_conflict===false&&Array.isArray(review.conflicts)&&review.conflicts.length===0&&strings(review.uncertain_details);}
/** Shared verbatim with the blind regression runner; labels never enter this prompt. */
export function textReviewPrompt(note:Json,policy:string=POLICY,version:'v1'|'v2'|'v3'='v3'):string {
 if(policy===POLICY&&version==='v3')return '只检查短笺与图是否存在明确反证。逐项核对，不能只看整体场景相似就放行：1.提取文字中明确描述当下可见场景、身体姿态、明显大道具的陈述，逐条填checks；2.观察图片对应区域，写observation和clear_conflict；3.任一项有清晰反证，最终必须拒绝。重点看清臀部是否落地/落椅、膝盖和脚的位置：明确我蹲在地上/沙堡旁与清晰坐在地上、双腿向前不兼容。姿态不能因景观正确被忽略。遮挡或细节不清不算反证；风声、温度、心情、含糊过去动作及蹲守消息/蹲守一封消息/蹲在心里等比喻不描述当下身体位置，不进入姿态checks，允许保留。不要将未能证明的内容当成矛盾。返回JSON：checks（数组，每项含claim原文、category为scene/posture/prop、observation观察、clear_conflict布尔），has_explicit_conflict布尔、conflicts反证说明数组、uncertain_details未确认但不阻断的细节数组。检查完所有明确陈述再给最终结论。短笺：'+JSON.stringify(note);
 const base='只检查短笺与此图是否有明确矛盾，不要求每句话被画面证明。感受比喻不检查，微风声音温度与静态无法确认的动作只列uncertain_details，不当反证。遮挡/细节不清不等于不存在。只拦截明确场景相反、明显姿态相反、清晰区域不可能兼容的大道具。';
 const pose=policy===LEGACY_POLICY?'':'判定步骤：先区分明确描写当下可见状态的句子和感受/比喻/含糊过去动作；再对明确可见状态检查场景、姿态、道具，三类中任意一类有清晰反证就必须拒绝，不需要场景也相反。尤其注意：明确“我蹲在……”不是坐姿的同义词；图中臀部明显落在地面或椅面、双腿向前，就反证了这种蹲姿。完整可见的双手在身前且头顶区域敞开，也能反证“双手高举展开大伞且伞面盖住头顶天空”；不能把这些已看清的不相容状态写进uncertain_details后仍通过。conflicts只写这样的清晰反证；如果有一条，has_explicit_conflict必须为true。只有未看清、遮挡、声音风温度、含糊过去动作及“蹲守消息/蹲在心里”等比喻可列uncertain_details而不拒绝。不准把“只是姿态/道具细节，场景没有变”作为放行理由。';
 const metaphor=policy===POLICY&&version==='v2'?'先判断短语的语义再看姿态：例如蹲守一封消息、蹲守消息表示等待消息，不陈述膝盖/臀部位置，图中站立或坐着都不反证它；只有明确我蹲在地上、弯膝蹲下等当下具体身体状态才进入姿态核对。同一个比喻不能既在uncertain_details承认是等待意味，又在conflicts把它解释成真实蹲姿。若没有其他明确反证，必须允许。':'';
 return base+pose+metaphor+'返回JSON：has_explicit_conflict（布尔）、conflicts（反证说明数组）、uncertain_details（不阻断的未确认细节数组）。短笺：'+JSON.stringify(note);
}

export function placeScopePrompt(note:Json,version:'v1'|'v2'='v2'):string {return (version==='v1'?'只检查文字是否明确使用真实国家、省市、景区等专有地名。森林、海岸、山谷、沙丘、江边、古镇等通用词不是地名；感受和比喻不算。':'只检查文字是否明确包含真实国家、地域、省市、景区等专有地名。通用地貌或环境词（森林、海岸、山谷、沙丘、江边、古镇）不是地名。情绪和比喻本身不违规，但里面若含真实地域名称仍须列入names，不因句子是比喻就忽略专有地名。此项只是无真实地名的内容范围检查，不是文图矛盾检查。')+'返回JSON：has_real_place_name（布尔）、names（明确真实地名字符串数组）。文字：'+JSON.stringify(note);}

/** Protocol-specific image requests; credentials never enter checkpoints or errors. */
export function cloudTransport(options:CloudOptions):Transport {
  return async(kind,payload,signal,route)=>{
    const backend=kind==='image'?(route?.backend??options.imageBackend??'ark'):'ark';
    const proxy=kind==='image'?options.imageProxyUrl:options.visionProxyUrl;
    if(proxy){const u=new URL(proxy);if(!['http:','https:'].includes(u.protocol)||u.username||u.password)throw new PipelineError('代理配置无效');}
    const key=options.secret(kind==='image'?imageKeyName(backend):'POSTCARD_VISION_API_KEY');
    if (!key&&backend!=='compatible') throw new PipelineError(kind==='image'?'未配置图片服务密钥':'未配置视觉服务密钥');
    // Empty means direct even when the host installs its own global proxy dispatcher.
    const agent=proxy?new ProxyAgent(proxy):new Agent({connect:{timeout:30000}});
    try {
      const request=kind==='image'?imageWireRequest(backend,route?.baseUrl??options.imageBaseUrl??'',payload,key):{url:'https://api.deepseek.com/chat/completions',headers:key?{Authorization:'Bearer '+key}:{},body:payload};
      const timeout=AbortSignal.any([signal,AbortSignal.timeout(kind==='image'?900000:240000)]);
      const response=await fetch(request.url,{method:'POST',headers:{...request.headers,'Content-Type':'application/json'},body:JSON.stringify(request.body),signal:timeout,dispatcher:agent,redirect:'error'});
      if(!response.ok){await response.body?.cancel();throw new HttpError(response.status);}
      const value=await response.json() as Json;
      if(kind!=='image')return value;
      return await normalizeImageResponse(backend,value,async url=>{
        const image=await fetch(url,{signal:timeout,dispatcher:agent,redirect:'error'});
        if(!image.ok){await image.body?.cancel();throw new PipelineError('千问图片下载失败，远端可能已计费，请确认后恢复');}
        const chunks:Buffer[]=[];let length=0;
        try{for await(const chunk of image.body!){length+=chunk.length;if(length>40*1024*1024)throw new PipelineError('返回图片超过40MB');chunks.push(Buffer.from(chunk));}}finally{await image.body?.cancel().catch(()=>{});}
        return Buffer.concat(chunks);
      });
    } finally {await agent?.close();}
  };
}

export function createCloudGenerator(options:CloudOptions, transport:Transport=cloudTransport(options)):Generator {
  const tripFolder=(trip:Readonly<Trip>)=>{validateId(trip.id);return join(options.root,'trips',trip.id);};
  const cpFile=(trip:Readonly<Trip>)=>join(tripFolder(trip),'checkpoint.json');
  const getCp=(trip:Readonly<Trip>):Checkpoint=>{
    const file=cpFile(trip);
    const cp=existsSync(file)?load<Checkpoint>(file):{schema:1 as const,imageAttempt:0,pendingImage:false,stage:'prepared',textRequests:{},errors:[]};
    if(cp.schema!==1||!Number.isInteger(cp.imageAttempt)||cp.imageAttempt<0||cp.imageAttempt>2||typeof cp.pendingImage!=='boolean'||!cp.textRequests||typeof cp.textRequests!=='object'||Object.values(cp.textRequests).some(n=>!Number.isInteger(n)||n<0||n>2)) throw new PipelineError('生成检查点损坏');
    return cp;
  };
  const generate:Generator=async(trip,signal,onPhase)=>{
    const folder=tripFolder(trip),spec=trip.generation as unknown as Spec;
    if(spec?.imageBackend&&!IMAGE_BACKENDS.includes(spec.imageBackend))throw new PipelineError('生图通道版本不支持');
    if(!spec||![POLICY,CONTENT_POLICY,LEGACY_POLICY].includes(spec.policy)||(typeof spec.imageModel!=='string'||!spec.imageModel.trim())||![VISION_MODEL,'host-model'].includes(spec.visionModel))throw new PipelineError('旅程生成版本不支持或缺少固定输入');
    if(spec.policy!==LEGACY_POLICY&&(!spec.scenePrompt||!spec.sceneVariant||!spec.noteVoice))throw new PipelineError('旅程缺少固定内容策略');
    if(spec.policy===POLICY&&(!spec.sceneSnapshot||spec.sceneSnapshot.scene!==trip.scene||!spec.sceneSnapshot.core||!spec.sceneSnapshot.conflicts))throw new PipelineError('旅行缺少固定场景快照');
    const refs=['character.png','style.png'].map(file=>readFileSync(join(folder,'input',file)));
    if(hash(refs[0])!==spec.characterSha||hash(refs[1])!==spec.styleSha)throw new PipelineError('旅行参考图校验失败，禁止使用变化的输入');
    const cp=getCp(trip);
    const invalidSchema=(label:string,message:string):never=>{
      const file=join(folder,label+'.json');
      if(existsSync(file))renameSync(file,join(folder,label+'.invalid-'+(cp.textRequests[label]??0)+'.json'));
      throw new PipelineError(message);
    };
    const stage=(value:string)=>{cp.stage=value;atomicJson(cpFile(trip),cp);onPhase?.(value);signal.throwIfAborted();};
    const imagePath=()=>join(folder,'image-'+cp.imageAttempt+'.png');
    const imageValid=():boolean=>{
      const file=imagePath(),manifest=file+'.json';
      if(!existsSync(file))return false;
      const b=readFileSync(file);decodePng(b);
      if(!existsSync(manifest)||load<Json>(manifest).sha256!==hash(b))throw new PipelineError('已保存候选图校验失败');
      return true;
    };
    if(cp.pendingImage){
      if(imageValid()){cp.pendingImage=false;atomicJson(cpFile(trip),cp);}
      else throw new PipelineError('上次图片请求结果不确定，必须确认远端结果后显式重试，不能自动重复收费');
    }
    async function textCall(label:string,prompt:string,images:Buffer[]=[]):Promise<Json>{
      const target=join(folder,label+'.json');
      if(existsSync(target))return load<Json>(target);
      const content:Json[]=[{type:'text',text:prompt},...images.map(b=>({type:'image_url',image_url:{url:'data:image/png;base64,'+b.toString('base64')}}))];
      const payload:Json={model:spec.visionModel,stream:false,thinking:{type:'disabled'},response_format:{type:'json_object'},max_tokens:1800,messages:[{role:'user',content}]};
      atomicJson(join(folder,label+'-request.json'),{model:spec.visionModel,prompt,images:images.map(b=>({sha256:hash(b),bytes:b.length}))});
      if(spec.visionModel==='host-model'){
        if(!options.hostTransport)throw new PipelineError('本趟使用宿主模型，请恢复宿主模式后继续');
        const result=await options.hostTransport('text',{...payload,__postcardTask:{tripId:trip.id,label}},signal);
        const choice=(result.choices as any[])?.[0];let value:Json;
        try{value=JSON.parse(choice.message.content);}catch{throw new PipelineError('宿主结果不是有效JSON');}
        if(!value||typeof value!=='object'||Array.isArray(value))throw new PipelineError('宿主结果格式无效');
        atomicJson(target,value);return value;
      }
      while((cp.textRequests[label]??0)<2){
        cp.textRequests[label]=(cp.textRequests[label]??0)+1;atomicJson(cpFile(trip),cp);
        const started=Date.now();
        try {
          signal.throwIfAborted();const result=await transport('text',payload,signal);
          atomicJson(join(folder,label+'-response-'+cp.textRequests[label]+'.json'),{elapsedMs:Date.now()-started,model:result.model,usage:result.usage,choices:result.choices});
          const choice=(result.choices as {finish_reason:string;message:{content:string}}[])?.[0];
          if(!choice||choice.finish_reason!=='stop')throw new PipelineError('云端文字结果不完整');
          let value:Json;
          try {value=JSON.parse(choice.message.content) as Json;}catch{throw new PipelineError('云端文字结果不是有效JSON');}
          if(!value||typeof value!=='object'||Array.isArray(value))throw new PipelineError('云端文字结果格式无效');
          atomicJson(target,value);return value;
        } catch(error){
          if(signal.aborted)throw error;
          if(error instanceof PipelineError)throw error;
          if(error instanceof HttpError&&(error.status<500&&error.status!==408))throw error;
          if((cp.textRequests[label]??0)>=2)throw new PipelineError('文字服务暂时不可用，已达到本阶段网络尝试上限');
          await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},1000);const abort=()=>{clearTimeout(timer);reject(new Error('aborted'));};signal.addEventListener('abort',abort,{once:true});});
        }
      }
      throw new PipelineError('本阶段文字请求已达到上限，请检查服务记录');
    }
    let imageReview:Json|undefined;
    while(true){
      if(cp.imageAttempt===0||!imageValid()||existsSync(join(folder,'image-'+cp.imageAttempt+'-rejected.json'))){
        if(cp.imageAttempt>=2)throw new PipelineError('本趟图片请求已达到两次上限');
        stage('generating_image');cp.imageAttempt++;cp.pendingImage=true;atomicJson(cpFile(trip),cp);
        atomicJson(join(folder,'image-'+cp.imageAttempt+'-request.json'),{model:spec.imageModel,prompt:spec.prompt,referenceSha:[spec.characterSha,spec.styleSha],size:spec.imageSize??'2K',imageCount:2});
        const started=Date.now();
        try {
          const result=await transport('image',{model:spec.imageModel,prompt:spec.prompt,image:refs.map(b=>'data:image/png;base64,'+b.toString('base64')),size:spec.imageSize??'2K',response_format:'b64_json',...((spec.imageBackend??'ark')==='ark'?{output_format:'png',watermark:false}:{})},signal,{backend:spec.imageBackend??'ark',baseUrl:spec.imageBaseUrl});
          const items=result.data as {b64_json?:string}[];
          atomicJson(join(folder,'image-'+cp.imageAttempt+'-response.json'),{model:result.model,usage:result.usage,elapsedMs:Date.now()-started,imageItems:items?.length});
          if(!Array.isArray(items)||items.length!==1||typeof items[0].b64_json!=='string')throw new PipelineError('图片服务未返回单张PNG数据，请检查远端结果');
          const bytes=Buffer.from(items[0].b64_json,'base64'),dims=decodePng(bytes);
          atomicJson(imagePath()+'.json',{sha256:hash(bytes),...dims});binary(imagePath(),bytes);
          cp.pendingImage=false;atomicJson(cpFile(trip),cp);
        }catch(error){
          if(error instanceof HttpError&&error.status>=400&&error.status<500&&error.status!==408){cp.pendingImage=false;cp.imageAttempt--;atomicJson(cpFile(trip),cp);throw error;}
          // Connection loss, abort or malformed output may have incurred a charge.
          throw new PipelineError('图片请求未完整保存，远端结果或费用不确定；确认后才可显式重试');
        }
      }
      stage('reviewing_image');
      imageReview=await textCall('image-'+cp.imageAttempt+'-review', (spec.policy===POLICY?'图1为候选，图2仅角色参考。核对图1的核心景观、图2参考角色身份和服饰（发色、头饰、主色和独特配件；不要求统一为冬装）、明显肢体破碎/乱码等不可用问题。只把核心景观及明确冲突作为场景门槛，具体构图、气氛、可选装饰、手势及细小服饰变化不是硬要求，不清晰不等于错误。不核验真实地理，不要求某座地标。返回JSON：scene_match、character_match、usable（布尔），background_conflicts、issues（字符串数组），facts（3到8条图1直接可见事实）。核心景观：'+spec.sceneSnapshot!.core+'；明确冲突：'+spec.sceneSnapshot!.conflicts+'；可选装饰：'+spec.sceneSnapshot!.optional:'图1为候选，图2仅角色参考。核对图1目标场景、图2参考角色身份和服饰（发色、头饰、主色和独特配件；不要求统一为冬装）、明显肢体破碎/乱码等不可用问题。细微服饰变化和不清晰细节不直接失败；坐站姿势和蒸汽数量为创作建议，不是硬门槛。森林/雪夜不能带入海岸/沙堡/螃蟹。返回JSON：scene_match、character_match、usable（布尔），background_conflicts、issues（字符串数组），facts（3到8条图1直接可见事实）。目标：'+(spec.scenePrompt??SCENE_PROMPTS[trip.scene as keyof typeof SCENE_PROMPTS])),[readFileSync(imagePath()),refs[0]]);
      if(imageAccepted(imageReview))break;
      // A malformed check does not justify paying for another image.
      if(['scene_match','character_match','usable'].some(k=>typeof imageReview![k]!=='boolean')||!Array.isArray(imageReview.background_conflicts)||!strings(imageReview.facts,3,8))invalidSchema('image-'+cp.imageAttempt+'-review','图像审核格式无效，请检查后恢复本张图片');
      if(cp.imageAttempt>=2)throw new PipelineError('两张候选图均未通过，暂不入库');
      stage('image_rejected');
      atomicJson(join(folder,'image-'+cp.imageAttempt+'-rejected.json'),{rejected:true});
    }
    const image=readFileSync(imagePath());
    for(let attempt=1;attempt<=2;attempt++){
      stage('writing_note');
      const raw=await textCall('image-'+cp.imageAttempt+'-note-'+attempt,notePrompt(imageReview.facts,options.recentTitles?.().slice(0,12)??[],spec.policy!==LEGACY_POLICY?spec.noteVoice:undefined)+(spec.policy===POLICY?' 本次地点虚构，title和note不得使用任何真实省市、景区、国家等专有地名，只写通用环境或风景。':''));
      const note=formatNote(raw);
      atomicJson(join(folder,'image-'+cp.imageAttempt+'-note-'+attempt+'-formatted.json'),{policy:'sentence-boundary-length-v1',changed:note.note!==raw.note,note});
      if(!noteFormatted(note))continue;
      stage('reviewing_note');
      const review=await textCall('image-'+cp.imageAttempt+'-note-'+attempt+'-review',textReviewPrompt(note,spec.policy,spec.noteReviewVersion??'v1'),[image]);
      if(spec.policy===POLICY&&spec.noteReviewVersion==='v3'&&(!Array.isArray(review.checks)||review.checks.some(c=>!c||typeof c!=='object'||typeof (c as Json).claim!=='string'||!['scene','posture','prop'].includes((c as Json).category as string)||typeof (c as Json).observation!=='string'||typeof (c as Json).clear_conflict!=='boolean')))invalidSchema('image-'+cp.imageAttempt+'-note-'+attempt+'-review','逐项文图检查格式无效，请检查后恢复本张图');
      if(spec.policy===POLICY){
        const scope=await textCall('image-'+cp.imageAttempt+'-note-'+attempt+'-scope',placeScopePrompt(note,spec.placeScopeVersion??'v1'));
        if(typeof scope.has_real_place_name!=='boolean'||!strings(scope.names))invalidSchema('image-'+cp.imageAttempt+'-note-'+attempt+'-scope','地名范围检查格式无效，请检查后恢复，不会重画');
        if(scope.has_real_place_name||(scope.names as string[]).length)continue;
      }
      if(textAccepted(review,spec.policy===POLICY&&spec.noteReviewVersion==='v3')){
        stage('committing');
        return {image,title:note.title as string,note:note.note as string,generation:{policy:spec.policy,noteFormatting:'sentence-boundary-length-v1',...(spec.policy===POLICY?{placeScopeVersion:spec.placeScopeVersion??'v1',noteReviewVersion:spec.noteReviewVersion??'v1'}:{}),imageModel:spec.imageModel,visionModel:spec.visionModel,characterSha:spec.characterSha,styleSha:spec.styleSha,imageAttempt:cp.imageAttempt,noteAttempt:attempt,...(spec.sceneSnapshot?{catalogVersion:spec.sceneSnapshot.catalogVersion,sceneLabel:spec.sceneSnapshot.label}:{}),...(spec.sceneVariant?{sceneVariant:spec.sceneVariant,noteVoice:spec.noteVoice}:{})}} satisfies Artifact;
      }
      if(typeof review.has_explicit_conflict!=='boolean'||!Array.isArray(review.conflicts)||!strings(review.uncertain_details))invalidSchema('image-'+cp.imageAttempt+'-note-'+attempt+'-review','文案审核格式无效，不能按通过处理');
    }
    throw new PipelineError('两版文案均未通过，请检查后恢复；不会因此重新生图');
  };
  generate.prepare=trip=>{
    validateId(trip.id);
    if(options.useHostModel&&options.hostReady&&!options.hostReady())throw new PipelineError('宿主模型未连接或不支持PNG，尚未开始生图');
    const backend=options.imageBackend??'ark';validateImageSettings(backend,options.imageBaseUrl??'',options.imageModel?.trim()||IMAGE_MODEL,options.imageSize?.trim()||'2K');
    if((backend!=='compatible'&&!options.secret(imageKeyName(backend)))||(!options.useHostModel&&!options.secret('POSTCARD_VISION_API_KEY')))throw new PipelineError('请配置生图服务，并启用宿主模型看图写信或恢复原旅程通道');
    if(!options.characterReference||!options.styleReference)throw new PipelineError('请明确配置角色与画风参考图');
    const refs=[options.characterReference,options.styleReference].map(file=>readFileSync(file));if(backend==='gemini'&&refs.reduce((n,b)=>n+b.length,0)>14*1024*1024)throw new PipelineError('Gemini双参考图合计不能超过14MB，请缩小图片以避免内联请求超限');refs.forEach(b=>{if(backend==='qwen'&&(b.length>10*1024*1024||decodePng(b).width>3072||decodePng(b).height>3072))throw new PipelineError('千问参考图最大10MB且每边不超过3072像素，请调整参考图');if(b.length>30*1024*1024)throw new PipelineError('参考图不能超过30MB');decodePng(b);});
    const folder=tripFolder(trip);mkdirSync(join(folder,'input'),{recursive:true});
    ['character.png','style.png'].forEach((name,i)=>writeFileSync(join(folder,'input',name),refs[i],{flag:'wx'}));
    const sceneSnapshot=trip.sceneSnapshot??freezeScene(trip.id,trip.scene,[],options.recentVariants?.(trip.scene)??[]);
    const variant={id:sceneSnapshot.id,prompt:sceneSnapshot.prompt};
    const spec:Spec={imageBackend:backend,...(backend!=='ark'?{imageBaseUrl:options.imageBaseUrl,imageSize:options.imageSize?.trim()||(backend==='gemini'?'2K':backend==='qwen'?'1024*1536':'1024x1536')}:{}),sceneSnapshot,placeScopeVersion:'v2',noteReviewVersion:'v3',policy:POLICY,imageModel:options.imageModel?.trim()||IMAGE_MODEL,visionModel:options.useHostModel?'host-model':VISION_MODEL,prompt:COMMON+variant.prompt,characterSha:hash(refs[0]),styleSha:hash(refs[1]),scenePrompt:variant.prompt,sceneVariant:variant.id,noteVoice:selectNoteVoice(trip.id)};
    atomicJson(join(folder,'spec.json'),spec);return {...spec};
  };
  generate.confirmRetry=(trip,confirmed)=>{
    const cp=getCp(trip);if(cp.pendingImage){
      const file=join(tripFolder(trip),'image-'+cp.imageAttempt+'.png');
      if(existsSync(file))return;
      if(!confirmed)throw new PipelineError('上次图片结果不确定，请确认远端结果与可能费用后再显式重试');
      cp.pendingImage=false;atomicJson(cpFile(trip),cp);
    }
  };
  return generate;
}
