import {it,expect,afterEach} from 'vitest';
import {mkdtempSync,mkdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {TravelService,TravelStore} from '../src/travel.ts';

const roots:string[]=[];
const scratch=()=>{const root=mkdtempSync(join(tmpdir(),'dispatch-reconcile-'));roots.push(root);return root;};
afterEach(()=>{while(roots.length)rmSync(roots.pop()!,{recursive:true,force:true});});

type TripState={id:string;scene:string;startedAt:number;dueAt:number;status:string;contentId?:string;grantRef?:string;failure?:unknown;series?:{id:string;total:number;nodeIndex:number;mark:string}};
const series=()=>({id:randomUUID(),total:3,nodeIndex:1,mark:'ocean'});
/**
 * The disk state an interrupted run leaves behind: the trip was generating and the grant already looked spent. Whatever
 * the stage wrote before the transport call is what the restart has to find.
 */
function crashed(root:string,stage:string,kind:'text'|'image',trips?:TripState[],journeys:unknown[]=[]){
 const id=randomUUID(),owner=trips?(trips.find(t=>t.grantRef)!.series!.id):id;
 writeFileSync(join(root,'state.json'),JSON.stringify({schema:1,notified:[],journeys,trips:trips??[{id,scene:'coast',startedAt:0,dueAt:1000,status:'generating',grantRef:'g1',failure:{kind:'budget_exhausted',stage,message:'旧失败',at:1}}]}));
 writeFileSync(join(root,'retry-grants.json'),JSON.stringify({schema:1,grants:[{id:'g1',tripId:id,owner,stage,kind,createdAt:1,consumedAt:2,consumedBy:id,state:'running',dispatchedAt:Date.now()}]}));
 return id;
}
const opened=(root:string)=>{const service=new TravelService(new TravelStore(root),undefined,()=>10);service.open();return service;};
const grants=(root:string)=>(JSON.parse(readFileSync(join(root,'retry-grants.json'),'utf8')).grants as any[]);

it('生图请求写在真实生成目录里：按可能已计费处理，不退回授权',async()=>{
 const root=scratch(),id=crashed(root,'image','image');
 mkdirSync(join(root,'trips',id),{recursive:true});
 writeFileSync(join(root,'trips',id,'image-3-request.json'),JSON.stringify({model:'img',prompt:'已发出的生图请求',grant:'g1'}));
 const service=opened(root);
 try{
  const trip=service.store.snapshot().trips.find(t=>t.id===id)!;
  expect(trip.failure!.message).toContain('结果不明');
  expect(grants(root)[0]).toMatchObject({state:'running'});
  expect(trip.grantRef).toBe('g1');
 }finally{service.close();}
});

it('只有 pendingImage 也算已派发：图片请求可能已经到达远端',async()=>{
 const root=scratch(),id=crashed(root,'image','image');
 mkdirSync(join(root,'trips',id),{recursive:true});
 writeFileSync(join(root,'trips',id,'checkpoint.json'),JSON.stringify({schema:1,imageAttempt:3,pendingImage:true,stage:'generating_image',textRequests:{},errors:[]}));
 const service=opened(root);
 try{
  expect(service.store.snapshot().trips.find(t=>t.id===id)!.failure!.message).toContain('结果不明');
  expect(grants(root)[0]).toMatchObject({state:'running'});
 }finally{service.close();}
});

it('独立文字接口的请求记录同样算痕迹：不因为没走宿主任务目录就退回授权',async()=>{
 const root=scratch(),id=crashed(root,'note-1','text');
 mkdirSync(join(root,'trips',id),{recursive:true});
 writeFileSync(join(root,'trips',id,'note-1-request.json'),JSON.stringify({model:'cloud-text',prompt:'已发出的文字请求',grant:'g1'}));
 const service=opened(root);
 try{
  expect(service.store.snapshot().trips.find(t=>t.id===id)!.failure!.message).toContain('结果不明');
  expect(grants(root)[0]).toMatchObject({state:'running'});
 }finally{service.close();}
});

it('续写路段按 contentId 找生成目录：痕迹写在前一段的目录里也能对上',async()=>{
 const root=scratch(),first=randomUUID(),id=randomUUID(),ref=series();
 const trips:TripState[]=[
  {id:first,scene:'coast',startedAt:0,dueAt:1000,status:'cancelled',series:ref},
  {id,scene:'coast',startedAt:0,dueAt:1000,status:'generating',contentId:first,series:ref,grantRef:'g1',failure:{kind:'budget_exhausted',stage:'image',message:'旧失败',at:1}},
 ];
 crashed(root,'image','image',trips,[{id:ref.id,mark:'ocean',scene:'coast',createdAt:1}]);
 mkdirSync(join(root,'trips',first),{recursive:true});
 writeFileSync(join(root,'trips',first,'image-3-request.json'),JSON.stringify({model:'img',prompt:'已发出的生图请求',grant:'g1'}));
 const service=opened(root);
 try{
  expect(service.store.snapshot().trips.find(t=>t.id===id)!.failure!.message).toContain('结果不明');
  expect(grants(root)[0]).toMatchObject({state:'running'});
 }finally{service.close();}
});

it('生成目录读不出来时按无法确认处理：既不退回也不自动重发',async()=>{
 const root=scratch(),id=crashed(root,'image','image');
 writeFileSync(join(root,'trips'),'not a directory');
 const service=opened(root);
 try{
  const trip=service.store.snapshot().trips.find(t=>t.id===id)!;
  expect(trip.failure!.message).toContain('无法确认');
  expect(grants(root)[0]).toMatchObject({state:'running'});
  expect(()=>service.retry(id,false,'g1')).toThrow('已经用过');
 }finally{service.close();}
});

it('无关的近期任务文件不作为证据：确实没派发就退回授权',async()=>{
 const root=scratch(),id=crashed(root,'plan-1','text');
 mkdirSync(join(root,'host-tasks'),{recursive:true});
 writeFileSync(join(root,'host-tasks','other.json'),JSON.stringify({id:'other',tripId:'someone-else',label:'plan-1',payload:{__postcardTask:{tripId:'someone-else',label:'plan-1'}}}));
 mkdirSync(join(root,'journey-tasks','another-series'),{recursive:true});
 writeFileSync(join(root,'journey-tasks','another-series','plan-1.json'),JSON.stringify({attempts:2,grant:'other-grant'}));
 mkdirSync(join(root,'trips','another-trip'),{recursive:true});
 writeFileSync(join(root,'trips','another-trip','image-2-request.json'),JSON.stringify({grant:'other-grant'}));
 const service=opened(root);
 try{
  const trip=service.store.snapshot().trips.find(t=>t.id===id)!;
  expect(trip.failure!.message).toContain('派发前中断');
  expect(trip.grantRef).toBeUndefined();
  expect(grants(root)[0]).toMatchObject({state:'reserved'});
  expect(()=>service.retry(id,false,'g1')).not.toThrow();
 }finally{service.close();}
});
