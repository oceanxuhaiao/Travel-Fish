import {imageKeyName,validateImageSettings} from './image-protocol.ts';
import {join,basename} from 'node:path';
import {createHash} from 'node:crypto';
import {CHARACTER_PRESETS,presetPath,characterReference,styleReference} from './characters.ts';
import {readFileSync,statSync,mkdirSync,writeFileSync,existsSync,readdirSync} from 'node:fs';
import {decodePng} from './generation.ts';
import {costEstimate} from './cost.ts';
import type {PostcardConfigSection} from './config.ts';
export interface SetupSecrets {secret:(name:string)=>string;storeSecret:(name:string,value:string)=>void;}
const names={ark:'POSTCARD_ARK_API_KEY',vision:'POSTCARD_VISION_API_KEY',compatible:'POSTCARD_IMAGE_API_KEY',qwen:'POSTCARD_QWEN_API_KEY',gemini:'POSTCARD_GEMINI_API_KEY'};
export class SetupPanel {
 private pendingRestart=false;
 private needsRestart(){return this.pendingRestart||!!this.restartSupport?.required();}
 private referenceCache=new Map<string,{fingerprint:string;valid:boolean}>();
 constructor(private cfg:PostcardConfigSection,private secrets?:SetupSecrets,private importRoot?:string,private hostReady?:()=>boolean,private validation?:{state:()=>{valid:boolean;phase:string;checkedAt:number|null};start:()=>unknown},private restartSupport?:{required:()=>boolean;restart:()=>Promise<void>;appliedModel:()=>string}){}
 library(){
  const items:Array<{id:string;label:string;path:string}>=[];
  if(this.importRoot&&existsSync(this.importRoot))for(const file of readdirSync(this.importRoot).filter(n=>/^[a-f0-9]{64}\.png$/.test(n))){let label='我的角色 '+file.slice(0,6);try{const meta=JSON.parse(readFileSync(join(this.importRoot,file+'.json'),'utf8'));if(typeof meta.label==='string')label=meta.label.slice(0,80);}catch{}items.push({id:'custom:'+file.slice(0,-4),label,path:join(this.importRoot,file)});}
  const legacy=this.cfg.characterReference.trim();if(legacy&&existsSync(legacy)&&!items.some(i=>i.path===legacy))items.push({id:'custom-current',label:'已有自定义角色',path:legacy});return items;
 }
 snapshot(){return {restartRequired:this.needsRestart(),keys:{qwen:!!this.secrets?.secret(names.qwen),gemini:!!this.secrets?.secret(names.gemini),ark:!!this.secrets?.secret(names.ark),compatible:!!this.secrets?.secret(names.compatible),vision:!!this.secrets?.secret(names.vision)},secureSaveAvailable:!!this.secrets,characterPreset:this.cfg.characterPreset??'auto',presets:CHARACTER_PRESETS,customReferences:this.library(),imageBackend:this.cfg.imageBackend??'ark',imageBaseUrl:this.cfg.imageBaseUrl??'http://127.0.0.1:8000/v1',imageSize:this.cfg.imageSize??'1024x1536',imageUnitPrice:this.cfg.imageUnitPrice??-1,imageModel:this.cfg.imageModel||'doubao-seedream-5-0-flash-260915',useHostModel:this.cfg.useHostModel??true,hostVisionReady:!!this.hostReady?.(),cloudEnabled:this.cfg.cloudEnabled,characterReference:this.cfg.characterReference,styleReference:this.cfg.styleReference,cost:costEstimate(this.cfg)};}

