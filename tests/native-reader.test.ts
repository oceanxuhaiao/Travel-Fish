import {it,expect} from 'vitest';import {readFileSync} from 'node:fs';import {createRequire} from 'node:module';import {EventEmitter} from 'node:events';import vm from 'node:vm';
it('原生读信窗口100次并发打开与后续重复打开只创建一个，读信renderer崩溃可再次打开',async()=>{
 const windows:Win[]=[];let handler:any,ready:Promise<void>;let quit=0;
 class Win extends EventEmitter{destroyed=false;webContents:any=new EventEmitter();constructor(public options:any){super();this.webContents.setWindowOpenHandler=()=>{};windows.push(this);}isDestroyed(){return this.destroyed;}close(){this.destroyed=true;this.emit('closed');}setIgnoreMouseEvents(){}showInactive(){}show(){}async loadFile(){}getBounds(){return {x:100,y:780,width:260,height:260};}}
 const screen=new EventEmitter() as any;screen.getPrimaryDisplay=()=>({workArea:{x:0,y:0,width:1920,height:1040},scaleFactor:1});screen.getAllDisplays=()=>[];screen.getCursorScreenPoint=()=>({x:0,y:0});
 const app={disableHardwareAcceleration(){},setPath(){},whenReady:()=>({then:(f:any)=>{ready=f();return ready;}}),on(){},quit(){quit++;}};const nativeRequire=createRequire(import.meta.url);
 const fs={mkdirSync(){},readFileSync(){throw Error('not configured');},writeFileSync(){}};
 const context={require:(name:string)=>name==='electron'?{app,BrowserWindow:Win,screen,powerMonitor:new EventEmitter(),ipcMain:{handle:(_:string,fn:any)=>{handler=fn;},on(){}}}:name==='node:fs'?fs:name==='./layer.cjs'?{keepBehindPet:()=>({update:()=>({supported:true}),dispose(){}})}:name==='./layout.cjs'?nativeRequire('../desktop/layout.cjs'):nativeRequire(name),__dirname:'test-mailbox',process:{env:{POSTCARD_MAIL_PROFILE:'test-profile'},pid:123,kill(){}},fetch:async()=>({ok:true,json:async()=>({height:120})}),AbortSignal,URLSearchParams,setTimeout:()=>1,clearTimeout(){},setInterval:()=>({unref(){}}),clearInterval(){},console};
 vm.runInNewContext(readFileSync(new URL('../desktop/main.cjs',import.meta.url),'utf8'),context);await ready!;
 const sender=windows[0].webContents,id='00000000-0000-0000-0000-000000000001';await Promise.all(Array.from({length:100},()=>handler({sender},'open-letter',id)));expect(windows).toHaveLength(2);await handler({sender},'open-letter',id);expect(windows).toHaveLength(2);
 windows[1].webContents.emit('render-process-gone');expect(windows[1].destroyed).toBe(true);expect(quit).toBe(0);await handler({sender},'open-letter',id);expect(windows).toHaveLength(3);
 windows[0].webContents.emit('render-process-gone');expect(quit).toBe(1);
});
