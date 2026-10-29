import {createHash,randomUUID} from 'node:crypto';
import {readFileSync,statSync} from 'node:fs';
import {join} from 'node:path';
import {atomicJson,type Generator,type Trip} from './travel.ts';
import {characterReference,styleReference} from './characters.ts';
import {decodePng,HttpError} from './generation.ts';
import type {PostcardConfigSection} from './config.ts';
const phases:Record<string,string>={preparing:'检查配置与参考图',generating_image:'生图服务生成图片',reviewing_image:'宿主看图审核',image_rejected:'候选图片检查',writing_note:'宿主撰写短笺',reviewing_note:'宿主核对图文',committing:'整理成品',checking_output:'检查最终图片与短笺'};
export function verificationFailure(error:unknown,stage:string){
 const message=error instanceof Error?error.message:'';let code='UNKNOWN',reason='制作过程失败，现有信息不足以确定具体原因',advice='请核对服务商调用记录与宿主状态；不要仅凭这条提示认定是密钥问题。';
 if(error instanceof HttpError){code='HTTP_'+error.status;const rules:Record<number,[string,string]>={400:['服务拒绝了生图请求参数','核对模型ID、尺寸、所选服务的双参考图协议；聊天接口或纯文生图不能替代该接口。'],401:['服务身份验证失败','检查当前失败步骤对应服务的API Key是否正确、有效，保存后重启本World。'],403:['服务拒绝访问','检查模型调用权限、额度与服务限制；HTTP 403本身不能确定是哪一项。'],404:['服务找不到请求的资源','核对生图API请求地址、路径与模型ID；不要填写聊天或网页地址。'],429:['服务触发频率或额度限制','到服务商控制台核对限流及额度，稍后再明确重试。']};const rule=rules[error.status];if(rule)[reason,advice]=rule;else if(error.status>=500){reason='当前步骤使用的服务暂时发生错误';advice='检查服务商状态和调用记录，确认是否已收费后再重试。';}else{reason='服务返回HTTP '+error.status;advice='核对服务文档与调用记录。';}}
 else if(/超时|timeout|timed out/i.test(message)||error instanceof Error&&error.name==='TimeoutError'){code='TIMEOUT';reason=stage==='generating_image'?'等待生图服务超时':'等待宿主处理或制作步骤超时';advice='检查网络与宿主是否忙碌、是否正确提交工具结果；先核对已发请求是否收费。';}
 else if(/PNG|图片尺寸|图片解码|未返回单张/.test(message)){code='IMAGE_FORMAT';reason='图片响应不是符合要求的单张PNG';advice='成品须为单张PNG、每边512—4096；检查所选协议与响应格式。千问官方OSS链接会自动下载，Gemini使用inlineData，其他兼容接口仍要求b64_json。';}
 else if(/两张候选/.test(message)){code='IMAGE_REJECTED';reason='两张候选图片均未通过角色或场景检查';advice='检查角色参考清晰度及所用模型的参考图能力；再次验证可能重新收取图片费用。';}
 else if(/两版文案|短笺不完整/.test(message)){code='NOTE_REJECTED';reason='短笺不完整或两版文案均未通过检查';advice='检查宿主看图、文字生成和JSON输出能力。';}
 else if(/JSON|审核格式|结果格式|结果不完整/.test(message)){code='HOST_RESULT';reason='宿主或服务返回的结果格式不符合要求';advice='查看宿主是否按工具指令提交完整JSON；如发生在生图步骤，核对服务返回协议。';}
 else if(/参考|密钥|接口|配置|不支持PNG/.test(message)){code='CONFIGURATION';reason='配置、参考图或模型能力检查未通过';advice='先完成本地配置检查，确认参考图可读、生图模型与接口正确、宿主支持PNG；配置有改动需保存并重启。';}
 else if(/中断|aborted|取消/.test(message)||error instanceof Error&&error.name==='AbortError'){code='INTERRUPTED';reason='验证被关闭、取消或中断';advice='先查看服务调用记录；已提交的请求可能已计费。';}
 else if(/fetch|network|ENOTFOUND|ECONN|ETIMEDOUT|证书/i.test(message)){code='NETWORK';reason='无法正常连接服务或读取响应';advice='检查API地址、网络、代理与服务端证书，不要绕过证书校验。';}
 return {code,stage:phases[stage]??'制作过程',reason,advice};
}
export class ReadinessCheck {
 private running=false;private controller?:AbortController;
 constructor(private root:string,private cfg:PostcardConfigSection,private secret:(n:string)=>string,private model:()=>string,private generator?:Generator,private now=()=>Date.now()){}
 private fingerprint(){try{return createHash('sha256').update(JSON.stringify({settings:[this.cfg.cloudEnabled,this.cfg.useHostModel,this.cfg.imageBackend,this.cfg.imageModel,this.cfg.imageBaseUrl,this.cfg.imageSize,this.cfg.imageProxyUrl,this.cfg.visionProxyUrl],model:this.model(),keys:['POSTCARD_ARK_API_KEY','POSTCARD_IMAGE_API_KEY','POSTCARD_VISION_API_KEY','POSTCARD_QWEN_API_KEY','POSTCARD_GEMINI_API_KEY'].map(n=>this.secret(n)),refs:[characterReference(this.cfg),styleReference(this.cfg)].map(p=>{const s=statSync(p,{bigint:true});return [p,String(s.size),String(s.mtimeNs),String(s.ctimeNs)];})})).digest('hex');}catch{return '';}}
 private file(){return join(this.root,'readiness.json');}
 state(){let r:any;try{r=JSON.parse(readFileSync(this.file(),'utf8'));}catch{}const fingerprint=this.fingerprint(),same=!!fingerprint&&r?.fingerprint===fingerprint,valid=!this.running&&r?.passed===true&&same&&this.now()>=r.at;
 const legacy=r?.passed===false&&!r?.fingerprint;const interrupted=!this.running&&same&&r?.pending===true;
 const failure=same&&r?.failure?r.failure:interrupted?verificationFailure(new Error('验证中断'),r.stage):legacy?{code:'LEGACY',stage:'旧版验证',reason:'上次验证没有保存失败详情，无法还原具体原因',advice:'新版会记录失败步骤与处理建议。再次验证可能计费，请先核对服务调用记录。'}:undefined;
 return {phase:this.running?'checking':valid?'passed':failure?'failed':'required',valid,checkedAt:r?.passed===true?r.at:null,stage:this.running?phases[r?.stage]??'制作过程':undefined,...(failure?{failure,failedAt:r.at}:{})};}