 invoke(method:string,args:unknown[]=[]):unknown {
  if(method==='importCharacter'){
   if(!this.importRoot||typeof args[0]!=='string')throw new Error('请选择本机PNG文件');
   let bytes:Buffer;try{if(statSync(args[0]).size>30*1024*1024)throw new Error();bytes=readFileSync(args[0]);decodePng(bytes);}catch{throw new Error('角色PNG不可读取或格式/尺寸不合规');}
   mkdirSync(this.importRoot,{recursive:true});const file=join(this.importRoot,createHash('sha256').update(bytes).digest('hex')+'.png');if(!existsSync(file))writeFileSync(file,bytes,{flag:'wx'});writeFileSync(file+'.json',JSON.stringify({label:basename(args[0],'.png').slice(0,80)}));return {path:file,id:'custom:'+createHash('sha256').update(bytes).digest('hex')};
  }
  if(method==='requirements')return {$binary:{mime:'text/markdown; charset=utf-8',base64:readFileSync(new URL('../REFERENCE-REQUIREMENTS.md',import.meta.url)).toString('base64')}};
  if(method==='reference'){const id=String(args[0]);const file=id.startsWith('custom')?this.library().find(i=>i.id===id)?.path:presetPath(id);if(!file)throw Error('未知角色参考图');const bytes=readFileSync(file);return {$binary:{mime:'image/png',base64:bytes.toString('base64')}};}
  if(method==='restartStatus')return {required:this.needsRestart(),supported:!!this.restartSupport,appliedModel:this.restartSupport?.appliedModel()??'',savedModel:this.cfg.imageModel??''};
  if(method==='settingsSaved'){this.pendingRestart=true;return this.invoke('restartStatus');}
  if(method==='restart'){if(!this.restartSupport)throw Error('当前宿主不提供World重启接口，请在World总览重启');return this.restartSupport.restart().then(()=>({restarted:true}));}
  if(method==='verification'&&this.needsRestart())return {valid:false,phase:'restart_required',checkedAt:null,appliedModel:this.restartSupport?.appliedModel()??'',savedModel:this.cfg.imageModel??''};
  if(method==='verification')return this.validation?.state()??{valid:false,phase:'required'};
  if(method==='verify'){if(this.needsRestart())throw Error('配置已保存但尚未应用，请先重启旅行大肥鱼World，再验证；未发起付费请求');if(args[0]!==true)throw Error('验证可能产生生图和宿主模型费用，请先明确确认');const c=this.invoke('check') as {configurationReady:boolean};if(!c.configurationReady)throw Error('配置尚不完整，请先修正本地检查中的问题');if(!this.validation)throw Error('验证通道尚未接入');return this.validation.start();}
  if(method==='snapshot')return this.snapshot();
  if(method==='setKey'){
   const [provider,value]=args;
   if((provider!=='ark'&&provider!=='vision'&&provider!=='compatible'&&provider!=='qwen'&&provider!=='gemini')||typeof value!=='string'||!value.trim()||value.trim().length>2048||/[\s"'`]/.test(value.trim()))throw new Error('请选择服务并填写有效的 API Key（不能含空白或引号）。');
   if(!this.secrets)throw new Error('当前宿主没有提供密钥保存接口。');
   try{this.secrets.storeSecret(names[provider as keyof typeof names],value.trim());}catch{throw new Error('密钥未能保存，请检查扩展部署目录的写入权限。');}
   this.pendingRestart=true;return this.snapshot();
  }
  if(method==='check'){
   const s=this.snapshot();
   const reference=(path:string)=>{try{const stat=statSync(path,{bigint:true});const fingerprint=[stat.size,stat.mtimeNs,stat.ctimeNs].join(':');const cached=this.referenceCache.get(path);if(cached?.fingerprint===fingerprint)return cached.valid;let valid=false;try{if(stat.size<=30n*1024n*1024n){decodePng(readFileSync(path));valid=true;}}catch{}this.referenceCache.set(path,{fingerprint,valid});return valid;}catch{return false;}};
   const proxy=(value:string)=>{if(!value)return true;try{return ['http:','https:'].includes(new URL(value).protocol);}catch{return false;}};
   let endpoint=true;try{validateImageSettings(s.imageBackend,s.imageBaseUrl,s.imageModel,s.imageSize);}catch{endpoint=false;}
   const hostReady=s.useHostModel?s.hostVisionReady:s.keys.vision;const local=(()=>{try{return ['localhost','127.0.0.1','[::1]'].includes(new URL(s.imageBaseUrl).hostname);}catch{return false;}})();const imageReady=endpoint&&(s.imageBackend==='compatible'?(local||s.keys.compatible):!!this.secrets?.secret(imageKeyName(s.imageBackend)));const references=(()=>{try{return reference(characterReference(this.cfg))&&reference(styleReference(this.cfg));}catch{return false;}})();
   const configurationReady=!!(!this.needsRestart()&&s.cloudEnabled&&hostReady&&imageReady&&references&&proxy(this.cfg.imageProxyUrl)&&proxy(this.cfg.visionProxyUrl)&&s.imageModel.trim()&&(s.imageBackend!=='compatible'||s.imageSize.trim()));
   return {configurationReady,restartRequired:this.needsRestart(),verification:this.validation?.state(),readyForTravel:configurationReady&&(!this.validation||this.validation.state().valid),hostVisionReady:s.hostVisionReady,imageEndpoint:endpoint,imageReady,useHostModel:s.useHostModel,visionKeyRequired:!s.useHostModel,keys:s.keys,characterReference:(()=>{try{return reference(characterReference(this.cfg));}catch{return false;}})(),styleReference:reference(styleReference(this.cfg)),imageProxy:proxy(this.cfg.imageProxyUrl),visionProxy:proxy(this.cfg.visionProxyUrl),cloudEnabled:s.cloudEnabled};
  }
  throw new Error('未知配置操作');
 }
}
