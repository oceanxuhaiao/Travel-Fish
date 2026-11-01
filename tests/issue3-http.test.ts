import {it,expect,vi} from 'vitest';
import {mkdtempSync,writeFileSync,readFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {PNG} from 'pngjs';
import {createCloudGenerator} from '../src/generation.ts';

const note='沿着小路走了一阵，在安静的风景里停留。一路上的颜色让我想起把这一刻留给你，虽然只是一小片远方，放进信里时却觉得很满足。希望你翻到这里的时候，也能有片刻轻轻的好心情。';
const png=()=>{const p=new PNG({width:512,height:768});p.data.fill(255);return PNG.sync.write(p);};
const jpeg=Buffer.from([0xff,0xd8,0xff,0xe0,0x00,0x10,0x4a,0x46,0x49,0x46,0x00,0x01]);

it('真实HTTP：兼容接口PNG偏好写入请求，JPEG/拒绝output_format均有可辨原因且不自动重发',async()=>{
 const root=mkdtempSync(join(tmpdir(),'postcard-issue3-http-')),image=png();
 let mode:'png'|'jpeg'|'reject'='png';
 const imageRequests:any[]=[];
 const server=createServer(async(req,res)=>{
  let text='';for await(const b of req)text+=b;
  const payload=JSON.parse(text);imageRequests.push(payload);
  res.setHeader('Content-Type','application/json');
  if(mode==='reject'&&payload.output_format){res.statusCode=400;res.end(JSON.stringify({error:'unsupported output_format'}));return;}
  if(mode==='jpeg'){res.end(JSON.stringify({data:[{b64_json:jpeg.toString('base64')}]}));return;}
  res.end(JSON.stringify({data:[{b64_json:image.toString('base64')}]}));
 });
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 const port=(server.address() as any).port;
 const ref=join(root,'ref.png');writeFileSync(ref,image);
 const host=vi.fn(async(_kind:any,payload:any)=>{
  const prompt=payload.messages[0].content[0].text;
  const result=prompt.startsWith('图1为候选')?{scene_match:true,character_match:true,usable:true,background_conflicts:[],issues:[],facts:['单个角色','林间小路','远处树影']}
   :prompt.startsWith('写桌宠旅行')?{title:'林间停留的一刻',note}
   :prompt.startsWith('只检查文字')?{has_real_place_name:false,names:[]}
   :{checks:[],has_explicit_conflict:false,conflicts:[],uncertain_details:[]};
  return {model:'host-model',choices:[{finish_reason:'stop',message:{content:JSON.stringify(result)}}]};
 });
 const base:any={root,imageBackend:'compatible',imageBaseUrl:'http://127.0.0.1:'+port+'/v1',imageSize:'1024x1536',imageModel:'local-painter',useHostModel:true,hostReady:()=>true,hostTransport:host,characterReference:ref,styleReference:ref,secret:()=>''};
 const trip=()=>({id:randomUUID(),scene:'forest',startedAt:0,dueAt:7200000,status:'traveling'} as any);
 try{
  const one=trip(),g1=createCloudGenerator({...base,requestPngOutput:true});one.generation=g1.prepare!(one);
  const card=await g1(one,new AbortController().signal);
  expect(card.image).toEqual(image);
  expect(imageRequests.at(-1).output_format).toBe('png');expect(imageRequests.at(-1).watermark).toBeUndefined();

  mode='reject';const two=trip(),g2=createCloudGenerator({...base,requestPngOutput:true});two.generation=g2.prepare!(two);
  const beforeReject=imageRequests.length;
  await expect(g2(two,new AbortController().signal)).rejects.toThrow('output_format');
  expect(imageRequests.length-beforeReject).toBe(1);

  mode='jpeg';const three=trip(),g3=createCloudGenerator({...base,requestPngOutput:true});three.generation=g3.prepare!(three);
  const beforeJpeg=imageRequests.length;
  await expect(g3(three,new AbortController().signal)).rejects.toThrow('返回了JPEG');
  expect(imageRequests.length-beforeJpeg).toBe(1);
  expect(readFileSync(join(root,'trips',three.id,'image-1-raw.bin'))).toEqual(jpeg);
  expect(existsSync(join(root,'trips',three.id,'image-1.png'))).toBe(false);

  mode='png';const four=trip(),g4=createCloudGenerator({...base,requestPngOutput:false});four.generation=g4.prepare!(four);
  const result=await g4(four,new AbortController().signal);
  expect(result.image).toEqual(image);
  expect(imageRequests.at(-1).output_format).toBeUndefined();
 }finally{
  await new Promise<void>(resolve=>server.close(()=>resolve()));
  rmSync(root,{recursive:true,force:true});
 }
});
