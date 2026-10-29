const {app,BrowserWindow,ipcMain,screen,powerMonitor}=require('electron');
const path=require('node:path'),fs=require('node:fs');
app.disableHardwareAcceleration();
fs.mkdirSync(process.env.POSTCARD_MAIL_PROFILE,{recursive:true});
app.setPath('userData',process.env.POSTCARD_MAIL_PROFILE);
const origin=process.env.POSTCARD_MAIL_ORIGIN,token=process.env.POSTCARD_MAIL_TOKEN;
let mailbox,reader,readerTrip,readerOpening,rects=[],drag=null;
let leftPressed;try{if(process.platform==='win32'){const ffi=require('koffi');const key=ffi.load('user32.dll').func('short __stdcall GetAsyncKeyState(int key)');leftPressed=()=>!!(key(1)&0x8000);}}catch{}

async function request(route,payload){if(typeof payload==='string')payload={tripId:payload};const response=await fetch(origin+route,{method:payload?'POST':'GET',headers:{Authorization:'Bearer '+token,...(payload?{'Content-Type':'application/json'}:{})},...(payload?{body:JSON.stringify(payload)}:{}),signal:AbortSignal.timeout(5000)});if(!response.ok)throw Error('暂时联系不上邮箱，收藏仍保留');return response.json();}
const options={preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true};
function secure(win){win.webContents.on('render-process-gone',()=>{if(win===mailbox)app.quit();else if(!win.isDestroyed())win.close();});win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',e=>e.preventDefault());}
app.whenReady().then(async()=>{
 let a=screen.getPrimaryDisplay().workArea;const positionFile=path.join(process.env.POSTCARD_MAIL_PROFILE,'position.json');const initial=await request('/state');const height=Math.max(260,(Number(initial.height)||120)+140);
 const {groundBounds}=require('./layout.cjs');const clamp=(b)=>groundBounds(a,height,b);let position=clamp({x:a.x+a.width*.7-130,y:a.y+a.height-height});try{const saved=JSON.parse(fs.readFileSync(positionFile,'utf8'));if(Number.isFinite(saved.x)&&Number.isFinite(saved.y))position=clamp(saved);}catch{}
 mailbox=new BrowserWindow({...position,width:260,height,frame:false,transparent:true,alwaysOnTop:true,skipTaskbar:true,focusable:false,resizable:false,show:false,webPreferences:options});secure(mailbox);
 ipcMain.handle('postcard:call',async(event,action,id)=>{
  if(![mailbox?.webContents,reader?.webContents].includes(event.sender))throw Error('窗口已失效');
  if(action.startsWith('drag-')){
    if(event.sender!==mailbox.webContents)throw Error('窗口已失效');
    if(action==='drag-start'){drag={cursor:screen.getCursorScreenPoint(),bounds:mailbox.getBounds(),moved:false,startedAt:Date.now()};mailbox.setIgnoreMouseEvents(false);return {};}
    if(action==='drag-move'&&drag){const cursor=screen.getCursorScreenPoint(),dx=cursor.x-drag.cursor.x,dy=cursor.y-drag.cursor.y;if(Math.hypot(dx,dy)>=5)drag.moved=true;if(drag.moved)mailbox.setBounds(clamp({x:drag.bounds.x+dx,y:drag.bounds.y+dy}));return {moved:drag.moved};}
    if(action==='drag-end'){const moved=!!drag?.moved;drag=null;return {moved};}return {};
  }
  if(action==='state')return request('/state');
  if(action==='read')return request('/read',String(id));
  if(action==='pickup-request')return request('/pickup-request',String(id));
  if(action==='presentation-done')return request('/presentation-done',id);
  if(action==='skip-pickup')return request('/skip-pickup',String(id));
  if(action==='mark-read')return request('/mark-read',String(id));
  if(action==='open-letter'){
    const automatic=typeof id==='object'&&id?.automatic===true;id=typeof id==='object'?id.tripId:id;
    if(!/^[a-f0-9-]{36}$/.test(String(id)))throw Error('没有这封来信');
    if(readerOpening)return readerOpening;
    if(reader&&!reader.isDestroyed()&&readerTrip===id){if(!automatic)reader.show();return {};}
    readerOpening=(async()=>{await request('/skip-pickup',String(id));
    if(reader&&!reader.isDestroyed())reader.close();
    reader=new BrowserWindow({width:570,height:760,title:'远方来信',show:false,autoHideMenuBar:true,webPreferences:options});readerTrip=id;const current=reader;current.once('closed',()=>{if(reader===current){reader=undefined;readerTrip=undefined;}});secure(reader);await reader.loadFile(path.join(__dirname,'mailbox.html'),{hash:'letter='+id+(automatic?'&preview=1':'')});if(automatic)reader.showInactive();else reader.show();return {};})();try{return await readerOpening;}finally{readerOpening=undefined;}
  }
  if(action==='close'){if(event.sender===mailbox.webContents)app.quit();else reader?.close();return {};}
  throw Error('未知邮箱操作');
 });
 ipcMain.on('postcard:rects',(event,value)=>{if(event.sender!==mailbox.webContents||!Array.isArray(value))return;rects=value.slice(0,12).filter(r=>['x','y','width','height'].every(k=>Number.isFinite(r[k])));});
 mailbox.setIgnoreMouseEvents(true,{forward:true});let debugUi=false;try{debugUi=JSON.parse(fs.readFileSync(path.join(process.env.POSTCARD_MAIL_PROFILE,'dev-ui.json'),'utf8')).enabled===true;}catch{}await mailbox.loadFile(path.join(__dirname,'mailbox.html'),{hash:debugUi?'debug=1':''});mailbox.showInactive();
 const layer=require('./layer.cjs').keepBehindPet(mailbox);let lastLayer='';const updateLayer=()=>{const result=layer.update(),key=JSON.stringify(result);if(!result.supported)mailbox.setAlwaysOnTop(false);if(key!==lastLayer){lastLayer=key;fs.writeFileSync(path.join(process.env.POSTCARD_MAIL_PROFILE,'layer-state.json'),JSON.stringify({...result,at:new Date().toISOString()},null,2));}};updateLayer();const layerTimer=setInterval(updateLayer,800);mailbox.once('closed',()=>{clearInterval(layerTimer);layer.dispose();});
 const geometryNow=()=>({at:new Date().toISOString(),bounds:mailbox.getBounds(),workArea:a,scaleFactor:screen.getPrimaryDisplay().scaleFactor});
 // Geometry reporting must never own the lifetime of local mouse interaction.
 const saveProfile=(name,value)=>{try{fs.writeFileSync(path.join(process.env.POSTCARD_MAIL_PROFILE,name),JSON.stringify(value,null,2));}catch{}};
 let reportTimer,reporting=false,reportPending=false;
 const reportGeometry=async(attempt=1)=>{
  clearTimeout(reportTimer);if(mailbox.isDestroyed())return;
  if(reporting){reportPending=true;return;}reporting=true;
  const geometry=geometryNow();
  saveProfile('position.json',{x:geometry.bounds.x,y:geometry.bounds.y});
  saveProfile('window-ready.json',{...geometry,displays:screen.getAllDisplays().map(d=>({id:d.id,bounds:d.bounds,workArea:d.workArea,scaleFactor:d.scaleFactor}))});
  try{await request('/window',geometry);saveProfile('window-report.json',{phase:'reported',attempt,at:new Date().toISOString()});}
  catch{saveProfile('window-report.json',{phase:'unavailable',attempt,at:new Date().toISOString()});if(attempt<3&&!mailbox.isDestroyed())reportTimer=setTimeout(()=>void reportGeometry(attempt+1),1000*attempt);}
  finally{reporting=false;if(reportPending&&!mailbox.isDestroyed()){reportPending=false;void reportGeometry();}}
 };
 mailbox.once('closed',()=>clearTimeout(reportTimer));
 let moveTimer;mailbox.on('will-move',(event,bounds)=>{const safe=clamp(bounds);if(safe.x!==bounds.x||safe.y!==bounds.y){event.preventDefault();mailbox.setBounds(safe);}});
 mailbox.on('move',()=>{clearTimeout(moveTimer);moveTimer=setTimeout(()=>void reportGeometry(),120);});mailbox.once('closed',()=>clearTimeout(moveTimer));
 let refreshTimer;const refreshDisplay=()=>{clearTimeout(refreshTimer);refreshTimer=setTimeout(()=>{if(mailbox.isDestroyed())return;drag=null;a=screen.getPrimaryDisplay().workArea;mailbox.setBounds(clamp(mailbox.getBounds()));void reportGeometry();},150);};
 for(const event of ['display-added','display-removed','display-metrics-changed'])screen.on(event,refreshDisplay);powerMonitor.on('resume',refreshDisplay);
 mailbox.once('closed',()=>{clearTimeout(refreshTimer);for(const event of ['display-added','display-removed','display-metrics-changed'])screen.removeListener(event,refreshDisplay);powerMonitor.removeListener('resume',refreshDisplay);});
 saveProfile('display-state.json',screen.getAllDisplays().map(d=>({id:d.id,bounds:d.bounds,workArea:d.workArea,scaleFactor:d.scaleFactor})));
 if(process.env.POSTCARD_MAIL_CAPTURE){setTimeout(async()=>{try{fs.writeFileSync(process.env.POSTCARD_MAIL_CAPTURE,(await mailbox.webContents.capturePage()).toPNG());}catch{}},2000);}
 // Follow the system cursor even when moving a transparent window stops renderer pointermove.
 const dragTimer=setInterval(()=>{if(!drag||mailbox.isDestroyed())return;if((leftPressed&&!leftPressed())||Date.now()-drag.startedAt>60000){drag=null;return;}const cursor=screen.getCursorScreenPoint(),dx=cursor.x-drag.cursor.x,dy=cursor.y-drag.cursor.y;if(Math.hypot(dx,dy)>=5)drag.moved=true;if(drag.moved)mailbox.setBounds(clamp({x:drag.bounds.x+dx,y:drag.bounds.y}));},16);
 mailbox.once('closed',()=>{clearInterval(dragTimer);drag=null;});
 let ignored=true;const hitTimer=setInterval(()=>{if(mailbox.isDestroyed())return;const p=screen.getCursorScreenPoint(),b=mailbox.getContentBounds(),x=p.x-b.x,y=p.y-b.y,pad=ignored?0:3;const next=!drag&&!rects.some(r=>x>=r.x-pad&&x<r.x+r.width+pad&&y>=r.y-pad&&y<r.y+r.height+pad);if(next!==ignored){ignored=next;mailbox.setIgnoreMouseEvents(next,{forward:true});}},60);
 mailbox.once('closed',()=>clearInterval(hitTimer));
 void reportGeometry();
});
app.on('window-all-closed',()=>app.quit());
setInterval(()=>{try{process.kill(Number(process.env.POSTCARD_MAIL_PARENT),0);}catch{app.quit();}},1500).unref();
