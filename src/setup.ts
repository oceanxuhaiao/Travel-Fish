import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {CHARACTER_PRESETS,presetPath,characterReference} from './characters.ts';
import {readFileSync,statSync,mkdirSync,writeFileSync,existsSync} from 'node:fs';
import {decodePng} from './generation.ts';
import type {PostcardConfigSection} from './config.ts';
export interface SetupSecrets {secret:(name:string)=>string;storeSecret:(name:string,value:string)=>void;}
const names={ark:'POSTCARD_ARK_API_KEY',vision:'POSTCARD_VISION_API_KEY'};
export class SetupPanel {
 constructor(private cfg:PostcardConfigSection,private secrets?:SetupSecrets,private importRoot?:string){}
 snapshot(){return {keys:{ark:!!this.secrets?.secret(names.ark),vision:!!this.secrets?.secret(names.vision)},secureSaveAvailable:!!this.secrets,characterPreset:this.cfg.characterPreset??'auto',presets:CHARACTER_PRESETS,useHostModel:!!this.cfg.useHostModel,cloudEnabled:this.cfg.cloudEnabled,characterReference:this.cfg.characterReference,styleReference:this.cfg.styleReference};}
 invoke(method:string,args:unknown[]=[]):unknown {
  if(method==='importCharacter'){
   if(!this.importRoot||typeof args[0]!=='string')throw new Error('请选择本机PNG文件');
   let bytes:Buffer;try{if(statSync(args[0]).size>40*1024*1024)throw new Error();bytes=readFileSync(args[0]);decodePng(bytes);}catch{throw new Error('角色PNG不可读取或格式/尺寸不合规');}
   mkdirSync(this.importRoot,{recursive:true});const file=join(this.importRoot,createHash('sha256').update(bytes).digest('hex')+'.png');if(!existsSync(file))writeFileSync(file,bytes,{flag:'wx'});return {path:file};
  }
  if(method==='reference'){const bytes=readFileSync(presetPath(String(args[0])));return {$binary:{mime:'image/png',base64:bytes.toString('base64')}};}
  if(method==='snapshot')return this.snapshot();
  if(method==='setKey'){
   const [provider,value]=args;
   if((provider!=='ark'&&provider!=='vision')||typeof value!=='string'||!value.trim()||value.trim().length>2048||/[\s"'`]/.test(value.trim()))throw new Error('请选择服务并填写有效的 API Key（不能含空白或引号）。');
   if(!this.secrets)throw new Error('当前宿主没有提供密钥保存接口。');
   try{this.secrets.storeSecret(names[provider],value.trim());}catch{throw new Error('密钥未能保存，请检查扩展部署目录的写入权限。');}
   return this.snapshot();
  }
  if(method==='check'){
   const s=this.snapshot();
   const reference=(path:string)=>{try{if(statSync(path).size>40*1024*1024)return false;decodePng(readFileSync(path));return true;}catch{return false;}};
   const proxy=(value:string)=>{if(!value)return true;try{return ['http:','https:'].includes(new URL(value).protocol);}catch{return false;}};
   return {useHostModel:s.useHostModel,visionKeyRequired:!s.useHostModel,keys:s.keys,characterReference:(()=>{try{return reference(characterReference(this.cfg));}catch{return false;}})(),styleReference:reference(this.cfg.styleReference),imageProxy:proxy(this.cfg.imageProxyUrl),visionProxy:proxy(this.cfg.visionProxyUrl),cloudEnabled:s.cloudEnabled};
  }
  throw new Error('未知配置操作');
 }
}
