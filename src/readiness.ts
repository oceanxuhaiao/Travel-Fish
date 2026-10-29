import {createHash,randomUUID} from 'node:crypto';
import {readFileSync,statSync} from 'node:fs';
import {join} from 'node:path';
import {atomicJson,type Generator,type Trip} from './travel.ts';
import {characterReference,styleReference} from './characters.ts';
import {decodePng} from './generation.ts';
import type {PostcardConfigSection} from './config.ts';
export class ReadinessCheck {
 private running=false;private controller?:AbortController;
 constructor(private root:string,private cfg:PostcardConfigSection,private secret:(n:string)=>string,private model:()=>string,private generator?:Generator,private now=()=>Date.now()){}
 private fingerprint(){try{return createHash('sha256').update(JSON.stringify({settings:[this.cfg.cloudEnabled,this.cfg.useHostModel,this.cfg.imageBackend,this.cfg.imageModel,this.cfg.imageBaseUrl,this.cfg.imageSize,this.cfg.imageProxyUrl,this.cfg.visionProxyUrl],model:this.model(),keys:['POSTCARD_ARK_API_KEY','POSTCARD_IMAGE_API_KEY','POSTCARD_VISION_API_KEY'].map(n=>this.secret(n)),refs:[characterReference(this.cfg),styleReference(this.cfg)].map(p=>{const s=statSync(p,{bigint:true});return [p,String(s.size),String(s.mtimeNs),String(s.ctimeNs)];})})).digest('hex');}catch{return '';}}
 private file(){return join(this.root,'readiness.json');}
 state(){let r:any;try{r=JSON.parse(readFileSync(this.file(),'utf8'));}catch{}const fingerprint=this.fingerprint();return {phase:this.running?'checking':r?.passed===true&&fingerprint&&r.fingerprint===fingerprint&&this.now()>=r.at?'passed':'required',valid:!this.running&&r?.passed===true&&!!fingerprint&&r.fingerprint===fingerprint&&this.now()>=r.at,checkedAt:r?.passed===true?r.at:null};}
 start(){if(this.running)return this.state();if(!this.generator)throw Error('生图服务尚未启用，不能验证');const fingerprint=this.fingerprint();if(!fingerprint)throw Error('配置或参考图不完整');atomicJson(this.file(),{passed:false,at:this.now()});this.running=true;this.controller=new AbortController();const controller=this.controller,generator=this.generator;
  void(async()=>{const trip:Trip={id:randomUUID(),scene:'forest',startedAt:this.now(),dueAt:this.now(),status:'generating'};try{trip.generation=generator.prepare?.(trip);const artifact=await generator(trip,AbortSignal.any([controller.signal,AbortSignal.timeout(1200000)]));controller.signal.throwIfAborted();decodePng(Buffer.from(artifact.image));if(!artifact.title?.trim()||!artifact.note?.trim())throw Error('短笺不完整');if(fingerprint!==this.fingerprint())throw Error('验证过程中配置变化');atomicJson(this.file(),{passed:true,at:this.now(),fingerprint});}catch{try{atomicJson(this.file(),{passed:false,at:this.now()});}catch{}}finally{this.running=false;this.controller=undefined;}})();return this.state();}
 invalidate(){if(this.state().valid)atomicJson(this.file(),{passed:false,at:this.now()});}
 stop(){this.controller?.abort();}
}
