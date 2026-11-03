import {it,expect,vi} from 'vitest';
import {createServer,type ServerResponse} from 'node:http';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,readdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {PNG} from 'pngjs';
import {createCloudGenerator,cloudTransport,type CloudOptions} from '../src/generation.ts';
import {ReadinessCheck,verificationFailure} from '../src/readiness.ts';
import {POSTCARD_DEFAULTS} from '../src/config.ts';
import {ImageFailure,imageNetworkFailure} from '../src/image-failure.ts';
import {normalizeImageResponse} from '../src/image-protocol.ts';
import {nativeImageBytes,MAX_IMAGE_RESPONSE_BYTES} from '../src/image-diagnostics.ts';
import type {Trip} from '../src/travel.ts';

const png=PNG.sync.write(new PNG({width:512,height:768}));
const final=(bytes=png,mime='image/png')=>({inlineData:{mimeType:mime,data:bytes.toString('base64')}});
const response=(parts:any[]=[final()],finishReason='STOP')=>({candidates:[{finishReason,content:{parts}}]});
async function local(run:(res:ServerResponse)=>void,work:(options:CloudOptions,root:string,calls:()=>number)=>Promise<void>){
 const root=mkdtempSync(join(tmpdir(),'postcard-gemini-'));let count=0;
 const server=createServer((req,res)=>{req.resume();req.on('end',()=>{count++;run(res);});});
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 const ref=join(root,'ref.png');writeFileSync(ref,png);
 const options:CloudOptions={root,characterReference:ref,styleReference:ref,secret:()=> 'secret-test-only',imageBackend:'gemini',imageBaseUrl:'http://127.0.0.1:'+(server.address() as any).port+'/v1beta',imageModel:'gemini-3-pro-image',imageSize:'2K'};
 try{await work(options,root,()=>count);}finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));rmSync(root,{recursive:true,force:true});}
}
const diagnostic=(root:string)=>{const dir=join(root,'diagnostics',readdirSync(join(root,'diagnostics'))[0]);return {dir,summary:JSON.parse(readFileSync(join(dir,'summary.json'),'utf8'))};};
const trip=():Trip=>({id:randomUUID(),scene:'forest',startedAt:0,dueAt:1,status:'generating'});
const send=(value:unknown)=>(res:ServerResponse)=>{res.writeHead(200,{'Content-Type':'application/json','x-secret-test':'secret-test-only'});res.end(JSON.stringify(value));};

it.each([
 ['jpeg',response([final(Buffer.from([255,216,255,1]),'image/jpeg')]),'IMAGE_FORMAT'],
 ['webp',response([final(Buffer.from('RIFF0000WEBP'),'image/webp')]),'IMAGE_FORMAT'],
 ['incomplete',response([final()],'MAX_TOKENS'),'IMAGE_INCOMPLETE'],
 ['blocked',{promptFeedback:{blockReason:'SAFETY'}},'IMAGE_BLOCKED'],
 ['none',{candidates:[]},'IMAGE_NO_OUTPUT'],
 ['text-only',response([{text:'secret-test-only private text'}]),'IMAGE_NO_OUTPUT'],
 ['multiple',response([final(),final()]),'IMAGE_STRUCTURE'],
 ['bad-parts',{candidates:[{finishReason:'STOP',content:{parts:{}}}]},'IMAGE_STRUCTURE'],
 ['invalid-base64',response([{inlineData:{mimeType:'image/png',data:'%%%'}}]),'IMAGE_BASE64'],
 ['mime-mismatch',response([final(Buffer.from([255,216,255]),'image/png')]),'IMAGE_FORMAT'],
] as const)('%s crosses real HTTP → generator → readiness and survives restart without another request',async(_name,value,code)=>{
 await local(send(value),async(options,root,calls)=>{
  const g=createCloudGenerator(options),t=trip();t.generation=g.prepare!(t);
  let failure:unknown;try{await g(t,new AbortController().signal);}catch(error){failure=error;}
  expect(failure).toBeInstanceOf(ImageFailure);
  expect(verificationFailure(failure,'generating_image')).toMatchObject({code,outcome:'received',diagnosticId:expect.stringMatching(/^gemini-/)});
  const cp=JSON.parse(readFileSync(join(root,'trips',t.id,'checkpoint.json'),'utf8'));
  expect(cp).toMatchObject({pendingImage:true,imageAttempt:1,imageFailure:{code}});
  const again=createCloudGenerator(options);
  await expect(again(t,new AbortController().signal)).rejects.toMatchObject({code,diagnosticId:(failure as ImageFailure).diagnosticId});
  expect(()=>again.confirmRetry!(t,false)).toThrow('确认');expect(calls()).toBe(1);
  const d=diagnostic(root);expect(d.summary).toMatchObject({httpStatus:200,contentType:'application/json',failure:{code}});
  expect(JSON.stringify(d.summary)).not.toContain('secret-test-only');expect(JSON.stringify(d.summary)).not.toContain('private text');
  if(['jpeg','webp','incomplete','multiple','mime-mismatch'].includes(_name))expect(readdirSync(d.dir)).toContain('part-0-raw.bin');
 });
});

