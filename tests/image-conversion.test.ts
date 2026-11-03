import {it,expect} from 'vitest';
import sharp from 'sharp';
import {PNG} from 'pngjs';
import {imageToPng} from '../src/image-conversion.ts';
import {imageFormat} from '../src/image-diagnostics.ts';
import {decodePng} from '../src/generation.ts';
const signal=()=>new AbortController().signal;
const picture=()=>sharp({create:{width:512,height:768,channels:4,background:{r:40,g:100,b:200,alpha:0.4}}});

it('PNG stays byte-identical and does not produce a conversion record',async()=>{
 const input=await picture().png().toBuffer();const r=await imageToPng(input,signal());expect(r.bytes).toBe(input);expect(r.conversion).toBeUndefined();
});
it.each(['jpeg','webp'] as const)('%s is decoded and encoded as valid PNG without resizing',async format=>{
 const input=await picture().toFormat(format).toBuffer(),r=await imageToPng(input,signal());
 expect(imageFormat(r.bytes)).toBe('PNG');expect(decodePng(r.bytes)).toEqual({width:512,height:768});
 expect(r.conversion).toMatchObject({sourceFormat:format==='jpeg'?'JPEG':'WebP',sourceBytes:input.length,outputFormat:'PNG',outputBytes:r.bytes.length,width:512,height:768});
 expect(r.conversion!.sourceSha256).not.toBe(r.conversion!.outputSha256);
});
it('lossless WebP retains RGB and alpha exactly after PNG conversion',async()=>{
 const input=await picture().webp({lossless:true}).toBuffer(),r=await imageToPng(input,signal());
 const original=await sharp(input).ensureAlpha().raw().toBuffer(),output=PNG.sync.read(r.bytes);
 expect(output.data).toEqual(original);expect(output.data[3]).toBeGreaterThan(0);expect(output.data[3]).toBeLessThan(255);
});
it('EXIF orientation is applied once and metadata is removed',async()=>{
 const input=await picture().jpeg().withMetadata({orientation:6}).toBuffer(),r=await imageToPng(input,signal());
 expect(decodePng(r.bytes)).toEqual({width:768,height:512});expect(r.conversion?.autoOriented).toBe(true);
 const meta=await sharp(r.bytes).metadata();expect(meta.orientation).toBeUndefined();expect(meta.exif).toBeUndefined();
});
it('animated WebP is rejected instead of silently extracting its first frame',async()=>{
 const frames=Buffer.alloc(512*1024*4,100);frames.fill(200,512*512*4);
 const input=await sharp(frames,{raw:{width:512,height:1024,channels:4,pageHeight:512}}).webp({loop:0,delay:[60,60]}).toBuffer();
 expect((await sharp(input).metadata()).pages).toBe(2);
 await expect(imageToPng(input,signal())).rejects.toMatchObject({code:'IMAGE_ANIMATED'});
});
it.each([[511,768],[512,511],[4097,512],[512,4097]])('dimensions %s×%s are rejected without resize',async(width,height)=>{
 const input=await sharp({create:{width,height,channels:3,background:'red'}}).jpeg().toBuffer();
 await expect(imageToPng(input,signal())).rejects.toMatchObject({code:'IMAGE_DIMENSIONS'});
});
it('truncated JPEG/WebP, disguised content and unsupported formats fail safely',async()=>{
 for(const input of [Buffer.from([255,216,255]),Buffer.from('RIFF0000WEBP'),(await picture().jpeg().toBuffer()).subarray(0,120),Buffer.from('<svg/>')])await expect(imageToPng(input,signal())).rejects.toMatchObject({code:expect.stringMatching(/^IMAGE_(DECODE|FORMAT)$/)});
});
it('forged huge JPEG dimensions are rejected before pixel decoding',async()=>{
 const input=await picture().jpeg().toBuffer(),index=input.indexOf(Buffer.from([255,192]));expect(index).toBeGreaterThan(0);
 input.writeUInt16BE(65535,index+5);input.writeUInt16BE(65535,index+7);
 await expect(imageToPng(input,signal())).rejects.toMatchObject({code:expect.stringMatching(/^IMAGE_(DECODE|DIMENSIONS)$/)});
});
it('byte limit and abort are enforced without returning a partial image',async()=>{
 await expect(imageToPng(Buffer.alloc(40*1024*1024+1),signal())).rejects.toMatchObject({code:'IMAGE_LIMIT'});
 const c=new AbortController();c.abort();await expect(imageToPng(await picture().jpeg().toBuffer(),c.signal)).rejects.toBeDefined();
});
