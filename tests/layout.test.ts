import {it,expect} from 'vitest';
import {createRequire} from 'node:module';
const {groundBounds}=createRequire(import.meta.url)('../desktop/layout.cjs');
const {placeBounds,chooseDisplay,restorePosition}=createRequire(import.meta.url)('../desktop/layout.cjs');
const {fallStep}=createRequire(import.meta.url)('../desktop/layout.cjs');
it('重力下落逐渐加速、限速且精确落地，卡顿不会穿过地面',()=>{
 let y=-900,v=0;const first=fallStep(y,v,640,1/60),second=fallStep(first.y,first.velocity,640,1/60);expect(second.y-first.y).toBeGreaterThan(first.y-y);
 for(let i=0;i<300;i++){const next=fallStep(y,v,640,1/60);expect(next.y).toBeGreaterThanOrEqual(y);expect(next.y).toBeLessThanOrEqual(640);expect(next.velocity).toBeLessThanOrEqual(1800);y=next.y;v=next.velocity;}
 expect(y).toBe(640);expect(v).toBe(0);expect(fallStep(639,1500,640,10)).toEqual({y:640,velocity:0,landed:true});
});
const displays=[{id:1,scaleFactor:1,workArea:{x:0,y:0,width:1920,height:1040}},{id:2,scaleFactor:1.25,workArea:{x:-1536,y:80,width:1536,height:824}},{id:3,scaleFactor:1.5,workArea:{x:0,y:-960,width:1707,height:920}}];
it('多屏选择支持左侧负坐标、上方屏幕及屏间空隙，DIP不二次缩放',()=>{
 expect(chooseDisplay(displays,{x:-600,y:300}).id).toBe(2);expect(chooseDisplay(displays,{x:400,y:-600}).id).toBe(3);
 expect(chooseDisplay(displays,{x:-600,y:-30}).id).toBe(2);
 expect(placeBounds(displays[1].workArea,260,{x:-900,y:300})).toEqual({x:-900,y:300,width:260,height:260});
 expect(placeBounds(displays[2].workArea,260,{x:5000,y:-3000})).toEqual({x:1447,y:-960,width:260,height:260});
});
it('旧位置按所在屏恢复；目标屏幕断开或缩放/布局变更后按相对位置保持可见',()=>{
 expect(restorePosition(displays,1,260,{x:-900,y:300}).display.id).toBe(2);
 const saved={displayId:'2',relativeX:.5,relativeY:.5,x:-900,y:300};
 const restored=restorePosition(displays,1,260,saved);expect(restored.bounds).toEqual({x:-898,y:362,width:260,height:260});
 const fallback=restorePosition([displays[0]],1,260,saved);expect(fallback.display.id).toBe(1);expect(fallback.bounds).toEqual({x:830,y:390,width:260,height:260});
 const moved=restorePosition([{...displays[1],workArea:{x:1920,y:0,width:1280,height:720}}],2,260,saved);expect(moved.bounds).toEqual({x:2430,y:230,width:260,height:260});
});
it.each([1,1.25,1.5,1.75,2])('DIP布局在缩放%s下不二次缩放，旧浮空/越界位置落地',scale=>{
 const area={x:0,y:0,width:1920/scale,height:1040/scale};
 const b=groundBounds(area,260,{x:99999,y:-999});expect(b.y+b.height).toBeCloseTo(Math.round(area.height),0);expect(b.x).toBe(Math.round(Math.max(0,area.width-260)));expect(b.width).toBe(260);
});
it('主屏为负坐标、任务栏在左/上、屏幕拔除回主屏时仍夹回可见地面',()=>{
 expect(groundBounds({x:-1880,y:40,width:1880,height:1040},260,{x:-9999,y:12})).toEqual({x:-1880,y:820,width:260,height:260});
 expect(groundBounds({x:40,y:0,width:1880,height:1040},260,{x:3000,y:-99})).toEqual({x:1660,y:780,width:260,height:260});
 expect(groundBounds({x:0,y:0,width:1280,height:680},260,{x:-1600,y:800})).toEqual({x:0,y:420,width:260,height:260});
});
it('损坏的旧横坐标回默认位置；无效显示尺寸拒绝',()=>{
 expect(groundBounds({x:0,y:0,width:1920,height:1040},260,{x:NaN}).x).toBe(1214);expect(()=>groundBounds({x:0,y:0,width:0,height:1040},260)).toThrow();
});
