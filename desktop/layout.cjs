// Electron coordinates are DIP. Scale factors must not be applied a second time.
function groundBounds(area,height,bounds={}){
 const width=260;
 if(!area||!['x','y','width','height'].every(k=>Number.isFinite(area[k]))||area.width<=0||area.height<=0||!Number.isFinite(height)||height<=0)throw Error('Invalid display geometry');
 const x=Number.isFinite(bounds.x)?bounds.x:area.x+area.width*.7-width/2;
 return {x:Math.round(Math.max(area.x,Math.min(area.x+Math.max(0,area.width-width),x))),y:Math.round(area.y+Math.max(0,area.height-height)),width,height};
}
module.exports={groundBounds};
