import {it,expect,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {EventEmitter} from 'node:events';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
import path from 'node:path';

const require=createRequire(import.meta.url);
const source=readFileSync(new URL('../desktop/main.cjs',import.meta.url),'utf8');
const flush=()=>new Promise(r=>setImmediate(r));
function desktop(mode:'409'|'timeout'|'pending'|'ok',diskFailure=false,multiple=false){
 const timers=new Map<any,{fn:()=>unknown,ms:number,interval:boolean}>(),files=new Map<string,string>();
 const schedule=(interval:boolean)=>(fn:()=>unknown,ms:number)=>{const id={unref(){return id;}};timers.set(id,{fn,ms,interval});return id;};
 let startup!:Promise<void>,destroyed=false,cursor={x:114,y:224},bounds={x:100,y:200,width:263,height:263};
 const webContents=new EventEmitter() as any;webContents.setWindowOpenHandler=vi.fn();
 const win=new EventEmitter() as any;Object.assign(win,{webContents,isDestroyed:()=>destroyed,getBounds:()=>({...bounds}),getContentBounds:()=>({...bounds,x:bounds.x+4,y:bounds.y+4}),setIgnoreMouseEvents:vi.fn(),setAlwaysOnTop:vi.fn(),showInactive:vi.fn(),loadFile:vi.fn(async()=>{}),setBounds:vi.fn((b:any)=>{bounds={...b};})});
 const app=new EventEmitter() as any;Object.assign(app,{disableHardwareAcceleration(){},setPath(){},quit:vi.fn(),whenReady:()=>({then:(fn:()=>Promise<void>)=>startup=Promise.resolve().then(fn)})});
 const primary={id:1,label:'Primary',workArea:{x:0,y:0,width:2048,height:1104},scaleFactor:1.25};
 let monitors=multiple?[primary,{id:2,label:'Side',workArea:{x:-1600,y:0,width:1600,height:900},scaleFactor:1}]:[primary];
 let menu:any[]=[];const Menu={buildFromTemplate:(template:any[])=>{menu=template;return {popup:vi.fn()};}};
 const screen=new EventEmitter() as any;Object.assign(screen,{getPrimaryDisplay:()=>primary,getAllDisplays:()=>monitors,getCursorScreenPoint:()=>cursor});
 const ipcMain=new EventEmitter() as any;let call:any;ipcMain.handle=(_name:string,fn:any)=>{call=fn;};
 const powerMonitor=new EventEmitter();
 let release!:(value:any)=>void;
 const fetch=vi.fn(async(url:string)=>{if(url.endsWith('/state'))return {ok:true,json:async()=>({height:120})};if(mode==='timeout')throw Error('timeout');if(mode==='pending')return new Promise(r=>{release=r;});return {ok:mode==='ok',json:async()=>({})};});
 const fs={mkdirSync(){},readFileSync(){throw Error('missing');},writeFileSync(file:string,value:string){if(diskFailure&&file.endsWith('window-ready.json'))throw Error('disk');files.set(path.basename(file),value);}};
 runInNewContext(source,{require:(id:string)=>id==='electron'?{app,BrowserWindow:function(){return win;},ipcMain,screen,powerMonitor,Menu}:id==='node:fs'?fs:id==='node:path'?path:id==='./layout.cjs'?require('../desktop/layout.cjs'):id==='./layer.cjs'?{keepBehindPet:()=>({update:()=>({supported:true}),dispose(){}})}:(()=>{throw Error(id);})(),process:{platform:'win32',env:{POSTCARD_MAIL_PROFILE:'test-profile',POSTCARD_MAIL_ORIGIN:'http://localhost',POSTCARD_MAIL_TOKEN:'test-token'},kill(){}},__dirname:'desktop',fetch,AbortSignal,setInterval:schedule(true),setTimeout:schedule(false),clearInterval:(id:any)=>timers.delete(id),clearTimeout:(id:any)=>timers.delete(id)});
 const tick=async(ms:number)=>{for(const [id,t] of [...timers])if(t.ms===ms){if(!t.interval)timers.delete(id);await t.fn();}await flush();};
 return {startup:()=>startup,win,screen,powerMonitor,files,timers,fetch,tick,menu:()=>{webContents.emit('context-menu');return menu;},disconnect:()=>{monitors=[primary];screen.emit('display-removed');},cursor:(p:{x:number;y:number})=>{cursor=p;},call:(action:string)=>call({sender:webContents},action),rects:(r:any[])=>ipcMain.emit('postcard:rects',{sender:webContents},r),close:()=>{destroyed=true;win.emit('closed');},release:()=>release({ok:false})};
}
it('原生光标能拖到负坐标副屏、自由改变高度，菜单选屏并在拔屏后回可见主屏',async()=>{
 const d=desktop('ok',false,true);await d.startup();await flush();
 await d.call('drag-start');d.cursor({x:-700,y:400});await d.tick(16);await d.call('drag-end');d.win.emit('move');await d.tick(120);
 expect(d.win.getBounds()).toMatchObject({x:-714,y:376});
 expect(JSON.parse(d.files.get('position.json')!).displayId).toBe('2');
 expect(JSON.parse(d.files.get('window-ready.json')!)).toMatchObject({displayId:'2',scaleFactor:1,pickupSupported:false});
 let menu=d.menu();expect(menu[0].submenu).toHaveLength(2);expect(menu[0].submenu[1].checked).toBe(true);
 menu[0].submenu[0].click();await flush();expect(d.win.getBounds().x).toBeGreaterThanOrEqual(0);
 menu=d.menu();menu[1].click();await flush();expect(d.win.getBounds().y).toBe(844);expect(JSON.parse(d.files.get('window-ready.json')!).pickupSupported).toBe(true);
 d.menu()[0].submenu[1].click();await flush();d.disconnect();await d.tick(150);expect(d.win.getBounds().x).toBeGreaterThanOrEqual(0);expect(JSON.parse(d.files.get('position.json')!).displayId).toBe('1');d.close();
});
it('松手后在副屏加速落地、保持横坐标，再次抓取会中断下落',async()=>{
 const d=desktop('ok',false,true);await d.startup();await flush();
 await d.call('drag-start');d.cursor({x:-700,y:400});await d.tick(16);await d.call('drag-end');await flush();
 expect(JSON.parse(d.files.get('window-ready.json')!).pickupSupported).toBe(false);
 const x=d.win.getBounds().x,y=d.win.getBounds().y;
 for(let i=0;i<15;i++)await d.tick(16);expect(d.win.getBounds().y).toBeGreaterThan(y);expect(d.win.getBounds().x).toBe(x);
 await d.call('drag-start');const grabbed=d.win.getBounds().y;for(let i=0;i<10;i++)await d.tick(16);expect(d.win.getBounds().y).toBe(grabbed);
 await d.call('drag-end');for(let i=0;i<200;i++)await d.tick(16);
 expect(d.win.getBounds()).toMatchObject({x,y:640});expect(JSON.parse(d.files.get('position.json')!)).toMatchObject({displayId:'2',relativeY:1});
 d.menu()[0].submenu[0].click();await flush();expect(JSON.parse(d.files.get('window-ready.json')!).pickupSupported).toBe(true);d.close();
});
it.each(['409','timeout','pending'] as const)('首次几何上报%s仍完成交互初始化、内容区命中和原生拖动',async mode=>{
 const d=desktop(mode);await d.startup();await flush();
 expect(d.files.has('display-state.json')).toBe(true);expect(d.screen.listenerCount('display-metrics-changed')).toBe(1);expect(d.powerMonitor.listenerCount('resume')).toBe(1);
 d.rects([{x:10,y:20,width:40,height:80}]);await d.tick(60);expect(d.win.setIgnoreMouseEvents).toHaveBeenLastCalledWith(false,{forward:true});
 // Retain interaction within a 3-DIP exit margin, then restore click-through.
 d.cursor({x:112,y:224});await d.tick(60);expect(d.win.setIgnoreMouseEvents).toHaveBeenLastCalledWith(false,{forward:true});
 d.cursor({x:109,y:224});await d.tick(60);expect(d.win.setIgnoreMouseEvents).toHaveBeenLastCalledWith(true,{forward:true});
 await d.call('drag-start');d.cursor({x:159,y:224});await d.tick(16);expect(d.win.setBounds).toHaveBeenCalledWith(expect.objectContaining({x:150}));
 d.close();if(mode==='pending'){d.release();await flush();}
 expect([...d.timers.values()].some(t=>[16,60,800,1000,2000].includes(t.ms))).toBe(false);expect(d.screen.listenerCount('display-metrics-changed')).toBe(0);
});
it('上报失败最多三次，恢复时读取最新几何；诊断写盘失败不妨碍上报',async()=>{
 const d=desktop('409',true);await d.startup();await flush();await d.tick(1000);await d.tick(2000);
 expect(d.fetch.mock.calls.filter(c=>c[0].endsWith('/window'))).toHaveLength(3);expect(JSON.parse(d.files.get('window-report.json')!).attempt).toBe(3);
 expect([...d.timers.values()].some(t=>!t.interval)).toBe(false);
 d.fetch.mockImplementation(async()=>({ok:true,json:async()=>({})}));d.win.emit('move');await d.tick(120);
 expect(JSON.parse(d.files.get('window-report.json')!).phase).toBe('reported');d.close();
});
