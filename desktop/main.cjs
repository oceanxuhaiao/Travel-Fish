const {app,BrowserWindow,ipcMain,screen,powerMonitor,Menu}=require('electron');
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
 const positionFile=path.join(process.env.POSTCARD_MAIL_PROFILE,'position.json');const initial=await request('/state');const height=Math.max(260,(Number(initial.height)||120)+140);
 const {groundBounds,placeBounds,chooseDisplay,restorePosition,fallStep}=require('./layout.cjs');
 let falling=null;
 const displays=()=>{const all=screen.getAllDisplays();return all.length?all:[screen.getPrimaryDisplay()];};
 let savedPosition={};try{savedPosition=JSON.parse(fs.readFileSync(positionFile,'utf8'))||{};}catch{}
 const restored=restorePosition(displays(),screen.getPrimaryDisplay().id,height,savedPosition);let currentDisplay=restored.display;
 const clamp=(b,point)=>{currentDisplay=chooseDisplay(displays(),point||{x:b.x+130,y:b.y+height/2});return placeBounds(currentDisplay.workArea,height,b);};
 const position=restored.bounds;
 const moveWithCursor=()=>{const cursor=screen.getCursorScreenPoint(),dx=cursor.x-drag.cursor.x,dy=cursor.y-drag.cursor.y;if(Math.hypot(dx,dy)>=5)drag.moved=true;if(drag.moved)mailbox.setBounds(clamp({x:drag.bounds.x+dx,y:drag.bounds.y+dy},cursor));};
 mailbox=new BrowserWindow({...position,width:260,height,frame:false,transparent:true,alwaysOnTop:true,skipTaskbar:true,focusable:false,resizable:false,show:false,webPreferences:options});secure(mailbox);
 ipcMain.handle('postcard:call',async(event,action,id)=>{
  if(![mailbox?.webContents,reader?.webContents].includes(event.sender))throw Error('窗口已失效');
  if(action.startsWith('drag-')){
    if(event.sender!==mailbox.webContents)throw Error('窗口已失效');
    if(action==='drag-start'){falling=null;drag={cursor:screen.getCursorScreenPoint(),bounds:mailbox.getBounds(),moved:false,startedAt:Date.now()};mailbox.setIgnoreMouseEvents(false);void reportGeometry();return {};}
    if(action==='drag-move'&&drag){moveWithCursor();return {moved:drag.moved};}
    if(action==='drag-end'){const moved=!!drag?.moved;drag=null;startFall();return {moved};}return {};
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
 const geometryNow=()=>{const bounds=mailbox.getBounds(),primary=screen.getPrimaryDisplay(),a=currentDisplay.workArea;return {at:new Date().toISOString(),bounds,workArea:a,scaleFactor:currentDisplay.scaleFactor,displayId:String(currentDisplay.id),primaryDisplayId:String(primary.id),pickupSupported:!drag&&!falling&&String(currentDisplay.id)===String(primary.id)&&Math.abs(bounds.y+bounds.height-a.y-a.height)<=8};};
 // Geometry reporting must never own the lifetime of local mouse interaction.
 const saveProfile=(name,value)=>{try{fs.writeFileSync(path.join(process.env.POSTCARD_MAIL_PROFILE,name),JSON.stringify(value,null,2));}catch{}};
 let reportTimer,reporting=false,reportPending=false;
 const reportGeometry=async(attempt=1)=>{
  clearTimeout(reportTimer);if(mailbox.isDestroyed())return;
  if(reporting){reportPending=true;return;}reporting=true;
  const geometry=geometryNow();
  const a=currentDisplay.workArea;
  savedPosition={x:geometry.bounds.x,y:geometry.bounds.y,displayId:String(currentDisplay.id),relativeX:(geometry.bounds.x-a.x)/Math.max(1,a.width-260),relativeY:(geometry.bounds.y-a.y)/Math.max(1,a.height-height)};
  saveProfile('position.json',savedPosition);
  saveProfile('window-ready.json',{...geometry,displays:screen.getAllDisplays().map(d=>({id:d.id,bounds:d.bounds,workArea:d.workArea,scaleFactor:d.scaleFactor}))});
  try{await request('/window',geometry);saveProfile('window-report.json',{phase:'reported',attempt,at:new Date().toISOString()});}
  catch{saveProfile('window-report.json',{phase:'unavailable',attempt,at:new Date().toISOString()});if(attempt<3&&!mailbox.isDestroyed())reportTimer=setTimeout(()=>void reportGeometry(attempt+1),1000*attempt);}
  finally{reporting=false;if(reportPending&&!mailbox.isDestroyed()){reportPending=false;void reportGeometry();}}
 };
 mailbox.once('closed',()=>clearTimeout(reportTimer));
 const startFall=()=>{if(mailbox.isDestroyed())return;const b=mailbox.getBounds(),floor=groundBounds(currentDisplay.workArea,height,b).y;falling=b.y<floor?{y:b.y,velocity:0,at:Date.now()}:null;if(!falling&&b.y!==floor)mailbox.setBounds({x:b.x,y:floor,width:260,height});void reportGeometry();};
 const chooseScreen=(id)=>{const target=displays().find(d=>String(d.id)===String(id));if(!target)return;drag=null;falling=null;const b=mailbox.getBounds(),old=currentDisplay.workArea,a=target.workArea;currentDisplay=target;mailbox.setBounds(placeBounds(a,height,{x:a.x+(b.x-old.x)/Math.max(1,old.width-260)*Math.max(0,a.width-260),y:a.y+(b.y-old.y)/Math.max(1,old.height-height)*Math.max(0,a.height-height)}));startFall();};
 mailbox.webContents.on('context-menu',()=>{const primary=screen.getPrimaryDisplay();Menu.buildFromTemplate([{label:'邮箱所在屏幕',submenu:displays().map((d,i)=>({label:`${i+1} · ${d.label||'显示器'}${String(d.id)===String(primary.id)?'（主屏）':''} · ${Math.round(d.workArea.width)} × ${Math.round(d.workArea.height)}`,type:'radio',checked:String(d.id)===String(currentDisplay.id),click:()=>chooseScreen(d.id)}))},{label:'放到当前屏幕底部',click:()=>{drag=null;falling=null;mailbox.setBounds(placeBounds(currentDisplay.workArea,height,{x:mailbox.getBounds().x}));void reportGeometry();}}]).popup({window:mailbox});});
 let moveTimer;mailbox.on('will-move',(event,bounds)=>{const safe=clamp(bounds,drag?screen.getCursorScreenPoint():undefined);if(safe.x!==bounds.x||safe.y!==bounds.y){event.preventDefault();mailbox.setBounds(safe);}});
 mailbox.on('move',()=>{clearTimeout(moveTimer);moveTimer=setTimeout(()=>void reportGeometry(),120);});mailbox.once('closed',()=>clearTimeout(moveTimer));
 let refreshTimer;const refreshDisplay=()=>{clearTimeout(refreshTimer);refreshTimer=setTimeout(()=>{if(mailbox.isDestroyed())return;drag=null;falling=null;const restored=restorePosition(displays(),screen.getPrimaryDisplay().id,height,savedPosition);currentDisplay=restored.display;mailbox.setBounds(restored.bounds);startFall();},150);};
 for(const event of ['display-added','display-removed','display-metrics-changed'])screen.on(event,refreshDisplay);powerMonitor.on('resume',refreshDisplay);
 mailbox.once('closed',()=>{clearTimeout(refreshTimer);for(const event of ['display-added','display-removed','display-metrics-changed'])screen.removeListener(event,refreshDisplay);powerMonitor.removeListener('resume',refreshDisplay);});
 saveProfile('display-state.json',screen.getAllDisplays().map(d=>({id:d.id,bounds:d.bounds,workArea:d.workArea,scaleFactor:d.scaleFactor})));
 if(process.env.POSTCARD_MAIL_CAPTURE){setTimeout(async()=>{try{fs.writeFileSync(process.env.POSTCARD_MAIL_CAPTURE,(await mailbox.webContents.capturePage()).toPNG());}catch{}},2000);}
 // Follow the system cursor even when moving a transparent window stops renderer pointermove.
 const dragTimer=setInterval(()=>{if(mailbox.isDestroyed())return;if(drag){if((leftPressed&&!leftPressed())||Date.now()-drag.startedAt>60000){drag=null;startFall();return;}moveWithCursor();return;}if(falling){const b=mailbox.getBounds(),now=Date.now(),floor=groundBounds(currentDisplay.workArea,height,b).y;const next=fallStep(falling.y,falling.velocity,floor,Math.max(1/120,(now-falling.at)/1000));falling=next.landed?null:{y:next.y,velocity:next.velocity,at:now};mailbox.setBounds({x:b.x,y:Math.round(next.y),width:260,height});if(next.landed)void reportGeometry();}},16);
 mailbox.once('closed',()=>{clearInterval(dragTimer);drag=null;falling=null;});
 let ignored=true;const hitTimer=setInterval(()=>{if(mailbox.isDestroyed())return;const p=screen.getCursorScreenPoint(),b=mailbox.getContentBounds(),x=p.x-b.x,y=p.y-b.y,pad=ignored?0:3;const next=!drag&&!rects.some(r=>x>=r.x-pad&&x<r.x+r.width+pad&&y>=r.y-pad&&y<r.y+r.height+pad);if(next!==ignored){ignored=next;mailbox.setIgnoreMouseEvents(next,{forward:true});}},60);
 mailbox.once('closed',()=>clearInterval(hitTimer));
 startFall();
});
app.on('window-all-closed',()=>app.quit());
setInterval(()=>{try{process.kill(Number(process.env.POSTCARD_MAIL_PARENT),0);}catch{app.quit();}},1500).unref();
