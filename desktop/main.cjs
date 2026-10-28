const {app,BrowserWindow,ipcMain,screen}=require('electron');
const path=require('node:path'),fs=require('node:fs');
app.disableHardwareAcceleration();
fs.mkdirSync(process.env.POSTCARD_MAIL_PROFILE,{recursive:true});
app.setPath('userData',process.env.POSTCARD_MAIL_PROFILE);
const origin=process.env.POSTCARD_MAIL_ORIGIN,token=process.env.POSTCARD_MAIL_TOKEN;
let mailbox,reader,rects=[];
async function request(route,payload){if(typeof payload==='string')payload={tripId:payload};const response=await fetch(origin+route,{method:payload?'POST':'GET',headers:{Authorization:'Bearer '+token,...(payload?{'Content-Type':'application/json'}:{})},...(payload?{body:JSON.stringify(payload)}:{}),signal:AbortSignal.timeout(5000)});if(!response.ok)throw Error('暂时联系不上邮箱，收藏仍保留');return response.json();}
const options={preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true};
function secure(win){win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',e=>e.preventDefault());}
app.whenReady().then(async()=>{
 const a=screen.getPrimaryDisplay().workArea;const initial=await request('/state');const height=Math.max(260,(Number(initial.height)||120)+140);
 mailbox=new BrowserWindow({x:Math.round(a.x+a.width*.7-130),y:a.y+a.height-height,width:260,height,frame:false,transparent:true,alwaysOnTop:true,skipTaskbar:true,focusable:false,resizable:false,show:false,webPreferences:options});secure(mailbox);
 ipcMain.handle('postcard:call',async(event,action,id)=>{
  if(![mailbox?.webContents,reader?.webContents].includes(event.sender))throw Error('窗口已失效');
  if(action==='state')return request('/state');
  if(action==='read')return request('/read',String(id));
  if(action==='pickup-request')return request('/pickup-request',String(id));
  if(action==='presentation-done')return request('/presentation-done',id);
  if(action==='skip-pickup')return request('/skip-pickup',String(id));
  if(action==='mark-read')return request('/mark-read',String(id));
  if(action==='open-letter'){
    const automatic=typeof id==='object'&&id?.automatic===true;id=typeof id==='object'?id.tripId:id;
    if(!/^[a-f0-9-]{36}$/.test(String(id)))throw Error('没有这封来信');
    await request('/skip-pickup',String(id));
    if(reader&&!reader.isDestroyed())reader.close();
    reader=new BrowserWindow({width:570,height:760,title:'远方来信',show:false,autoHideMenuBar:true,webPreferences:options});const current=reader;current.once('closed',()=>{if(reader===current)reader=undefined;});secure(reader);await reader.loadFile(path.join(__dirname,'mailbox.html'),{hash:'letter='+id+(automatic?'&preview=1':'')});if(automatic)reader.showInactive();else reader.show();return {};
  }
  if(action==='close'){if(event.sender===mailbox.webContents)app.quit();else reader?.close();return {};}
  throw Error('未知邮箱操作');
 });
 ipcMain.on('postcard:rects',(event,value)=>{if(event.sender!==mailbox.webContents||!Array.isArray(value))return;rects=value.slice(0,12).filter(r=>['x','y','width','height'].every(k=>Number.isFinite(r[k])));});
 mailbox.setIgnoreMouseEvents(true,{forward:true});await mailbox.loadFile(path.join(__dirname,'mailbox.html'));mailbox.showInactive();
 const layer=require('./layer.cjs').keepBehindPet(mailbox);let lastLayer='';const updateLayer=()=>{const result=layer.update(),key=JSON.stringify(result);if(!result.supported)mailbox.setAlwaysOnTop(false);if(key!==lastLayer){lastLayer=key;fs.writeFileSync(path.join(process.env.POSTCARD_MAIL_PROFILE,'layer-state.json'),JSON.stringify({...result,at:new Date().toISOString()},null,2));}};updateLayer();const layerTimer=setInterval(updateLayer,800);mailbox.once('closed',()=>{clearInterval(layerTimer);layer.dispose();});
 const geometry={at:new Date().toISOString(),bounds:mailbox.getBounds(),workArea:a,scaleFactor:screen.getPrimaryDisplay().scaleFactor};
 fs.writeFileSync(path.join(process.env.POSTCARD_MAIL_PROFILE,'window-ready.json'),JSON.stringify(geometry,null,2));
 await request('/window',geometry);
 if(process.env.POSTCARD_MAIL_CAPTURE){setTimeout(async()=>{try{fs.writeFileSync(process.env.POSTCARD_MAIL_CAPTURE,(await mailbox.webContents.capturePage()).toPNG());}catch{}},2000);}
 let ignored=true;setInterval(()=>{if(mailbox.isDestroyed())return;const p=screen.getCursorScreenPoint(),b=mailbox.getBounds(),x=p.x-b.x,y=p.y-b.y;const next=!rects.some(r=>x>=r.x&&x<r.x+r.width&&y>=r.y&&y<r.y+r.height);if(next!==ignored){ignored=next;mailbox.setIgnoreMouseEvents(next,{forward:true});}},60);
});
app.on('window-all-closed',()=>app.quit());
setInterval(()=>{try{process.kill(Number(process.env.POSTCARD_MAIL_PARENT),0);}catch{app.quit();}},1500).unref();
