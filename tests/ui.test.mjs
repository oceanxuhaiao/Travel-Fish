import {mountSetup} from '../webui/setup.ts';
import {it,expect,vi,afterEach} from 'vitest';
import {JSDOM} from 'jsdom';
import {mountAlbum} from '../webui/client.ts';
let fixtures=[];
function fixture(cards=[]){
  const dom=new JSDOM('<main id="root"></main>');const w=dom.window;w.HTMLElement.prototype.scrollIntoView=()=>{};
  const controller=new w.AbortController(),memo=new Map(),resources=[],timers=[];
  let state={trip:null,cards,minutes:30,generatorConnected:true};
  const ctx={root:w.document.getElementById('root'),signal:controller.signal,memo:{get:(k,d)=>memo.has(k)?memo.get(k):d,set:(k,v)=>memo.set(k,v)},own:d=>{resources.push(d);return d;},interval:f=>{timers.push(f);return {dispose(){}};},timeout:()=>({dispose(){}}),ui:{confirm:vi.fn(async()=>true)},invoke:vi.fn(async(method,args)=>{
    if(method==='start')state={...state,trip:{id:'test-trip',scene:'forest',status:'traveling',dueAt:Date.now()+1800000}};
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
  expect(f.ctx.invoke).toHaveBeenCalledWith('start',[]);expect(f.ctx.root.textContent).toContain('正在远方旅行');
  [...f.ctx.root.querySelectorAll('button')].find(b=>b.textContent==='先回家').click();await flush();expect(f.ctx.invoke).toHaveBeenCalledWith('cancel',['test-trip']);
});
it('收藏按时间展示，不受旧地点筛选记忆影响，翻面状态保留',async()=>{
  const create=vi.spyOn(URL,'createObjectURL').mockReturnValue('blob:test');vi.spyOn(URL,'revokeObjectURL').mockImplementation(()=>{});
  const f=fixture([{...card('a','forest'),completedAt:1000},{...card('b','snow'),completedAt:2000}]);f.memo.set('filter','forest');await mountAlbum(f.ctx);await flush();expect(f.ctx.root.querySelectorAll('.pc-postcard')).toHaveLength(2);
  expect(f.ctx.root.querySelector('.pc-filters')).toBeNull();expect(f.ctx.root.querySelector('select')).toBeNull();
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

it('不展示场景目录、分类徽章或目的地控件，未知类别收藏仍可看',async()=>{
 const f=fixture([card('x','future-category')]);f.setState({trip:null,cards:[card('x','future-category')],minutes:30,generatorConnected:true,places:{forest:'萤光森林',coast:'海岸',snow:'雪夜小镇',lake:'湖畔',valley:'山谷',dunes:'沙丘',flowers:'花田',waterside:'水边小镇'}});
 vi.spyOn(URL,'createObjectURL').mockReturnValue('blob:test');await mountAlbum(f.ctx);expect(f.ctx.root.querySelectorAll('select')).toHaveLength(0);expect(f.ctx.root.querySelectorAll('.pc-filters,.pc-place')).toHaveLength(0);expect(f.ctx.root.textContent).not.toContain('水边小镇');expect(f.ctx.root.querySelector('img').alt).toContain('一封安静的来信');
});

it('配置引导解释八项设置，密钥输入保存后清空且不缓存',async()=>{
 const f=fixture();f.ctx.invoke.mockImplementation(async(method)=>method==='snapshot'?{keys:{ark:false,vision:false},secureSaveAvailable:true,cloudEnabled:false,characterReference:'',styleReference:''}:{keys:{ark:true,vision:false}});
 await mountSetup(f.ctx);expect(f.ctx.root.querySelectorAll('dt')).toHaveLength(8);expect(f.ctx.root.textContent).toContain('不调用 API');
 const input=f.ctx.root.querySelector('input');expect(input.type).toBe('password');input.value='mock-only-key';[...f.ctx.root.querySelectorAll('button')].find(b=>b.textContent==='保存此服务密钥').click();await flush();expect(input.value).toBe('');expect(f.memo.size).toBe(0);expect(f.ctx.root.textContent).not.toContain('mock-only-key');
});
