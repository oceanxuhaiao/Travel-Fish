/** Isolated UI acceptance harness. Real panel + World; fixture generation only. */
import {createServer} from 'node:http';
import {readFileSync,mkdirSync,existsSync,copyFileSync,readdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {PostcardWorld} from '../src/world.ts';
import {POSTCARD_DEFAULTS} from '../src/config.ts';
import {FakeHost} from '../tests/helpers/fake-host.ts';
const args=process.argv.slice(2);const opt=(key:string)=>{const i=args.indexOf('--'+key);if(i<0)throw new Error('Missing '+key);return resolve(args[i+1]);};
const source=opt('source-data'),out=opt('out'),data=join(out,'data'),root=join(data,'postcard');mkdirSync(root,{recursive:true});
for(const id of readdirSync(join(source,'collection'))){
  if(!/^[a-f0-9-]{36}$/.test(id))continue;
  const folder=join(root,'collection',id);mkdirSync(folder,{recursive:true});
  for(const file of ['postcard.png','record.json','note.md'])if(!existsSync(join(folder,file)))copyFileSync(join(source,'collection',id,file),join(folder,file));
}
if(!existsSync(join(root,'state.json')))copyFileSync(join(source,'state.json'),join(root,'state.json'));
let now=Date.now();let world:PostcardWorld;
const generator=async(trip:{scene:string})=>{const card=world.service.store.cards().find(c=>c.scene===trip.scene);if(!card)throw new Error('No matching fixture');return {image:readFileSync(join(root,'collection',card.tripId,'postcard.png')),title:card.title,note:card.note};};
world=new PostcardWorld({cfg:{...POSTCARD_DEFAULTS,enabled:true,minutes:1},dataDir:data,generator,now:()=>now});await world.start(new FakeHost());
const page=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>旅行面板 · 隔离验收</title><link rel="stylesheet" href="/webui.css"><style>body{margin:0;padding:22px;background:#eaece6}aside{max-width:1260px;margin:0 auto 15px;font:12px/1.7 system-ui;color:#67776e}aside button{margin-left:12px}#dialog{position:fixed;inset:0;background:#23352a50;display:grid;place-items:center;z-index:9}#dialog[hidden]{display:none}#dialog section{max-width:400px;margin:20px;padding:24px;border-radius:14px;background:#fffdf7;font:15px/1.8 system-ui}#dialog button{margin:16px 12px 0 0;padding:8px 16px}</style><aside>隔离验收环境：使用正式面板与World服务。已有成品来自阶段C；新增旅程使用测试服务，不调用云端、不产生费用。<button id="advance">让旅途到期（测试）</button></aside><main id="panel"></main><div id="dialog" hidden><section><h2 id="dialog-title"></h2><p id="dialog-body"></p><button id="yes">确认继续</button><button id="no">留在这里</button></section></div><script type="module">
import panel from '/webui.js';
const controller=new AbortController(),owned=[];let calls=0;
const invoke=async(method,args=[])=>{calls++;const response=await fetch('/bridge',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({method,args}),signal:controller.signal});if(!response.ok)throw new Error((await response.json()).error);return response;};
const ctx={root:document.getElementById('panel'),pageId:'world:postcard',panelId:'album',language:'zh',signal:controller.signal,invoke:async(m,a)=>(await invoke(m,a)).json(),invokeBinary:async(m,a)=>(await invoke(m,a)).blob(),memo:{get:(k,d)=>{try{return JSON.parse(localStorage.getItem('postcard-preview:'+k))??d;}catch{return d;}},set:(k,v)=>localStorage.setItem('postcard-preview:'+k,JSON.stringify(v))},own:d=>{owned.push(d);return d;},interval:(fn,ms)=>{const id=setInterval(fn,ms),d={dispose:()=>clearInterval(id)};owned.push(d);return d;},timeout:(fn,ms)=>{const id=setTimeout(fn,ms),d={dispose:()=>clearTimeout(id)};owned.push(d);return d;},ui:{confirm:async(opts)=>{const overlay=document.getElementById('dialog');overlay.hidden=false;document.getElementById('dialog-title').textContent=opts.title;document.getElementById('dialog-body').textContent=opts.body??'';return new Promise(resolve=>{document.getElementById('yes').onclick=()=>{overlay.hidden=true;resolve(true);};document.getElementById('no').onclick=()=>{overlay.hidden=true;resolve(false);};});}}};
await panel.panels.album.mount(ctx);document.getElementById('advance').onclick=async()=>{await fetch('/advance',{method:'POST'});location.reload();};
window.addEventListener('pagehide',()=>{controller.abort();owned.forEach(d=>d.dispose());},{once:true});
</script></html>`;
const server=createServer(async(req,res)=>{
  try{
    if(req.method==='GET'&&req.url==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(page);return;}
    if(req.method==='GET'&&['/webui.js','/webui.css'].includes(req.url??'')){res.setHeader('Content-Type',req.url!.endsWith('.css')?'text/css':'text/javascript');res.end(readFileSync(join(process.cwd(),'dist',req.url!.slice(1))));return;}
    if(req.method==='POST'&&req.url==='/advance'){now=Math.max(now,world.service.status()?.dueAt??now)+1000;await world.pulse();res.end('ok');return;}
    if(req.method==='POST'&&req.url==='/bridge'){
      let body='';for await(const chunk of req){body+=chunk;if(body.length>8192)throw new Error('Request too large');}
      const {method,args}=JSON.parse(body);if(typeof method!=='string'||!Array.isArray(args))throw new Error('Invalid request');
      const result=await world.webUi().invoke!('album',method,args) as {$binary?:{mime:string;base64:string}};
      res.setHeader('Cache-Control','no-store');
      if(result?.$binary){res.setHeader('Content-Type',result.$binary.mime);res.end(Buffer.from(result.$binary.base64,'base64'));}
      else{res.setHeader('Content-Type','application/json; charset=utf-8');res.end(JSON.stringify(result));}return;
    }
    res.statusCode=404;res.end();
  }catch(error){res.statusCode=400;res.setHeader('Content-Type','application/json; charset=utf-8');res.end(JSON.stringify({error:error instanceof Error?error.message:'Request failed'}));}
});
server.listen(8769,'127.0.0.1',()=>console.log('PANEL_PREVIEW http://127.0.0.1:8769'));
process.on('SIGINT',()=>{server.close();void world.stop().finally(()=>process.exit());});