it('ReadinessCheck saves typed failure and diagnostic ID across a new instance',async()=>{
 await local(send(response([final(Buffer.from([255,216,255]),'image/jpeg')])),async(options,root,calls)=>{
  const cfg={...POSTCARD_DEFAULTS,imageBackend:'gemini' as const,imageBaseUrl:options.imageBaseUrl,imageModel:options.imageModel!,imageSize:'2K',characterPreset:'custom',characterReference:options.characterReference,styleReference:options.styleReference};
  const make=()=>new ReadinessCheck(root,cfg,options.secret,()=> 'fake-host',createCloudGenerator(options));
  const check=make();check.start();
  const end=Date.now()+4000;while(check.state().phase==='checking'&&Date.now()<end)await new Promise(r=>setTimeout(r,10));
  expect(make().state()).toMatchObject({phase:'failed',valid:false,failure:{code:'IMAGE_FORMAT',diagnosticId:diagnostic(root).summary.diagnosticId}});
  expect(calls()).toBe(1);expect(readdirSync(root)).not.toContain('collection');
 });
});

it('mixed text, thought image and final PNG pass through HTTP and the full image/note pipeline once',async()=>{
 await local(send(response([{thought:true,...final()},{text:'private description'},final()])),async(options,root,calls)=>{
  const text=vi.fn(async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify({})}}]}));
  // Exercise the original text checks with deterministic local answers.
  const transport=cloudTransport(options);
  const g=createCloudGenerator(options,async(k,p,s,r)=>{
   if(k==='image')return transport(k,p,s,r);
   text();const prompt=(p.messages as any[])[0].content[0].text as string;
   const value=prompt.startsWith('图1为候选')?{scene_match:true,character_match:true,usable:true,background_conflicts:[],issues:[],facts:['树林','女孩','溪流']}:prompt.startsWith('写桌宠旅行')?{title:'树影里的小小来信',note:'我在树影里停留了一会儿，看着微光慢慢落下来。这里安静得能让人忘记赶路，只想把这份轻松装进信封，寄到你的桌边，希望你也能歇一歇。'}:prompt.startsWith('只检查文字')?{has_real_place_name:false,names:[]}:{checks:[],has_explicit_conflict:false,conflicts:[],uncertain_details:[]};
   return {choices:[{finish_reason:'stop',message:{content:JSON.stringify(value)}}]};
  });
  const t=trip();t.generation=g.prepare!(t);const card=await g(t,new AbortController().signal);
  expect(card.image).toEqual(png);await g(t,new AbortController().signal);expect(calls()).toBe(1);expect(text).toHaveBeenCalled();
  const d=diagnostic(root);expect(d.summary).toMatchObject({phase:'normalized',partCount:3});expect(readFileSync(join(d.dir,'part-2-raw.bin'))).toEqual(png);
 });
});

it.each([401,408,429,500])('HTTP %s keeps status and local diagnostic ID',async status=>{
 await local(res=>{res.writeHead(status);res.end('secret-test-only private body');},async(options,root,calls)=>{
  const g=createCloudGenerator(options),t=trip();t.generation=g.prepare!(t);let e:unknown;try{await g(t,new AbortController().signal);}catch(error){e=error;}
  expect(verificationFailure(e,'generating_image')).toMatchObject({code:'HTTP_'+status,diagnosticId:diagnostic(root).summary.diagnosticId});expect(calls()).toBe(1);
  expect(JSON.stringify(diagnostic(root).summary)).not.toContain('secret-test-only');
  if(status===500||status===408)await expect(g(t,new AbortController().signal)).rejects.toMatchObject({status});
  expect(calls()).toBe(1);
 });
});

it('invalid JSON stays IMAGE_JSON and never saves response text',async()=>{
 await local(res=>res.end('secret-test-only this is not JSON'),async(options,root)=>{
  const g=createCloudGenerator(options),t=trip();t.generation=g.prepare!(t);
  await expect(g(t,new AbortController().signal)).rejects.toMatchObject({code:'IMAGE_JSON'});
  const d=diagnostic(root);expect(d.summary.responseBytes).toBeGreaterThan(0);expect(readdirSync(d.dir)).toEqual(['summary.json']);expect(JSON.stringify(d.summary)).not.toContain('secret-test-only');
 });
});

