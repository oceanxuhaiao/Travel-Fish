import {createServer,type Server} from 'node:http';
import {spawn,type ChildProcess} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {existsSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import type {MailboxSnapshot} from './mailbox.ts';

export interface MailboxWindowState {phase:'closed'|'running'|'unavailable'|'error';detail:string;}
export function mailboxRuntime(root:string|undefined,explicit=''):string|null {
  if(explicit)return existsSync(explicit)?explicit:null;
  if(!root)return null;const folder=join(root,'electron');if(!existsSync(folder))return null;
  for(const version of readdirSync(folder).filter(v=>/^\d+\.\d+\.\d+$/.test(v)).sort((a,b)=>b.localeCompare(a,undefined,{numeric:true}))){const exe=join(folder,version,'electron.exe');if(existsSync(exe))return exe;}
  return null;
}
/** Only owns the mailbox process; never creates, disables or replaces a pet. */
export class MailboxWindow {
  private server?:Server;private child?:ChildProcess;private opening?:Promise<MailboxWindowState>;
  private state:MailboxWindowState={phase:'closed',detail:'桌面邮箱未打开'};
  constructor(private opts:{profile:string;runtime:()=>string|null;snapshot:()=>MailboxSnapshot;read:(id:string)=>unknown;markRead:(id:string)=>unknown}){}
  status():MailboxWindowState{return {...this.state};}
  open():Promise<MailboxWindowState>{if(this.opening)return this.opening;this.opening=this.start().finally(()=>{this.opening=undefined;});return this.opening;}
  private async start():Promise<MailboxWindowState>{
    if(this.child)return this.status();
    const runtime=this.opts.runtime();
    if(process.platform!=='win32'||!runtime){this.state={phase:'unavailable',detail:process.platform!=='win32'?'桌面邮箱目前仅验证Windows；收藏册仍可使用':'未找到独立Electron运行时；可安装桌宠面板提供的运行时或配置邮箱Electron路径，收藏册仍可使用'};return this.status();}
    const token=randomBytes(32).toString('hex');
    const server=createServer(async(req,res)=>{
      res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');
      if(req.headers.authorization!=='Bearer '+token){res.writeHead(401).end('{}');return;}
      try{
        if(req.method==='GET'&&req.url==='/state'){res.end(JSON.stringify(this.opts.snapshot()));return;}
        if(req.method!=='POST'||!['/read','/mark-read'].includes(req.url??'')){res.writeHead(404).end('{}');return;}
        let body='';for await(const bytes of req){body+=bytes;if(body.length>2048){res.writeHead(413).end('{}');return;}}
        const {tripId}=JSON.parse(body);if(typeof tripId!=='string'||!/^[a-f0-9-]{36}$/.test(tripId)){res.writeHead(400).end('{}');return;}
        res.end(JSON.stringify(req.url==='/read'?this.opts.read(tripId):this.opts.markRead(tripId)));
      }catch{res.writeHead(409).end(JSON.stringify({error:'邮箱操作未完成，请在收藏册检查或恢复存档'}));}
    });
    this.server=server;
    try{
      await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>{server.removeListener('error',reject);resolve();});});
      const env:NodeJS.ProcessEnv={};for(const key of ['SystemRoot','WINDIR','PATH','TEMP','TMP','USERPROFILE','LOCALAPPDATA','APPDATA'])if(process.env[key])env[key]=process.env[key];
      Object.assign(env,{POSTCARD_MAIL_ORIGIN:'http://127.0.0.1:'+(server.address() as {port:number}).port,POSTCARD_MAIL_TOKEN:token,POSTCARD_MAIL_PROFILE:this.opts.profile,POSTCARD_MAIL_PARENT:String(process.pid)});
      const child=spawn(runtime,[fileURLToPath(new URL('../desktop/main.cjs',import.meta.url))],{env,windowsHide:true,stdio:'ignore'});
      this.child=child;this.state={phase:'running',detail:'桌面邮箱已启动；不新增角色'};
      child.once('error',()=>{this.state={phase:'error',detail:'邮箱窗口启动失败，收藏册仍可使用'};this.cleanup(child);});
      child.once('exit',()=>{if(this.child===child){this.state={phase:'closed',detail:'桌面邮箱已关闭，可在收藏册重新打开'};this.cleanup(child);}});
    }catch{this.state={phase:'error',detail:'邮箱通信启动失败，收藏册仍可使用'};server.close();this.server=undefined;}
    return this.status();
  }
  private cleanup(child:ChildProcess){if(this.child!==child)return;this.child=undefined;this.server?.close();this.server=undefined;}
  async close():Promise<void>{if(this.opening)await this.opening;const child=this.child;this.child=undefined;this.server?.close();this.server=undefined;if(child&&child.exitCode===null){const exit=new Promise<void>(r=>child.once('exit',()=>r()));child.kill();await Promise.race([exit,new Promise(r=>setTimeout(r,1500))]);if(child.exitCode===null)child.kill('SIGKILL');}this.state={phase:'closed',detail:'桌面邮箱已关闭'};}
}
