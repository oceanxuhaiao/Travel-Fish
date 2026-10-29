import {HttpError} from '../src/generation.ts';
import {it,expect,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {characterReference,styleReference} from '../src/characters.ts';
import {mkdtempSync,rmSync,writeFileSync,readFileSync,statSync,utimesSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {PNG} from 'pngjs';
import {ReadinessCheck,verificationFailure} from '../src/readiness.ts';import {POSTCARD_DEFAULTS} from '../src/config.ts';import {PostcardWorld} from '../src/world.ts';import {FakeHost} from './helpers/fake-host.ts';import {SetupPanel} from '../src/setup.ts';import type {ToolCallContext} from 'cortico/core/types.ts';
const flush=()=>new Promise(r=>setImmediate(r));const image=()=>{const p=new PNG({width:512,height:768});return PNG.sync.write(p);};
it('初始未验证禁止两入口出发，通过真实生成链后开放；改密钥立即失效，不写入收藏',async()=>{
 const root=mkdtempSync(join(tmpdir(),'postcard-ready-'));let key='mock-key';const generator=vi.fn(async()=>({image:image(),title:'验证',note:'验证短笺'}));const world=new PostcardWorld({cfg:{...POSTCARD_DEFAULTS,mailboxEnabled:false},dataDir:root,generator,setup:{secret:()=>key,storeSecret(){}}});const host=new FakeHost();host.modelFacts.accepts=()=>true;await world.start(host);
 try{const tool=world.tools().find(t=>t.name==='postcard_start')!;await expect(tool.handler({},{} as ToolCallContext)).rejects.toThrow('验证');await expect(world.panel.invoke('album','start',[])).rejects.toThrow('验证');expect(generator).not.toHaveBeenCalled();expect(()=>world.setup.invoke('verify',[])).toThrow('确认');world.setup.invoke('verify',[true]);world.setup.invoke('verify',[true]);await flush();expect(generator).toHaveBeenCalledTimes(1);expect((world.setup.invoke('check') as any).readyForTravel).toBe(true);expect(world.service.store.cards()).toHaveLength(0);const started=JSON.parse(await tool.handler({},{} as ToolCallContext) as string);expect(started.dueAt-started.startedAt).toBe(7200000);world.service.cancel(started.id);key='changed';expect((world.setup.invoke('check') as any).readyForTravel).toBe(false);await expect(tool.handler({},{} as ToolCallContext)).rejects.toThrow('验证');expect(world.service.status()?.status).toBe('cancelled');}finally{await world.stop();rmSync(root,{recursive:true,force:true});}
});
it('凭证持久化，时钟回拨或模型变化失效，可显式撤销',async()=>{
 const root=mkdtempSync(join(tmpdir(),'postcard-ready-'));let now=1000,model='one';const cfg={...POSTCARD_DEFAULTS};const make=()=>new ReadinessCheck(root,cfg,()=>'',()=>model,async()=>({image:image(),title:'验证',note:'验证短笺'}),()=>now);
 try{const c=make();c.start();await flush();expect(make().state().valid).toBe(true);c.invalidate();expect(c.state().valid).toBe(false);c.start();await flush();now=0;expect(c.state().valid).toBe(false);now=1000;model='two';expect(c.state().valid).toBe(false);}finally{rmSync(root,{recursive:true,force:true});}
});
it('验证失败或没有有效PNG不授予出发权限，不能把仅HTTP成功当成通过',async()=>{
 const root=mkdtempSync(join(tmpdir(),'postcard-ready-'));try{const c=new ReadinessCheck(root,{...POSTCARD_DEFAULTS},()=>'',()=>'',async()=>({image:Buffer.from('invalid'),title:'x',note:'x'}));c.start();await flush();expect(c.state().valid).toBe(false);expect(c.state().phase).toBe('failed');expect(c.state().failure?.code).toBe('IMAGE_FORMAT');}finally{rmSync(root,{recursive:true,force:true});}
});
it('远程兼容接口无专用密钥或空模型、空尺寸不能视为配置完整',()=>{
 const cfg={...POSTCARD_DEFAULTS,imageBackend:'compatible' as const,imageBaseUrl:'https://api.example.com/v1',imageModel:'model'};const p=new SetupPanel(cfg,{secret:()=>'',storeSecret(){}},undefined,()=>true);expect((p.invoke('check') as any).configurationReady).toBe(false);cfg.imageBaseUrl='http://127.0.0.1:8000/v1';expect((p.invoke('check') as any).configurationReady).toBe(true);cfg.imageModel=' ';expect((p.invoke('check') as any).configurationReady).toBe(false);
});

it('失败按步骤、HTTP/协议/宿主错误分类，不回显异常中的密钥、URL、请求体',()=>{
 expect(verificationFailure(new HttpError(401),'generating_image')).toMatchObject({code:'HTTP_401',stage:'生图服务生成图片'});expect(verificationFailure(new HttpError(404),'generating_image').advice).toContain('地址');expect(verificationFailure(new Error('宿主模型等待超时'),'writing_note').code).toBe('TIMEOUT');
 const leaked=new Error('server failed token=secret-test-value https://private.example/path body=private');const result=JSON.stringify(verificationFailure(leaked,'reviewing_image'));expect(result).not.toContain('secret-test-value');expect(result).not.toContain('private.example');expect(result).not.toContain('body=');
});
it('失败原因重启后可读，配置变化不沿用旧错误',async()=>{
 const root=mkdtempSync(join(tmpdir(),'postcard-ready-'));let model='one';const cfg={...POSTCARD_DEFAULTS};const make=()=>new ReadinessCheck(root,cfg,()=>'',()=>model,async(_t,_s,phase)=>{phase?.('generating_image');throw new HttpError(403);});
 try{const c=make();c.start();await flush();expect(make().state()).toMatchObject({phase:'failed',failure:{code:'HTTP_403',stage:'生图服务生成图片'}});model='two';expect(c.state().phase).toBe('required');expect(c.state().failure).toBeUndefined();}finally{rmSync(root,{recursive:true,force:true});}
});

it('验证处理中重启不误报成功，保留中断步骤',async()=>{
 const root=mkdtempSync(join(tmpdir(),'postcard-ready-'));const cfg={...POSTCARD_DEFAULTS};const generator:any=(_t:any,signal:AbortSignal,phase:any)=>{phase('writing_note');return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('aborted'))));};const make=()=>new ReadinessCheck(root,cfg,()=>'',()=>'',generator);const c=make();try{c.start();expect(c.state().stage).toBe('宿主撰写短笺');expect(make().state()).toMatchObject({phase:'failed',valid:false,failure:{code:'INTERRUPTED',stage:'宿主撰写短笺'}});}finally{c.stop();await flush();rmSync(root,{recursive:true,force:true});}
});

