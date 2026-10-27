import {it,expect,vi,afterEach} from 'vitest';
import {JSDOM} from 'jsdom';
import {mountAlbum} from '../webui/client.ts';
let fixtures=[];
function fixture(cards=[]){
  const dom=new JSDOM('<main id="root"></main>');const w=dom.window;w.HTMLElement.prototype.scrollIntoView=()=>{};
  const controller=new w.AbortController(),memo=new Map(),resources=[],timers=[];
  let state={trip:null,cards,minutes:30,generatorConnected:true};
  const ctx={root:w.document.getElementById('root'),signal:controller.signal,memo:{get:(k,d)=>memo.has(k)?memo.get(k):d,set:(k,v)=>memo.set(k,v)},own:d=>{resources.push(d);return d;},interval:f=>{timers.push(f);return {dispose(){}};},timeout:()=>({dispose(){}}),ui:{confirm:vi.fn(async()=>true)},invoke:vi.fn(async(method,args)=>{
    if(method==='start')state={...state,trip:{id:'test-trip',scene:args[0]==='surprise'?'forest':args[0],status:'traveling',dueAt:Date.now()+1800000}};
    if(method==='cancel')state={...state,trip:{...state.trip,status:'cancelled'}};
    return structuredClone(state);
  }),invokeBinary:vi.fn(async()=>new Blob(['image']))};
  const f={dom,ctx,memo,timers,setState:s=>state=s,dispose:()=>{controller.abort();resources.forEach(r=>r.dispose());dom.window.close();}};fixtures.push(f);return f;
}
const card=(id,scene)=>({tripId:id,scene,title:'一封安静的来信',note:'像把一阵风轻轻留在信里。',completedAt:1700000000000});
const flush=()=>new Promise(r=>setImmediate(r));
afterEach(()=>{fixtures.forEach(f=>f.dispose());fixtures=[];vi.restoreAllMocks();});
it('空态、出发、等待和取消通过标准invoke调用',async()=>{
  const f=fixture();await mountAlbum(f.ctx);expect(f.ctx.root.textContent).toContain('第一封来信');
  const b=[...f.ctx.root.querySelectorAll('button')].find(b=>b.textContent==='带一封来信回来');b.click();await flush();
  expect(f.ctx.invoke).toHaveBeenCalledWith('start',['surprise']);expect(f.ctx.root.textContent).toContain('正在去萤光森林');
  [...f.ctx.root.querySelectorAll('button')].find(b=>b.textContent==='先回家').click();await flush();expect(f.ctx.invoke).toHaveBeenCalledWith('cancel',['test-trip']);
});
it('目的地筛选、翻面和选择状态保留，内容不注入HTML',async()=>{
  const create=vi.spyOn(URL,'createObjectURL').mockReturnValue('blob:test');vi.spyOn(URL,'revokeObjectURL').mockImplementation(()=>{});
  const f=fixture([card('a','forest'),card('b','snow')]);await mountAlbum(f.ctx);await flush();expect(f.ctx.root.querySelectorAll('.pc-postcard')).toHaveLength(2);
  [...f.ctx.root.querySelectorAll('button')].find(b=>b.textContent==='雪夜小镇').click();expect(f.ctx.root.querySelectorAll('.pc-postcard')).toHaveLength(1);expect(f.memo.get('filter')).toBe('snow');
  f.ctx.root.querySelector('.pc-postcard').click();await flush();expect(f.ctx.invokeBinary).toHaveBeenCalledWith('image',['b']);
  [...f.ctx.root.querySelectorAll('button')].find(b=>b.textContent==='翻到背面读信').click();await flush();expect(f.ctx.root.querySelector('.pc-note').textContent).toContain('一阵风');expect(f.memo.get('flipped')).toBe(true);
  expect(create).toHaveBeenCalled();
});
it('卸载释放图片URL，之后的轮询不会继续请求',async()=>{
  vi.spyOn(URL,'createObjectURL').mockReturnValue('blob:test');const revoke=vi.spyOn(URL,'revokeObjectURL').mockImplementation(()=>{});
  const f=fixture([card('a','forest')]);await mountAlbum(f.ctx);await flush();f.dispose();fixtures=[];const calls=f.ctx.invoke.mock.calls.length;f.timers.forEach(f=>f());await flush();expect(f.ctx.invoke.mock.calls.length).toBe(calls);expect(revoke).toHaveBeenCalledWith('blob:test');
});
it('结果不确定的重试需要确认，取消确认不会发出重试请求',async()=>{
  const f=fixture();f.setState({trip:{id:'uncertain-trip',scene:'snow',status:'failed',dueAt:0,error:'上次图片结果不确定'},cards:[],minutes:30,generatorConnected:true});
  f.ctx.ui.confirm.mockResolvedValue(false);await mountAlbum(f.ctx);
  [...f.ctx.root.querySelectorAll('button')].find(b=>b.textContent==='继续准备').click();await flush();expect(f.ctx.invoke.mock.calls.filter(c=>c[0]==='retry')).toHaveLength(0);
  f.ctx.ui.confirm.mockResolvedValue(true);[...f.ctx.root.querySelectorAll('button')].find(b=>b.textContent==='继续准备').click();await flush();expect(f.ctx.invoke).toHaveBeenCalledWith('retry',['uncertain-trip',true]);
});
