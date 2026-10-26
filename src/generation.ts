import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { fetch, ProxyAgent } from 'undici';
import { atomicJson, type Generator, type Trip, type Artifact, type Scene } from './travel.ts';

export const POLICY = 'non-contradiction-cloud-v1';
export const IMAGE_MODEL = 'doubao-seedream-5-0-pro-260628';
export const VISION_MODEL = 'deepseek-flash';
export const SCENE_PROMPTS: Record<Scene,string> = {
  forest:'黄昏薄雾森林，女孩在长满苔藓的老树洞旁休息，身旁有温暖的小小萤光，蕨叶、细小林间溪流、朦胧树影。围绕树洞与溪流重新构图，不出现海水、沙滩、沙堡、螃蟹或雪。',
  coast:'安静的晴日海岸，女孩在浅色沙滩的小沙堡旁，身旁有小红螃蟹和贝壳，远处蓝绿海水和低矮绿海岬，天空清浅开阔。',
  snow:'蓝紫色雪夜小镇，女孩在面包店橱窗外木长椅旁休息，捧着冒轻柔热气的浅色杯子，积雪屋顶、小街、橱窗暖光和远处山影。围绕长椅与斜向街道重新构图，不出现海水、沙滩、沙堡或螃蟹。',
};
const COMMON = '生成完整收藏级旅行明信片，竖版2:3，单张。图1仅作角色身份参考：相同蓝发蓝眼Q版女孩，深蓝鲸鱼帽、白色喷水帽顶、白绒边、蓝白裙、小靴、鲸鱼尾。图2仅作浅淡透明水彩、细铅笔线、象牙白纸与通透留白参考；必须舍弃图2背景，不能搬用海天水平线或沙堡布局。角色连帽子约占高度三分之一，风景主导，角色自然融入环境光。细节克制，不画文字、日期、签名、logo、邮票；无贴纸感、多余肢体或其他人物。本次场景：';
type Json = Record<string,unknown>;
export interface CloudOptions { root:string; characterReference:string; styleReference:string; secret:(name:string)=>string; imageProxyUrl?:string; visionProxyUrl?:string; recentTitles?:()=>string[]; }
export type Transport = (kind:'image'|'text', payload:Json, signal:AbortSignal)=>Promise<Json>;
interface Spec { policy:string; imageModel:string; visionModel:string; prompt:string; characterSha:string; styleSha:string; }
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
export function textAccepted(review:Json):boolean {return review.has_explicit_conflict===false&&Array.isArray(review.conflicts)&&review.conflicts.length===0&&strings(review.uncertain_details);}