 start(){if(this.running)return this.state();if(!this.generator)throw Error('生图服务尚未启用，不能验证');const fingerprint=this.fingerprint();if(!fingerprint)throw Error('配置或参考图不完整');atomicJson(this.file(),{passed:false,pending:true,fingerprint,stage:'preparing',at:this.now()});this.running=true;this.controller=new AbortController();const controller=this.controller,generator=this.generator;
  void(async()=>{const trip:Trip={id:randomUUID(),scene:'forest',startedAt:this.now(),dueAt:this.now(),status:'generating'};let stage='preparing';const update=(next:string)=>{stage=next in phases?next:stage;atomicJson(this.file(),{passed:false,pending:true,fingerprint,stage,at:this.now()});};try{trip.generation=generator.prepare?.(trip);const artifact=await generator(trip,AbortSignal.any([controller.signal,AbortSignal.timeout(1200000)]),update);update('checking_output');controller.signal.throwIfAborted();decodePng(Buffer.from(artifact.image));if(!artifact.title?.trim()||!artifact.note?.trim())throw Error('短笺不完整');if(fingerprint!==this.fingerprint())throw Error('验证过程中配置变化');atomicJson(this.file(),{passed:true,at:this.now(),fingerprint});}catch(error){try{atomicJson(this.file(),{passed:false,pending:false,fingerprint,stage,failure:verificationFailure(error,stage),at:this.now()});}catch{}}finally{this.running=false;this.controller=undefined;}})();return this.state();}
 invalidate(){if(this.state().valid)atomicJson(this.file(),{passed:false,fingerprint:this.fingerprint(),at:this.now()});}
 stop(){this.controller?.abort();}
}
