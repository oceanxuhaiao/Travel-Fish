const {app,BrowserWindow,ipcMain,screen}=require('electron');
const path=require('node:path'),fs=require('node:fs');
app.disableHardwareAcceleration();
fs.mkdirSync(process.env.POSTCARD_MAIL_PROFILE,{recursive:true});
app.setPath('userData',process.env.POSTCARD_MAIL_PROFILE);
const origin=process.env.POSTCARD_MAIL_ORIGIN,token=process.env.POSTCARD_MAIL_TOKEN;
let mailbox,reader,rects=[];
async function request(route,tripId){const response=await fetch(origin+route,{method:tripId?'POST':'GET',headers:{Authorization:'Bearer '+token,...(tripId?{'Content-Type':'application/json'}:{})},...(tripId?{body:JSON.stringify({tripId})}:{}),signal:AbortSignal.timeout(5000)});if(!response.ok)throw Error('暂时联系不上邮箱，收藏仍保留');return response.json();}
const options={preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true};
function secure(win){win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',e=>e.preventDefault());}
app.whenReady().then(async()=>{
 const a=screen.getPrimaryDisplay().workArea;
 mailbox=new BrowserWindow({x:Math.round(a.x+a.width*.7-130),y:a.y+a.height-260,width:260,height:260,frame:false,transparent:true,alwaysOnTop:true,skipTaskbar:true,focusable:false,resizable:false,show:false,webPreferences:options});secure(mailbox);
 ipcMain.handle('postcard:call',async(event,action,id)=>{
  if(![mailbox?.webContents,reader?.webContents].includes(event.sender))throw Error('窗口已失效');
  if(action==='state')return request('/state');
  if(action==='read')return request('/read',String(id));
  if(action==='mark-read')return request('/mark-read',String(id));
  if(action==='open-letter'){
    if(!/^[a-f0-9-]{36}$/.test(String(id)))throw Error('没有这封来信');
    if(reader&&!reader.isDestroyed())reader.close();
    reader=new BrowserWindow({width:570,height:760,title:'远方来信',autoHideMenuBar:true,webPreferences:options});const current=reader;current.once('closed',()=>{if(reader===current)reader=undefined;});secure(reader);await reader.loadFile(path.join(__dirname,'mailbox.html'),{hash:'letter='+id});return {};
  }
  if(action==='close'){if(event.sender===mailbox.webContents)app.quit();else reader?.close();return {};}
  throw Error('未知邮箱操作');
 });
 ipcMain.on('postcard:rects',(event,value)=>{if(event.sender!==mailbox.webContents||!Array.isArray(value))return;rects=value.slice(0,12).filter(r=>['x','y','width','height'].every(k=>Number.isFinite(r[k])));});
 mailbox.setIgnoreMouseEvents(true,{forward:true});await mailbox.loadFile(path.join(__dirname,'mailbox.html'));mailbox.showInactive();
 const geometry={at:new Date().toISOString(),bounds:mailbox.getBounds(),workArea:a,scaleFactor:screen.getPrimaryDisplay().scaleFactor};
 fs.writeFileSync(path.join(process.env.POSTCARD_MAIL_PROFILE,'window-ready.json'),JSON.stringify(geometry,null,2));
 if(process.env.POSTCARD_MAIL_CAPTURE){setTimeout(async()=>{try{fs.writeFileSync(process.env.POSTCARD_MAIL_CAPTURE,(await mailbox.webContents.capturePage()).toPNG());}catch{}},2000);}
 let ignored=true;setInterval(()=>{if(mailbox.isDestroyed())return;const p=screen.getCursorScreenPoint(),b=mailbox.getBounds(),x=p.x-b.x,y=p.y-b.y;const next=!rects.some(r=>x>=r.x&&x<r.x+r.width&&y>=r.y&&y<r.y+r.height);if(next!==ignored){ignored=next;mailbox.setIgnoreMouseEvents(next,{forward:true});}},60);
});
app.on('window-all-closed',()=>app.quit());
setInterval(()=>{try{process.kill(Number(process.env.POSTCARD_MAIL_PARENT),0);}catch{app.quit();}},1500).unref();
