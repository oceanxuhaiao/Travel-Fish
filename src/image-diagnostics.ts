import {mkdirSync,writeFileSync,renameSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {ImageFailure} from './image-failure.ts';

export const MAX_IMAGE_RESPONSE_BYTES=64*1024*1024;
const MAX_IMAGE_BYTES=40*1024*1024;
const MAX_PARTS=64;
const sha=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
export function imageFormat(bytes:Buffer){return bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'))?'PNG':bytes.subarray(0,3).equals(Buffer.from([255,216,255]))?'JPEG':bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP'?'WebP':'unknown';}
export function nativeImageBytes(value:unknown):Buffer {
 if(typeof value!=='string'||!value.length)throw new ImageFailure('IMAGE_BASE64');
 if(value.length>56*1024*1024)throw new ImageFailure('IMAGE_LIMIT');
 const text=value.replace(/\s+/g,'');
 if(!text.length||!/^[A-Za-z0-9+/]+={0,2}$/.test(text)||text.length%4===1)throw new ImageFailure('IMAGE_BASE64');
 const bytes=Buffer.from(text,'base64');
 if(!bytes.length||bytes.toString('base64').replace(/=+$/,'')!==text.replace(/=+$/,''))throw new ImageFailure('IMAGE_BASE64');
 if(bytes.length>MAX_IMAGE_BYTES)throw new ImageFailure('IMAGE_LIMIT');
 return bytes;
}
const finishValues=new Set(['STOP','MAX_TOKENS','SAFETY','RECITATION','LANGUAGE','OTHER','BLOCKLIST','PROHIBITED_CONTENT','SPII','MALFORMED_FUNCTION_CALL','IMAGE_SAFETY','IMAGE_PROHIBITED_CONTENT','IMAGE_OTHER','NO_IMAGE','FINISH_REASON_UNSPECIFIED']);
export function safeFinish(value:unknown){return typeof value==='string'&&finishValues.has(value)?value:'unknown';}
const mime=(v:unknown)=>['image/png','image/jpeg','image/webp'].includes(v as string)?String(v):'unknown';
/** Only allowlisted metadata and image bytes are retained, never raw JSON/text/headers. */
export class GeminiDiagnostics {
 readonly id='gemini-'+randomUUID();private started=Date.now();private folder:string;private state:Record<string,unknown>={schema:1,backend:'gemini',phase:'requesting'};
 constructor(root:string){this.folder=join(root,'diagnostics',this.id);}
 private file(name:string,bytes:Buffer|string){
  const dest=join(this.folder,name),temp=dest+'.'+randomUUID()+'.tmp';
  try{mkdirSync(this.folder,{recursive:true});writeFileSync(temp,bytes,{flag:'wx'});renameSync(temp,dest);}
  catch{try{unlinkSync(temp);}catch{}throw new ImageFailure('IMAGE_SAVE',this.state.responseComplete===true?'received':'unknown',this.id);}
 }
 update(fields:Record<string,unknown>){Object.assign(this.state,fields);this.file('summary.json',JSON.stringify({...this.state,diagnosticId:this.id,elapsedMs:Date.now()-this.started},null,2));}
 headers(status:number,contentType:string|null){this.update({phase:'receiving',httpStatus:status,contentType:contentType?.split(';')[0].trim().toLowerCase()==='application/json'?'application/json':'other'});}
 received(bytes:number){this.update({phase:'parsing',responseBytes:bytes,responseComplete:true});}
 images(value:any){
  const candidates=Array.isArray(value?.candidates)?value.candidates:[];
  const parts=Array.isArray(candidates[0]?.content?.parts)?candidates[0].content.parts:[];
  const entries:Record<string,unknown>[]=[];let saved=0;
  // Bound metadata and total saved image bytes, including thought images.
  for(let index=0;index<Math.min(parts.length,MAX_PARTS);index++){
   const part=parts[index],image=part?.inlineData??part?.inline_data;
   const entry:Record<string,unknown>={index,thought:part?.thought===true,type:image?'inlineImage':typeof part?.text==='string'?'text':'other'};
   if(image){entry.mime=mime(image.mimeType??image.mime_type);try{
    const bytes=nativeImageBytes(image.data);entry.bytes=bytes.length;entry.format=imageFormat(bytes);entry.sha256=sha(bytes);
    if(saved+bytes.length<=MAX_IMAGE_BYTES){this.file('part-'+index+'-raw.bin',bytes);saved+=bytes.length;entry.saved=true;}else entry.saved=false;
   }catch(error){if(error instanceof ImageFailure&&error.code==='IMAGE_SAVE')throw error;entry.decodeError=error instanceof ImageFailure?error.code:'IMAGE_BASE64';}}
   entries.push(entry);
  }
  const block=value?.promptFeedback?.blockReason;
  this.update({phase:'normalizing',candidateCount:candidates.length,finishReason:safeFinish(candidates[0]?.finishReason),blocked:typeof block==='string'&&block!=='BLOCK_REASON_UNSPECIFIED',partCount:parts.length,partsTruncated:parts.length>MAX_PARTS,parts:entries});
 }
 failure(error:ImageFailure,transportCode='unknown'){this.update({phase:'failed',failure:error.info(),transportCode});}
}
