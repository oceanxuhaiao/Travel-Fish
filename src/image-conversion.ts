import {createHash} from 'node:crypto';
import {imageFormat} from './image-diagnostics.ts';
import {ImageFailure} from './image-failure.ts';

const MAX_BYTES=40*1024*1024;
const MAX_PIXELS=4096*4096;
const sha=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
/** Decode only recognized single-frame raster formats, without resizing or cropping. */
export async function imageToPng(input:Buffer,signal:AbortSignal){
 if(signal.aborted)throw new ImageFailure(signal.reason?.name==='TimeoutError'?'TIMEOUT':'INTERRUPTED','received');
 const format=imageFormat(input);
 if(input.length>MAX_BYTES)throw new ImageFailure('IMAGE_LIMIT');
 if(format==='PNG')return {bytes:input,conversion:undefined};
 if(format!=='JPEG'&&format!=='WebP')throw new ImageFailure('IMAGE_FORMAT');
 let sharp:typeof import('sharp')['default'];
 try{sharp=(await import('sharp')).default;}catch{throw new ImageFailure('IMAGE_CONVERTER');}
 try{
  const options={failOn:'warning' as const,limitInputPixels:MAX_PIXELS,sequentialRead:true};
  const metadata=await sharp(input,options).metadata();
  if(metadata.format!==(format==='JPEG'?'jpeg':'webp'))throw new ImageFailure('IMAGE_FORMAT');
  if((metadata.pages??1)!==1||metadata.loop!==undefined||metadata.delay?.length)throw new ImageFailure('IMAGE_ANIMATED');
  if(!metadata.width||!metadata.height||metadata.width<512||metadata.height<512||metadata.width>4096||metadata.height>4096)throw new ImageFailure('IMAGE_DIMENSIONS');
  signal.throwIfAborted();
  const {data,info}=await sharp(input,options).rotate().toColourspace('srgb').png({compressionLevel:6}).timeout({seconds:30}).toBuffer({resolveWithObject:true});
  signal.throwIfAborted();
  if(data.length>MAX_BYTES)throw new ImageFailure('IMAGE_LIMIT');
  if(info.width<512||info.height<512||info.width>4096||info.height>4096)throw new ImageFailure('IMAGE_DIMENSIONS');
  return {bytes:data,conversion:{schema:1,policy:'single-frame-to-png-v1',decoder:'sharp-0.35.5',sourceFormat:format,sourceBytes:input.length,sourceSha256:sha(input),outputFormat:'PNG',outputBytes:data.length,outputSha256:sha(data),width:info.width,height:info.height,autoOriented:!!metadata.orientation,metadataStripped:true}};
 }catch(error){
  if(signal.aborted)throw new ImageFailure(signal.reason?.name==='TimeoutError'?'TIMEOUT':'INTERRUPTED','received');
  if(error instanceof ImageFailure)throw error;
  throw new ImageFailure('IMAGE_DECODE');
 }
}