/** Only official cloud endpoints; credentials never enter checkpoints or errors. */
export function cloudTransport(options:CloudOptions):Transport {
  return async(kind,payload,signal)=>{
    const proxy=kind==='image'?options.imageProxyUrl:options.visionProxyUrl;
    if(proxy){const u=new URL(proxy);if(!['http:','https:'].includes(u.protocol)||u.username||u.password)throw new PipelineError('代理配置无效');}
    const key=options.secret(kind==='image'?'POSTCARD_ARK_API_KEY':'POSTCARD_VISION_API_KEY');
    if (!key) throw new PipelineError(kind==='image'?'未配置图片服务密钥':'未配置视觉服务密钥');
    const agent=proxy?new ProxyAgent(proxy):undefined;
    try {
      const response=await fetch(kind==='image'?'https://ark.cn-beijing.volces.com/api/v3/images/generations':'https://api.deepseek.com/chat/completions',{
        method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.any([signal,AbortSignal.timeout(240000)]),dispatcher:agent,
      });
      if(!response.ok){await response.body?.cancel();throw new HttpError(response.status);}
      return await response.json() as Json;
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
    if(!spec||spec.policy!==POLICY||spec.imageModel!==IMAGE_MODEL||spec.visionModel!==VISION_MODEL)throw new PipelineError('旅程生成版本不支持或缺少固定输入');
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
          if(error instanceof HttpError&&(error.status<500&&error.status!==408))throw new PipelineError('文字服务返回HTTP '+error.status+'，请检查配置/限额后重试');
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
        atomicJson(join(folder,'image-'+cp.imageAttempt+'-request.json'),{model:spec.imageModel,prompt:spec.prompt,referenceSha:[spec.characterSha,spec.styleSha],size:'2K',imageCount:2});
        const started=Date.now();
        try {
          const result=await transport('image',{model:spec.imageModel,prompt:spec.prompt,image:refs.map(b=>'data:image/png;base64,'+b.toString('base64')),size:'2K',response_format:'b64_json',output_format:'png',watermark:false},signal);
          const items=result.data as {b64_json?:string}[];
          atomicJson(join(folder,'image-'+cp.imageAttempt+'-response.json'),{model:result.model,usage:result.usage,elapsedMs:Date.now()-started,imageItems:items?.length});
          if(!Array.isArray(items)||items.length!==1||typeof items[0].b64_json!=='string')throw new PipelineError('图片服务未返回单张PNG数据，请检查远端结果');
          const bytes=Buffer.from(items[0].b64_json,'base64'),dims=decodePng(bytes);
          atomicJson(imagePath()+'.json',{sha256:hash(bytes),...dims});binary(imagePath(),bytes);
          cp.pendingImage=false;atomicJson(cpFile(trip),cp);
        }catch(error){
          if(error instanceof HttpError){cp.pendingImage=false;cp.imageAttempt--;atomicJson(cpFile(trip),cp);throw new PipelineError('图片服务返回HTTP '+error.status+'，请检查限额或服务配置后手动重试');}
          // Connection loss, abort or malformed output may have incurred a charge.
          throw new PipelineError('图片请求未完整保存，远端结果或费用不确定；确认后才可显式重试');
        }
      }
      stage('reviewing_image');
      imageReview=await textCall('image-'+cp.imageAttempt+'-review', '图1为候选，图2仅角色参考。核对图1目标场景、蓝发鲸鱼装女孩身份、明显肢体破碎/乱码等不可用问题。细微服饰变化和不清晰细节不直接失败；坐站姿势和蒸汽数量为创作建议，不是硬门槛。森林/雪夜不能带入海岸/沙堡/螃蟹。返回JSON：scene_match、character_match、usable（布尔），background_conflicts、issues（字符串数组），facts（3到8条图1直接可见事实）。目标：'+SCENE_PROMPTS[trip.scene],[readFileSync(imagePath()),refs[0]]);
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
      const raw=await textCall('image-'+cp.imageAttempt+'-note-'+attempt,'写桌宠旅行短笺，返回JSON：title（4到20字中文）、note（建议60到90字，最多120字）。第一人称自然写给牵挂的人，只选一两个成图锚点，其余写心情与想念；适度模糊，避免精确数量、左右位置、具体姿势和复杂动作。不虚构共同经历，不写技法/水彩/照片/署名，不重复近期标题。事实：'+JSON.stringify(imageReview.facts)+'；近期标题：'+JSON.stringify(options.recentTitles?.().slice(0,12)??[]));
      const note=formatNote(raw);
      atomicJson(join(folder,'image-'+cp.imageAttempt+'-note-'+attempt+'-formatted.json'),{policy:'sentence-boundary-length-v1',changed:note.note!==raw.note,note});
      if(!noteFormatted(note))continue;
      stage('reviewing_note');
      const review=await textCall('image-'+cp.imageAttempt+'-note-'+attempt+'-review','只检查短笺与此图是否有明确矛盾，不要求每句话被画面证明。感受比喻不检查，微风声音温度与静态无法确认的动作只列uncertain_details，不当反证。遮挡/细节不清不等于不存在。只拦截明确场景相反、明显姿态相反、清晰区域不可能兼容的大道具。返回JSON：has_explicit_conflict（布尔）、conflicts（反证说明数组）、uncertain_details（不阻断的未确认细节数组）。短笺：'+JSON.stringify(note),[image]);
      if(textAccepted(review)){
        stage('committing');
        return {image,title:note.title as string,note:note.note as string,generation:{policy:spec.policy,noteFormatting:'sentence-boundary-length-v1',imageModel:spec.imageModel,visionModel:spec.visionModel,characterSha:spec.characterSha,styleSha:spec.styleSha,imageAttempt:cp.imageAttempt,noteAttempt:attempt}} satisfies Artifact;
      }
      if(typeof review.has_explicit_conflict!=='boolean'||!Array.isArray(review.conflicts)||!strings(review.uncertain_details))invalidSchema('image-'+cp.imageAttempt+'-note-'+attempt+'-review','文案审核格式无效，不能按通过处理');
    }
    throw new PipelineError('两版文案均未通过，请检查后恢复；不会因此重新生图');
  };
  generate.prepare=trip=>{
    validateId(trip.id);
    if(!options.secret('POSTCARD_ARK_API_KEY')||!options.secret('POSTCARD_VISION_API_KEY'))throw new PipelineError('请配置图片与视觉服务的部署密钥');
    if(!options.characterReference||!options.styleReference)throw new PipelineError('请明确配置角色与画风参考图');
    const refs=[options.characterReference,options.styleReference].map(file=>readFileSync(file));refs.forEach(b=>decodePng(b));
    const folder=tripFolder(trip);mkdirSync(join(folder,'input'),{recursive:true});
    ['character.png','style.png'].forEach((name,i)=>writeFileSync(join(folder,'input',name),refs[i],{flag:'wx'}));
    const spec:Spec={policy:POLICY,imageModel:IMAGE_MODEL,visionModel:VISION_MODEL,prompt:COMMON+SCENE_PROMPTS[trip.scene],characterSha:hash(refs[0]),styleSha:hash(refs[1])};
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
