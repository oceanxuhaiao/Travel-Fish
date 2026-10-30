// Electron coordinates are DIP. Scale factors must not be applied a second time.
function groundBounds(area,height,bounds={}){
 const width=260;
 if(!area||!['x','y','width','height'].every(k=>Number.isFinite(area[k]))||area.width<=0||area.height<=0||!Number.isFinite(height)||height<=0)throw Error('Invalid display geometry');
 const x=Number.isFinite(bounds.x)?bounds.x:area.x+area.width*.7-width/2;
 return {x:Math.round(Math.max(area.x,Math.min(area.x+Math.max(0,area.width-width),x))),y:Math.round(area.y+Math.max(0,area.height-height)),width,height};
}
function placeBounds(area,height,bounds={}){
 const grounded=groundBounds(area,height,bounds);
 return {...grounded,y:Math.round(Math.max(area.y,Math.min(area.y+Math.max(0,area.height-height),Number.isFinite(bounds.y)?bounds.y:grounded.y)))};
}
function chooseDisplay(displays,point,preferredId){
 const preferred=displays.find(d=>preferredId!==undefined&&String(d.id)===String(preferredId));
 if(preferred)return preferred;
 if(!displays.length)throw Error('No displays available');
 const distance=d=>{const a=d.bounds||d.workArea;return Math.hypot(Math.max(a.x-point.x,0,point.x-(a.x+a.width)),Math.max(a.y-point.y,0,point.y-(a.y+a.height)));};
 return displays.reduce((best,d)=>distance(d)<distance(best)?d:best,displays[0]);
}
function restorePosition(displays,primaryId,height,saved={}){
 const primary=displays.find(d=>String(d.id)===String(primaryId))||displays[0];
 const hasDisplay=saved.displayId!==undefined;
 const display=hasDisplay?(displays.find(d=>String(d.id)===String(saved.displayId))||primary):Number.isFinite(saved.x)&&Number.isFinite(saved.y)?chooseDisplay(displays,{x:saved.x+130,y:saved.y+height/2}):primary;
 const a=display.workArea;
 const relative=hasDisplay&&Number.isFinite(saved.relativeX)&&Number.isFinite(saved.relativeY);
 const bounds=relative?{x:a.x+saved.relativeX*Math.max(0,a.width-260),y:a.y+saved.relativeY*Math.max(0,a.height-height)}:hasDisplay&&String(display.id)!==String(saved.displayId)?{}:saved;
 return {display,bounds:placeBounds(a,height,bounds)};
}
function fallStep(y,velocity,floor,dt){
 dt=Math.max(0,Math.min(.05,dt));
 const speed=Math.min(1800,velocity+2200*dt),next=Math.min(floor,y+(velocity+speed)*.5*dt);
 return {y:next,velocity:next>=floor?0:speed,landed:next>=floor};
}
module.exports={groundBounds,placeBounds,chooseDisplay,restorePosition,fallStep};
