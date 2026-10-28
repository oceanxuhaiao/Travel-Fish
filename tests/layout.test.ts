import {it,expect} from 'vitest';
import {createRequire} from 'node:module';
const {groundBounds}=createRequire(import.meta.url)('../desktop/layout.cjs');
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
