import {imageWireRequest,normalizeImageResponse} from '../src/image-protocol.ts';
import { beforeEach,afterEach,it,expect,vi } from 'vitest';
import { mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { PNG } from 'pngjs';
import { createCloudGenerator,textAccepted,formatNote,noteFormatted,HttpError, type Transport } from '../src/generation.ts';
import {verificationFailure} from '../src/readiness.ts';
import type { Trip,Generator } from '../src/travel.ts';

let root:string,ref:string,image:Buffer,trip:Trip;
const note={title:'森林深处的一封来信',note:'在树影里停了一会儿，心也慢慢静下来。身旁的一点亮光像温柔的问候。忽然想把这份安宁寄给你，让它在你忙碌的一天里，留下一小段可以慢慢呼吸的时间。'};
const good={scene_match:true,character_match:true,usable:true,background_conflicts:[],issues:[],facts:['蓝发鲸鱼装女孩','老树旁有溪流','周围有蕨叶']};
const clear={checks:[],has_explicit_conflict:false,conflicts:[],uncertain_details:['微风无法从静态图确认']};
function response(value:unknown){return {model:'deepseek-flash',choices:[{finish_reason:'stop',message:{content:JSON.stringify(value)}}],usage:{total_tokens:10}};}
const promptOf=(payload:Record<string,unknown>)=>(payload.messages as {content:{text:string}[]}[])[0].content[0].text;
function transport():Transport{return async(kind,payload)=>{if(kind==='image')return {data:[{b64_json:image.toString('base64')}],usage:{input_images:2,generated_images:1}};const p=promptOf(payload);return response(p.startsWith('图1为候选')?good:p.startsWith('写桌宠旅行')?note:p.startsWith('只检查文字')?{has_real_place_name:false,names:[]}:clear);};}
function make(t:Transport):Generator{return createCloudGenerator({root,characterReference:ref,styleReference:ref,secret:()=> 'local-test-only'},t);}
function prepare(g:Generator){trip.generation=g.prepare!(trip);}
beforeEach(()=>{root=mkdtempSync(join(tmpdir(),'postcard-cloud-'));ref=join(root,'ref.png');const png=new PNG({width:512,height:768});png.data.fill(240);image=PNG.sync.write(png);writeFileSync(ref,image);trip={id:randomUUID(),scene:'forest',startedAt:0,dueAt:1,status:'generating'};});
afterEach(()=>rmSync(root,{recursive:true,force:true}));

it('真实附两图、固定参考副本、缓存恢复不重复收费',async()=>{
  const t=vi.fn(transport()),g=make(t);prepare(g);writeFileSync(ref,'source changed');
  const result=await g(trip,new AbortController().signal);expect(result.title).toBe(note.title);
  const payload=t.mock.calls.find(c=>c[0]==='image')![1];expect((payload.image as string[])).toHaveLength(2);
  const count=t.mock.calls.length;await g(trip,new AbortController().signal);expect(t.mock.calls.length).toBe(count);
  expect(result.generation?.policy).toBe('non-contradiction-cloud-v3');
});
it('文案有明确冲突只改文字，不重新生成图片',async()=>{
  let checked=0;const base=transport(),t=vi.fn<Transport>(async(k,p,s)=>{
    if(k==='text'&&promptOf(p).startsWith('只检查短笺'))return response(++checked===1?{...clear,has_explicit_conflict:true,conflicts:['场景相反']}:clear);
    return base(k,p,s);
  });const g=make(t);prepare(g);const result=await g(trip,new AbortController().signal);
  expect(result.generation?.noteAttempt).toBe(2);expect(t.mock.calls.filter(c=>c[0]==='image')).toHaveLength(1);
});
it('兼容旧策略旅程恢复，不把升级变成重算旧图或改写旧提示',async()=>{
 const t=vi.fn(transport()),g=make(t);prepare(g);
 trip.generation!.policy='non-contradiction-cloud-v1';delete trip.generation!.scenePrompt;delete trip.generation!.sceneVariant;delete trip.generation!.noteVoice;
 const result=await g(trip,new AbortController().signal);expect(result.generation?.policy).toBe('non-contradiction-cloud-v1');
 const prompts=t.mock.calls.filter(c=>c[0]==='text').map(c=>promptOf(c[1]));expect(prompts.some(p=>p.includes('不要写自己坐'))).toBe(false);
 const calls=t.mock.calls.length;await g(trip,new AbortController().signal);expect(t).toHaveBeenCalledTimes(calls);
});
it('构图和语气在出发时固定，后续近期列表变化不会改本趟输入',async()=>{
 const t=vi.fn(transport());let recent:string[]=[];trip.scene='coast';
 const g=createCloudGenerator({root,characterReference:ref,styleReference:ref,secret:()=> 'local-test-only',recentVariants:()=>recent},t);prepare(g);
 const original=structuredClone(trip.generation!);recent=['tide-pools','lighthouse-meadow','coastal-boardwalk','shell-dunes','sunset-rock-arch','sheltered-cove'];
 const result=await g(trip,new AbortController().signal);
 expect(t.mock.calls.find(c=>c[0]==='image')![1].prompt).toBe(original.prompt);expect(result.generation?.sceneVariant).toBe(original.sceneVariant);
});
it('两版文案均拒绝，重复恢复也不能变相重生图',async()=>{
  const base=transport(),t=vi.fn<Transport>(async(k,p,s)=>k==='text'&&promptOf(p).startsWith('只检查短笺')?response({...clear,has_explicit_conflict:true,conflicts:['明确冲突']}):base(k,p,s));const g=make(t);prepare(g);
  await expect(g(trip,new AbortController().signal)).rejects.toThrow('两版文案');
  await expect(g(trip,new AbortController().signal)).rejects.toThrow('两版文案');expect(t.mock.calls.filter(c=>c[0]==='image')).toHaveLength(1);
});
it('图片审核不合格最多两张候选，不无限重画',async()=>{
  const base=transport(),t=vi.fn<Transport>(async(k,p,s)=>k==='text'&&promptOf(p).startsWith('图1为候选')?response({...good,scene_match:false}):base(k,p,s));const g=make(t);prepare(g);
  await expect(g(trip,new AbortController().signal)).rejects.toThrow('两张候选');
  await expect(g(trip,new AbortController().signal)).rejects.toThrow('两张候选');expect(t.mock.calls.filter(c=>c[0]==='image')).toHaveLength(2);
});
it('断连保存不确定状态，确认前阻止重复收费，确认后仍受两次上限约束',async()=>{
  const t=vi.fn<Transport>(async()=>{throw new Error('sensitive raw error');}),g=make(t);prepare(g);
  await expect(g(trip,new AbortController().signal)).rejects.toThrow('不确定');
  await expect(g(trip,new AbortController().signal)).rejects.toThrow('不确定');expect(t).toHaveBeenCalledTimes(1);
  expect(()=>g.confirmRetry!(trip,false)).toThrow('确认');g.confirmRetry!(trip,true);
  await expect(g(trip,new AbortController().signal)).rejects.toThrow('不确定');g.confirmRetry!(trip,true);
  await expect(g(trip,new AbortController().signal)).rejects.toThrow('两次上限');expect(t).toHaveBeenCalledTimes(2);
});
it('明确429不耗尽候选预算，解除限额后允许手动恢复',async()=>{
  const base=transport();let first=true;const t=vi.fn<Transport>(async(k,p,s)=>{if(k==='image'&&first){first=false;throw new HttpError(429);}return base(k,p,s);});const g=make(t);prepare(g);
  await expect(g(trip,new AbortController().signal)).rejects.toThrow('HTTP 429');g.confirmRetry!(trip,false);
  const result=await g(trip,new AbortController().signal);expect(result.generation?.imageAttempt).toBe(1);
});
it.each([408,500,502,504])('图片HTTP %s保留远端不确定状态，不能当成未收费重发',async(status)=>{
 const t=vi.fn<Transport>(async()=>{throw new HttpError(status);}),g=make(t);prepare(g);
 await expect(g(trip,new AbortController().signal)).rejects.toThrow('不确定');
 expect(()=>g.confirmRetry!(trip,false)).toThrow('确认');
 await expect(g(trip,new AbortController().signal)).rejects.toThrow('不确定');expect(t).toHaveBeenCalledTimes(1);
});
it('图片超时或损坏输出不能入库或自动重新请求',async()=>{
 const t=vi.fn<Transport>(async()=>({data:[{b64_json:Buffer.from('broken png').toString('base64')}]})),g=make(t);prepare(g);
 await expect(g(trip,new AbortController().signal)).rejects.toThrow('不确定');
 await expect(g(trip,new AbortController().signal)).rejects.toThrow('不确定');expect(t).toHaveBeenCalledTimes(1);
});
it('出发副本被修改则在任何网络调用前停止',async()=>{
 const t=vi.fn(transport()),g=make(t);prepare(g);writeFileSync(join(root,'trips',trip.id,'input/character.png'),'tampered');
 await expect(g(trip,new AbortController().signal)).rejects.toThrow('参考图校验');expect(t).not.toHaveBeenCalled();
});
it('审核格式错误不能通过，也不能据此重新收费生图',async()=>{
  const base=transport(),t=vi.fn<Transport>(async(k,p,s)=>k==='text'?response({}):base(k,p,s)),g=make(t);prepare(g);
  await expect(g(trip,new AbortController().signal)).rejects.toThrow('审核格式无效');expect(t.mock.calls.filter(c=>c[0]==='image')).toHaveLength(1);
});
it('不确定细节允许，矛盾和损坏结构拒绝',()=>{
  expect(textAccepted(clear)).toBe(true);expect(textAccepted({...clear,has_explicit_conflict:true})).toBe(false);expect(textAccepted({})).toBe(false);
});
it('审核结构损坏后保留原响应，修复服务可恢复同张图',async()=>{
  const base=transport();let broken=true;const t=vi.fn<Transport>(async(k,p,s)=>{
    if(k==='text'&&promptOf(p).startsWith('图1为候选')&&broken){broken=false;return response({});}
    return base(k,p,s);
  });const g=make(t);prepare(g);
  await expect(g(trip,new AbortController().signal)).rejects.toThrow('审核格式无效');
  const result=await g(trip,new AbortController().signal);expect(result.title).toBe(note.title);expect(t.mock.calls.filter(c=>c[0]==='image')).toHaveLength(1);
});
it('文字429恢复只重试相应文字阶段，复用已保存候选图',async()=>{
  const base=transport();let first=true;const t=vi.fn<Transport>(async(k,p,s)=>{
    if(k==='text'&&first){first=false;throw new HttpError(429);}return base(k,p,s);
  });const g=make(t);prepare(g);
  await expect(g(trip,new AbortController().signal)).rejects.toThrow('HTTP 429');
  const result=await g(trip,new AbortController().signal);expect(result.title).toBe(note.title);expect(t.mock.calls.filter(c=>c[0]==='image')).toHaveLength(1);
});
it('超长正文仅保留完整原句，仍经文图审核，原文和缓存不覆盖',async()=>{
  const long={...note,note:'亲爱的，今晚我坐在面包店外的长椅上，捧着一杯热饮，暖意从指尖漫到心里。雪落在屋顶和石板上，远处的山影模糊又安静。我戴着那顶鲸鱼兜帽，蓝白的绒毛边裹住耳朵，好像你就在身边轻轻呵气。街灯和小圣诞树亮着，面包香从橱窗里飘出来——我想你，想和你一起踩雪回家。'};
  const formatted=formatNote(long);expect(noteFormatted(formatted)).toBe(true);expect(formatted.note).not.toBe(long.note);
  for(const sentence of (formatted.note as string).match(/[^。！？]+[。！？]/gu)!)expect(long.note).toContain(sentence);
  const base=transport(),t=vi.fn<Transport>(async(k,p,s)=>k==='text'&&promptOf(p).startsWith('写桌宠旅行')?response(long):base(k,p,s));const g=make(t);prepare(g);
  const result=await g(trip,new AbortController().signal);expect(result.note).toBe(formatted.note);
  expect(t.mock.calls.some(c=>c[0]==='text'&&promptOf(c[1]).startsWith('只检查短笺'))).toBe(true);
  const saved=JSON.parse(readFileSync(join(root,'trips',trip.id,'image-1-note-1.json'),'utf8'));expect(saved.note).toBe(long.note);
});

it('v2未完成旅程继续旧审核，不因升级增加地名检查或重画',async()=>{
 const t=vi.fn(transport()),g=make(t);prepare(g);trip.generation!.policy='non-contradiction-cloud-v2';delete trip.generation!.sceneSnapshot;
 const a=await g(trip,new AbortController().signal);expect(a.generation?.policy).toBe('non-contradiction-cloud-v2');
 expect(t.mock.calls.filter(c=>c[0]==='text').some(c=>promptOf(c[1]).startsWith('只检查文字'))).toBe(false);
 const n=t.mock.calls.length;await g(trip,new AbortController().signal);expect(t.mock.calls.length).toBe(n);
});
it('真实地名仅重写短笺，同一图片不重画',async()=>{
 const base=transport();let scopes=0;const t=vi.fn<Transport>(async(k,p,s)=>k==='text'&&promptOf(p).startsWith('只检查文字')?response(++scopes===1?{has_real_place_name:true,names:['杭州']}:{has_real_place_name:false,names:[]}):base(k,p,s));
 const g=make(t);prepare(g);const a=await g(trip,new AbortController().signal);expect(a.generation?.noteAttempt).toBe(2);expect(t.mock.calls.filter(c=>c[0]==='image')).toHaveLength(1);
 const prompts=t.mock.calls.filter(c=>c[0]==='text').map(c=>promptOf(c[1]));expect(prompts.some(p=>p.startsWith('写桌宠旅行')&&p.includes('REAL_PLACE_NAME')&&p.includes('杭州')&&p.includes('previousOutput'))).toBe(true);
});

it('独立API格式失败后的手动恢复带上结构反馈，仍只用原图和剩余文字额度',async()=>{
 const base=transport();let broken=true;const t=vi.fn<Transport>(async(k,p,s)=>{if(k==='text'&&broken){broken=false;return response({});}return base(k,p,s);});
 const g=make(t);prepare(g);await expect(g(trip,new AbortController().signal)).rejects.toThrow('审核格式无效');
 await g(trip,new AbortController().signal);
 const audits=t.mock.calls.filter(c=>c[0]==='text'&&promptOf(c[1]).startsWith('图1为候选'));
 expect(audits).toHaveLength(2);expect(promptOf(audits[1][1])).toContain('OUTPUT_CONTRACT');expect(promptOf(audits[1][1])).toContain('facts须3至8条');expect(t.mock.calls.filter(c=>c[0]==='image')).toHaveLength(1);
});

it('已出发v3缺少子版本时仍使用首轮语义，缓存恢复不按新规则重算',async()=>{
 const t=vi.fn(transport()),g=make(t);prepare(g);delete trip.generation!.placeScopeVersion;delete trip.generation!.noteReviewVersion;
 await g(trip,new AbortController().signal);const prompts=t.mock.calls.filter(c=>c[0]==='text').map(c=>promptOf(c[1]));
 expect(prompts.find(p=>p.startsWith('只检查文字'))).toContain('感受和比喻不算');
 expect(prompts.find(p=>p.startsWith('只检查短笺'))).not.toContain('先判断短语的语义再看姿态');
 const n=t.mock.calls.length;await g(trip,new AbortController().signal);expect(t.mock.calls.length).toBe(n);
});

it('逐项明确反证不能被总体放行覆盖，旧版本行为不变',()=>{
 const r={...clear,checks:[{claim:'当下直立',category:'posture',observation:'明显坐姿',clear_conflict:true}]};
 expect(textAccepted(r)).toBe(false);expect(textAccepted(r,false)).toBe(true);
});

it('宿主通道超时后恢复同图，并保留原有图文门禁',async()=>{
 let fail=true;const remote=vi.fn(transport()),host=vi.fn<Transport>(async(k,p,signal)=>{if(fail){fail=false;throw new Error('host timeout');}return transport()(k,p,signal);});
 const g=createCloudGenerator({root,characterReference:ref,styleReference:ref,secret:n=>n==='POSTCARD_ARK_API_KEY'?'test':'',useHostModel:true,hostTransport:host},remote);prepare(g);
 await expect(g(trip,new AbortController().signal)).rejects.toThrow('host timeout');const r=await g(trip,new AbortController().signal);expect(r.title).toBe(note.title);expect(r.generation?.visionModel).toBe('host-model');expect(remote.mock.calls.filter(c=>c[0]==='image')).toHaveLength(1);expect(remote.mock.calls.filter(c=>c[0]==='text')).toHaveLength(0);
});

it('宿主路径明确反图只重写文字，含糊感受可通过且不重生图片',async()=>{
 let checks=0;const remote=vi.fn(transport()),host:Transport=async(k,p,signal)=>{if(promptOf(p).startsWith('只检查短笺'))return response(++checks===1?{...clear,has_explicit_conflict:true,checks:[{claim:'海岸',category:'scene',observation:'图中为树林溪流',clear_conflict:true}],conflicts:['森林图不兼容海岸']}:{...clear,uncertain_details:['温度和心情不可确认，不构成冲突']});return transport()(k,p,signal);};
 const g=createCloudGenerator({root,characterReference:ref,styleReference:ref,secret:()=> 'test',useHostModel:true,hostTransport:host},remote);prepare(g);const result=await g(trip,new AbortController().signal);expect(result.generation?.noteAttempt).toBe(2);expect(remote.mock.calls.filter(c=>c[0]==='image')).toHaveLength(1);
});

it('已有v2快照及完整提示词冻结，恢复不注入新组合',async()=>{
 const g=make(transport());prepare(g);const old=structuredClone(trip.generation as any);old.sceneSnapshot.catalogVersion='imagined-scenes-v2';delete old.sceneSnapshot.visualVariation;old.prompt='旧版冻结prompt：保持原图，不加新构图';trip.generation=old;
 const t=vi.fn(transport()),next=make(t);await next(trip,new AbortController().signal);expect(t.mock.calls.find(c=>c[0]==='image')![1].prompt).toBe(old.prompt);const count=t.mock.calls.length;await next(trip,new AbortController().signal);expect(t.mock.calls.length).toBe(count);
});

it('默认Flash且自定义模型在出发冻结，旧Pro记录也可恢复',async()=>{
 const t=vi.fn(transport()),g=createCloudGenerator({root,characterReference:ref,styleReference:ref,imageModel:'custom-ark-model',secret:()=> 'test'},t);prepare(g);expect(trip.generation!.imageModel).toBe('custom-ark-model');await g(trip,new AbortController().signal);expect(t.mock.calls.find(c=>c[0]==='image')![1].model).toBe('custom-ark-model');
});

it('生成器不会吞掉明确HTTP错误，验证诊断可显示具体403',async()=>{
 const g=make(async()=>{throw new HttpError(403);});prepare(g);let error:unknown;try{await g(trip,new AbortController().signal);}catch(e){error=e;}expect(verificationFailure(error,'generating_image').code).toBe('HTTP_403');
});

it.each(['qwen','gemini'] as const)('%s双参考结果进入原有审核收藏链，恢复不重复请求且接口出发时固定',async backend=>{
 const options={root,characterReference:ref,styleReference:ref,secret:()=> 'local-test-only',imageBackend:backend,imageModel:backend==='qwen'?'qwen-image-2.0':'gemini-3-pro-image',imageBaseUrl:backend==='qwen'?'https://dashscope.aliyuncs.com/api/v1':'https://generativelanguage.googleapis.com/v1beta',imageSize:backend==='qwen'?'1024*1536':'2K'};
 const base=transport();let calls=0;const t:Transport=async(k,p,s,route)=>{if(k!=='image')return base(k,p,s);calls++;expect(route?.backend).toBe(backend);expect(p.image).toHaveLength(2);const wire=imageWireRequest(backend,route!.baseUrl!,p,'test-only');expect(wire.url).not.toContain('wrong');return normalizeImageResponse(backend,backend==='qwen'?{output:{choices:[{finish_reason:'stop',message:{content:[{image:'https://result.oss-cn-beijing.aliyuncs.com/a.png'}]}}]}}:{candidates:[{finishReason:'STOP',content:{parts:[{inlineData:{mimeType:'image/png',data:image.toString('base64')}}]}}]},async()=>image);};
 const g=createCloudGenerator(options,t);prepare(g);options.imageBaseUrl='https://wrong.test/v1';const result=await g(trip,new AbortController().signal);expect(result.image).toEqual(image);expect(result.title).toBe(note.title);await g(trip,new AbortController().signal);expect(calls).toBe(1);
});