it('已保存与生成器配置不同时拦截验证，两入口禁止旅行，进行中不允许重启',async()=>{
 const root=mkdtempSync(join(tmpdir(),'postcard-restart-'));const cfg={...POSTCARD_DEFAULTS,mailboxEnabled:false};const restart=vi.fn(async()=>{}),generator=vi.fn(async()=>({image:image(),title:'验证',note:'验证短笺'}));const world=new PostcardWorld({cfg,dataDir:root,generator,setup:{secret:()=> 'test-key',storeSecret(){}},restart});const host=new FakeHost();host.modelFacts.accepts=()=>true;await world.start(host);
 try{cfg.imageModel='new-image';expect(world.setup.invoke('restartStatus')).toMatchObject({required:true,appliedModel:POSTCARD_DEFAULTS.imageModel,savedModel:'new-image'});expect(world.setup.invoke('verification')).toMatchObject({phase:'restart_required',valid:false});expect(()=>world.setup.invoke('verify',[true])).toThrow('尚未应用');await expect(world.panel.invoke('album','start',[])).rejects.toThrow();expect(generator).not.toHaveBeenCalled();const trip=world.service.start('forest',120);await expect(world.setup.invoke('restart') as Promise<unknown>).rejects.toThrow('尚未结束');expect(restart).not.toHaveBeenCalled();world.service.cancel(trip.id);await world.setup.invoke('restart');expect(restart).toHaveBeenCalledTimes(1);}finally{await world.stop();rmSync(root,{recursive:true,force:true});}
});

