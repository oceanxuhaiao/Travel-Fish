import {it,expect,vi} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {PNG} from 'pngjs';
import {ReadinessCheck} from '../src/readiness.ts';import {POSTCARD_DEFAULTS} from '../src/config.ts';import {PostcardWorld} from '../src/world.ts';import {FakeHost} from './helpers/fake-host.ts';import {SetupPanel} from '../src/setup.ts';import type {ToolCallContext} from 'cortico/core/types.ts';
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
 const root=mkdtempSync(join(tmpdir(),'postcard-ready-'));try{const c=new ReadinessCheck(root,{...POSTCARD_DEFAULTS},()=>'',()=>'',async()=>({image:Buffer.from('invalid'),title:'x',note:'x'}));c.start();await flush();expect(c.state().valid).toBe(false);expect(c.state().phase).toBe('required');}finally{rmSync(root,{recursive:true,force:true});}
});
it('远程兼容接口无专用密钥或空模型、空尺寸不能视为配置完整',()=>{
 const cfg={...POSTCARD_DEFAULTS,imageBackend:'compatible' as const,imageBaseUrl:'https://api.example.com/v1',imageModel:'model'};const p=new SetupPanel(cfg,{secret:()=>'',storeSecret(){}},undefined,()=>true);expect((p.invoke('check') as any).configurationReady).toBe(false);cfg.imageBaseUrl='http://127.0.0.1:8000/v1';expect((p.invoke('check') as any).configurationReady).toBe(true);cfg.imageModel=' ';expect((p.invoke('check') as any).configurationReady).toBe(false);
});