it('broken socket and abort keep separate NETWORK / TIMEOUT / INTERRUPTED classifications',async()=>{
 await local(res=>res.destroy(),async(options,root,calls)=>{
  const g=createCloudGenerator(options),t=trip();t.generation=g.prepare!(t);
  await expect(g(t,new AbortController().signal)).rejects.toMatchObject({code:'NETWORK',outcome:'unknown'});expect(calls()).toBe(1);
  expect(diagnostic(root).summary.failure.code).toBe('NETWORK');
 });
 for(const [name,expected] of [['TimeoutError','TIMEOUT'],['AbortError','INTERRUPTED']] as const){
  await local(()=>{},async(options,root,calls)=>{
   const controller=new AbortController(),g=createCloudGenerator(options),t=trip();t.generation=g.prepare!(t);
   const timer=setTimeout(()=>controller.abort(new DOMException('private text',name)),60);
   try{await expect(g(t,controller.signal)).rejects.toMatchObject({code:expected,outcome:'unknown'});}finally{clearTimeout(timer);}
   expect(calls()).toBe(1);expect(diagnostic(root).summary.failure.code).toBe(expected);
  });
 }
 for(const code of ['UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT','UND_ERR_CONNECT_TIMEOUT'])expect(imageNetworkFailure({cause:{code}},new AbortController().signal).code).toBe('TIMEOUT');
});

it('unwritable diagnostic destination reports IMAGE_SAVE without another image request',async()=>{
 await local(send(response()),async(options,root,calls)=>{
  writeFileSync(join(root,'diagnostics'),'occupied');const g=createCloudGenerator(options),t=trip();t.generation=g.prepare!(t);
  await expect(g(t,new AbortController().signal)).rejects.toMatchObject({code:'IMAGE_SAVE'});
  await expect(g(t,new AbortController().signal)).rejects.toMatchObject({code:'IMAGE_SAVE'});expect(calls()).toBe(1);
 });
});

it('response limit is enforced during receive, and original PNG survives a later CRC failure',async()=>{
 await local(res=>{res.writeHead(200);res.end('x'.repeat(MAX_IMAGE_RESPONSE_BYTES+1));},async(options)=>{
  await expect(cloudTransport(options)('image',{model:options.imageModel,size:'2K',prompt:'test',image:['data:image/png;base64,YQ==','data:image/png;base64,YQ==']},new AbortController().signal)).rejects.toMatchObject({code:'IMAGE_LIMIT'});
 });
 const corrupt=Buffer.from(png);corrupt[corrupt.length-20]^=0xff;
 await local(send(response([final(corrupt)])),async(options,root,calls)=>{
  const g=createCloudGenerator(options),t=trip();t.generation=g.prepare!(t);
  await expect(g(t,new AbortController().signal)).rejects.toMatchObject({code:'IMAGE_FORMAT',outcome:'received',diagnosticId:expect.stringMatching(/^gemini-/)});
  expect(readFileSync(join(diagnostic(root).dir,'part-0-raw.bin'))).toEqual(corrupt);expect(calls()).toBe(1);
 });
});

it('candidate-file save failure remains IMAGE_SAVE after restart, preserving the original response',async()=>{
 await local(send(response()),async(options,root,calls)=>{
  const g=createCloudGenerator(options),t=trip();t.generation=g.prepare!(t);
  mkdirSync(join(root,'trips',t.id,'image-1.png.json'));
  await expect(g(t,new AbortController().signal)).rejects.toMatchObject({code:'IMAGE_SAVE',outcome:'received'});
  await expect(createCloudGenerator(options)(t,new AbortController().signal)).rejects.toMatchObject({code:'IMAGE_SAVE',outcome:'received'});
  expect(calls()).toBe(1);expect(readFileSync(join(diagnostic(root).dir,'part-0-raw.bin'))).toEqual(png);
 });
});

it('invalid shapes/base64 are typed; snake_case images remain supported',async()=>{
 for(const value of [null,{},[],{candidates:[null]},response([null])])await expect(normalizeImageResponse('gemini',value as any,vi.fn())).rejects.toBeInstanceOf(ImageFailure);
 for(const value of ['', 'A','%%%','Zh=='])expect(()=>nativeImageBytes(value)).toThrow(ImageFailure);
 expect(nativeImageBytes('TWE')).toEqual(Buffer.from('Ma'));
 await expect(normalizeImageResponse('gemini',response([{inline_data:{mime_type:'image/png',data:png.toString('base64')}}]),vi.fn())).resolves.toMatchObject({data:[{b64_json:png.toString('base64')}]});
});