it('图片内容相同的重装、改路径或时间戳与重启保留验证，无过期时间',async()=>{
 const root=mkdtempSync(join(tmpdir(),'postcard-proof-content-'));let now=1000;const a=join(root,'first.png'),b=join(root,'reinstalled.png');writeFileSync(a,image());
 const cfg={...POSTCARD_DEFAULTS,characterPreset:'custom',characterReference:a,styleReference:a};const generator=vi.fn(async()=>({image:image(),title:'验证',note:'短笺'}));const make=()=>new ReadinessCheck(root,cfg,()=> 'active-key',()=> 'host',generator,()=>now);
 try{make().start();await flush();const before=JSON.parse(readFileSync(join(root,'readiness.json'),'utf8'));expect(before.schema).toBe(2);utimesSync(a,new Date(0),new Date(0));expect(make().state().valid).toBe(true);writeFileSync(b,readFileSync(a));cfg.characterReference=b;cfg.styleReference=b;now=1000+1000*60*60*24*365*20;expect(make().state().valid).toBe(true);make().start();await flush();expect(generator).toHaveBeenCalledTimes(1);expect(JSON.stringify(before)).not.toContain('active-key');const changed=new PNG({width:512,height:768});changed.data.fill(255);writeFileSync(b,PNG.sync.write(changed));expect(make().state().valid).toBe(false);}finally{rmSync(root,{recursive:true,force:true});}
});
it('只绑定当前服务密钥与有效参数，未用服务、方舟未用地址尺寸、估价和邮箱设置不影响通过',async()=>{
 const root=mkdtempSync(join(tmpdir(),'postcard-proof-effective-')),cfg={...POSTCARD_DEFAULTS};let host='one';const keys:Record<string,string>={POSTCARD_ARK_API_KEY:'active-key'};const make=()=>new ReadinessCheck(root,cfg,n=>keys[n]??'',()=>host,async()=>({image:image(),title:'验证',note:'短笺'}));
 try{make().start();await flush();for(const key of ['POSTCARD_QWEN_API_KEY','POSTCARD_GEMINI_API_KEY','POSTCARD_IMAGE_API_KEY','POSTCARD_VISION_API_KEY'])keys[key]='unused-key';cfg.visionProxyUrl='http://unused.test';cfg.imageBaseUrl='https://unused.test';cfg.imageSize='unused';cfg.imageUnitPrice=1;cfg.mailboxHeight=150;cfg.proactiveIntervalMinutes=100;expect(make().state().valid).toBe(true);keys.POSTCARD_ARK_API_KEY='changed';expect(make().state().valid).toBe(false);keys.POSTCARD_ARK_API_KEY='active-key';host='two';expect(make().state().valid).toBe(false);}finally{rmSync(root,{recursive:true,force:true});}
});
it('当前兼容接口模型、地址、尺寸或实际代理变化要求重验，等效根地址保留',async()=>{
 const root=mkdtempSync(join(tmpdir(),'postcard-proof-route-')),cfg={...POSTCARD_DEFAULTS,imageBackend:'compatible' as const,imageModel:'model',imageBaseUrl:'https://api.example.com/v1',imageSize:'1024x1536'};const make=()=>new ReadinessCheck(root,cfg,()=> 'key',()=> 'host',async()=>({image:image(),title:'验证',note:'短笺'}));
 try{make().start();await flush();cfg.imageBaseUrl='https://api.example.com/v1/images/generations/';expect(make().state().valid).toBe(true);for(const [field,value] of [['imageModel','other'],['imageBaseUrl','https://other.example.com/v1'],['imageSize','768x1152'],['imageProxyUrl','http://127.0.0.1:7890']]){const before=(cfg as any)[field];(cfg as any)[field]=value;expect(make().state().valid).toBe(false);(cfg as any)[field]=before;}}finally{rmSync(root,{recursive:true,force:true});}
});
it('独立看图通道忽略宿主模型变化，但绑定其实际密钥与代理',async()=>{
 const root=mkdtempSync(join(tmpdir(),'postcard-proof-independent-')),cfg={...POSTCARD_DEFAULTS,useHostModel:false};let host='one',visionKey='vision-key';const make=()=>new ReadinessCheck(root,cfg,n=>n==='POSTCARD_VISION_API_KEY'?visionKey:'image-key',()=>host,async()=>({image:image(),title:'验证',note:'短笺'}));
 try{make().start();await flush();host='two';expect(make().state().valid).toBe(true);visionKey='changed';expect(make().state().valid).toBe(false);visionKey='vision-key';cfg.visionProxyUrl='http://127.0.0.1:7890';expect(make().state().valid).toBe(false);}finally{rmSync(root,{recursive:true,force:true});}
});
function oldFingerprint(cfg:any,secret:(n:string)=>string,host:string){return createHash('sha256').update(JSON.stringify({settings:[cfg.cloudEnabled,cfg.useHostModel,cfg.imageBackend,cfg.imageModel,cfg.imageBaseUrl,cfg.imageSize,cfg.imageProxyUrl,cfg.visionProxyUrl],model:host,keys:['POSTCARD_ARK_API_KEY','POSTCARD_IMAGE_API_KEY','POSTCARD_VISION_API_KEY','POSTCARD_QWEN_API_KEY','POSTCARD_GEMINI_API_KEY'].map(secret),refs:[characterReference(cfg),styleReference(cfg)].map(p=>{const s=statSync(p,{bigint:true});return [p,String(s.size),String(s.mtimeNs),String(s.ctimeNs)];})})).digest('hex');}
it('能核对的0.7.12凭证免费迁移，迁移后重解压相同参考图不失效',()=>{
 const root=mkdtempSync(join(tmpdir(),'postcard-proof-legacy-')),cfg={...POSTCARD_DEFAULTS};const secret=()=> 'key';const generator=vi.fn();const file=join(root,'readiness.json');
 try{writeFileSync(file,JSON.stringify({passed:true,at:100,fingerprint:oldFingerprint(cfg,secret,'host')}));const c=new ReadinessCheck(root,cfg,secret,()=> 'host',generator,()=>100);expect(c.state().valid).toBe(true);const saved=JSON.parse(readFileSync(file,'utf8'));expect(saved).toMatchObject({schema:2,passed:true,migratedFrom:1,at:100});const copied=join(root,'copied.png');writeFileSync(copied,readFileSync(characterReference(cfg)));cfg.characterPreset='custom';cfg.characterReference=copied;expect(new ReadinessCheck(root,cfg,secret,()=> 'host',generator,()=>100).state().valid).toBe(true);expect(generator).not.toHaveBeenCalled();}finally{rmSync(root,{recursive:true,force:true});}
});
it('无法核对的旧凭证、失败凭证、未来格式不能无条件放行',()=>{
 const root=mkdtempSync(join(tmpdir(),'postcard-proof-untrusted-')),cfg={...POSTCARD_DEFAULTS};const file=join(root,'readiness.json');const c=()=>new ReadinessCheck(root,cfg,()=> 'key',()=> 'host',undefined,()=>100);
 try{writeFileSync(file,JSON.stringify({passed:true,at:100,fingerprint:'0'.repeat(64)}));expect(c().state()).toMatchObject({valid:false,legacyProofNeedsVerification:true});writeFileSync(file,JSON.stringify({passed:false,at:100,fingerprint:oldFingerprint(cfg,()=> 'key','host')}));expect(c().state().valid).toBe(false);writeFileSync(file,JSON.stringify({schema:99,passed:true,at:100,fingerprint:oldFingerprint(cfg,()=> 'key','host')}));expect(c().state().valid).toBe(false);}finally{rmSync(root,{recursive:true,force:true});}
});
it('旅行失败后保留通过凭证，失败旅程仍阻止再次出发，取消后可复用验证',async()=>{
 const root=mkdtempSync(join(tmpdir(),'postcard-proof-failure-'));const world=new PostcardWorld({cfg:{...POSTCARD_DEFAULTS,mailboxEnabled:false},dataDir:root,generator:async()=>({image:image(),title:'验证',note:'短笺'}),setup:{secret:()=> 'key',storeSecret(){}}});const host=new FakeHost();host.modelFacts.accepts=()=>true;await world.start(host);
 try{world.setup.invoke('verify',[true]);await flush();expect((world.setup.invoke('verification') as any).valid).toBe(true);const trip=world.service.start('forest',120);const state=world.service.store.snapshot();state.trips.find(t=>t.id===trip.id)!.status='failed';world.service.store.save(state);await world.pulse();expect((world.setup.invoke('verification') as any).valid).toBe(true);await expect(world.panel.invoke('album','start',[])).rejects.toThrow();world.service.cancel(trip.id);expect((world.setup.invoke('check') as any).readyForTravel).toBe(true);}finally{await world.stop();rmSync(root,{recursive:true,force:true});}
});
