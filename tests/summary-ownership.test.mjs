import {it,expect,vi,beforeEach,afterEach} from 'vitest';
import {JSDOM} from 'jsdom';
import {mountAlbum} from '../webui/client.ts';

/*
 * Issue #5 回归：第三张明信片的总结必须归属 card.series.id 那一趟旅程。
 * 全程合成夹具：两个 journeyId、明显不同的总结正文，不触发任何生成/计费动作。
 */
let fixtures=[];
beforeEach(()=>{vi.spyOn(URL,'createObjectURL').mockReturnValue('blob:test');vi.spyOn(URL,'revokeObjectURL').mockImplementation(()=>{});});
afterEach(()=>{fixtures.forEach(f=>f.dispose());fixtures=[];vi.restoreAllMocks();});

const flush=()=>new Promise(r=>setImmediate(r));
const settle=async(n=4)=>{for(let i=0;i<n;i++)await flush();};
const deferred=()=>{let resolve,reject;const promise=new Promise((res,rej)=>{resolve=res;reject=rej;});return{promise,resolve,reject};};

const card=(id,title,completedAt,series)=>({tripId:id,scene:'forest',title,note:'短笺 '+title,completedAt,...(series?{series}:{})});
const series=(id,nodeIndex)=>({id,mark:'旅迹·'+id.slice(-4),nodeIndex,total:3});
const journey=(id,summary)=>({id,mark:'旅迹·'+id.slice(-4),completed:3,phase:'completed',nextNode:null,...(summary?{summary}:{})});
const ready=(id,text)=>({id,mark:'旅迹·'+id.slice(-4),completed:3,total:3,phase:'completed',nextNode:null,summary:{status:'ready',text}});
const running=(id)=>({id,mark:'旅迹·'+id.slice(-4),completed:3,total:3,phase:'completed',nextNode:null,summary:{status:'running'}});

function album(initial){
  const dom=new JSDOM('<main id="root"></main>',{url:'https://local.test/'});const w=dom.window;
  w.HTMLElement.prototype.scrollIntoView=()=>{};
  const controller=new w.AbortController(),memo=new Map(),timers=[],owned=[],replies=new Map();
  let state=initial;
  const invoke=vi.fn(async(method,args=[])=>{
    if(method==='journey'){const reply=replies.get(args[0]);return reply?await reply():null;}
    return structuredClone(state);
  });
  const ctx={root:w.document.getElementById('root'),signal:controller.signal,
    memo:{get:(k,d)=>memo.has(k)?memo.get(k):d,set:(k,v)=>memo.set(k,v)},
    own:d=>{owned.push(d);return d;},
    interval:f=>{timers.push(f);return{dispose(){}};},timeout:()=>({dispose(){}}),
    ui:{confirm:vi.fn(async()=>true)},invoke,invokeBinary:vi.fn(async()=>new Blob(['image']))};
  const f={dom,ctx,root:ctx.root,timers,invoke,
    setState:s=>{state=s;},setReply:(id,reply)=>replies.set(id,reply),
    journeyCalls:()=>invoke.mock.calls.filter(c=>c[0]==='journey').map(c=>c[1][0]),
    otherCalls:names=>invoke.mock.calls.filter(c=>names.includes(c[0])).map(c=>[c[0],c[1]]),
    refresh:async()=>{await timers[0]();await settle();},
    dispose:()=>{controller.abort();owned.forEach(o=>o.dispose());dom.window.close();}};
  fixtures.push(f);return f;
}
const open=f=>[...f.root.querySelectorAll('button')].find(b=>b.textContent==='收起来');
const flip=f=>[...f.root.querySelectorAll('button')].find(b=>b.textContent==='翻到背面读信');
const retry=f=>[...f.root.querySelectorAll('button')].find(b=>b.textContent==='恢复总结文字');
const postcard=(f,title)=>f.root.querySelector('[aria-label="打开来信：'+title+'"]');
const section=f=>f.root.querySelector('.pc-summary');
const banner=f=>f.root.querySelector('.pc-journey-summary');

const A='7c1f0a3e-1111-4a11-9a11-aaaaaaaaaaaa',B='9d2e4b60-2222-4b22-9b22-bbbbbbbbbbbb';

it('全局是B的总结时，打开A的第三张只显示A；切到B只显示B',async()=>{
  const a3=card('trip-a3','A的第三张',1000,series(A,3)),b3=card('trip-b3','B的第三张',2000,series(B,3));
  const f=album({trip:null,cards:[a3,b3],minutes:120,generatorConnected:true,journey:journey(B,{status:'ready',text:'B 这趟的总结正文。'})});
  f.setReply(A,async()=>ready(A,'A 这趟的总结正文。'));
  await mountAlbum(f.ctx);await settle();
  postcard(f,'A的第三张').click();await settle();
  expect(section(f).textContent).toContain('A 这趟的总结正文。');
  expect(section(f).textContent).not.toContain('B 这趟的总结正文。');
  expect(f.journeyCalls()).toEqual([A]);
  postcard(f,'B的第三张').click();await settle();
  expect(section(f).textContent).toContain('B 这趟的总结正文。');
  expect(section(f).textContent).not.toContain('A 这趟的总结正文。');
  expect(f.journeyCalls()).toEqual([A]);
});

it('全局是B的running/failed/无summary时，A仍查自己的，不展示B的状态或恢复目标',async()=>{
  const states=[
    {name:'running',journey:journey(B,{status:'running'})},
    {name:'failed',journey:journey(B,{status:'failed',error:'B的文字服务超时'})},
    {name:'无summary',journey:journey(B,null)},
  ];
  for(const item of states){
    const a3=card('trip-a3','A的第三张',1000,series(A,3)),b3=card('trip-b3','B的第三张',2000,series(B,3));
    const f=album({trip:null,cards:[a3,b3],minutes:120,generatorConnected:true,journey:item.journey});
    f.setReply(A,async()=>ready(A,'A 这趟的总结正文。'));
    await mountAlbum(f.ctx);await settle();
    postcard(f,'A的第三张').click();await settle();
    expect(section(f).textContent,item.name).toContain('A 这趟的总结正文。');
    expect(section(f).textContent,item.name).not.toContain('B 这趟的总结正文。');
    expect(section(f).textContent,item.name).not.toContain('正在整理这段旅程');
    expect(section(f).textContent,item.name).not.toContain('B的文字服务超时');
    expect(retry(f),item.name).toBeFalsy();
    expect(f.journeyCalls(),item.name).toEqual([A]);
    f.dispose();fixtures=fixtures.filter(x=>x!==f);
  }
});

it('全局就是这一趟时直接用快照，不再查询；全局为空时按id查得到A',async()=>{
  const a3=card('trip-a3','A的第三张',1000,series(A,3));
  const same=album({trip:null,cards:[a3],minutes:120,generatorConnected:true,journey:journey(A,{status:'ready',text:'A 这趟的总结正文。'})});
  await mountAlbum(same.ctx);await settle();postcard(same,'A的第三张').click();await settle();
  expect(section(same).textContent).toContain('A 这趟的总结正文。');
  expect(same.journeyCalls()).toEqual([]);

  const none=album({trip:null,cards:[a3],minutes:120,generatorConnected:true,journey:null});
  none.setReply(A,async()=>ready(A,'A 这趟的总结正文。'));
  await mountAlbum(none.ctx);await settle();postcard(none,'A的第三张').click();await settle();
  expect(section(none).textContent).toContain('A 这趟的总结正文。');
  expect(none.journeyCalls()).toEqual([A]);
});

it('A的请求未回就切到B，随后A成功或失败都不污染B',async()=>{
  for(const outcome of ['resolve','reject']){
    const a3=card('trip-a3','A的第三张',1000,series(A,3)),b3=card('trip-b3','B的第三张',2000,series(B,3));
    const f=album({trip:null,cards:[a3,b3],minutes:120,generatorConnected:true,journey:journey(B,{status:'ready',text:'B 这趟的总结正文。'})});
    const pending=deferred();
    f.setReply(A,()=>pending.promise);
    await mountAlbum(f.ctx);await settle();
    postcard(f,'A的第三张').click();await flush();
    expect(section(f).textContent).toContain('正在读取');
    postcard(f,'B的第三张').click();await settle();
    expect(section(f).textContent).toContain('B 这趟的总结正文。');
    if(outcome==='resolve')pending.resolve(ready(A,'A 迟到的总结正文。'));
    else pending.reject(new Error('A 的迟到失败'));
    await settle();
    expect(section(f).textContent).toContain('B 这趟的总结正文。');
    expect(section(f).textContent).not.toContain('A 迟到的总结正文。');
    expect(section(f).textContent).not.toContain('A 的迟到失败');
    expect(f.root.querySelector('.pc-message').textContent).toBe('');
    f.dispose();fixtures=fixtures.filter(x=>x!==f);
  }
});

it('收起或卸载之后，迟到的成功与失败都不改DOM、不报错',async()=>{
  const a3=card('trip-a3','A的第三张',1000,series(A,3));
  const collapsed=album({trip:null,cards:[a3],minutes:120,generatorConnected:true,journey:journey(B,{status:'ready',text:'B 这趟的总结正文。'})});
  const first=deferred();collapsed.setReply(A,()=>first.promise);
  await mountAlbum(collapsed.ctx);await settle();
  postcard(collapsed,'A的第三张').click();await flush();
  open(collapsed).click();await settle();
  expect(collapsed.root.querySelector('.pc-detail').hidden).toBe(true);
  first.resolve(ready(A,'A 迟到的总结正文。'));await settle();
  expect(collapsed.root.textContent).not.toContain('A 迟到的总结正文。');
  expect(collapsed.root.querySelector('.pc-message').textContent).toBe('');

  const unmounted=album({trip:null,cards:[a3],minutes:120,generatorConnected:true,journey:journey(B,{status:'ready',text:'B 这趟的总结正文。'})});
  const second=deferred();unmounted.setReply(A,()=>second.promise);
  await mountAlbum(unmounted.ctx);await settle();
  postcard(unmounted,'A的第三张').click();await flush();
  const before=unmounted.root.innerHTML;unmounted.dispose();fixtures=fixtures.filter(x=>x!==unmounted);
  second.reject(new Error('A 的迟到失败'));await settle();
  expect(unmounted.root.innerHTML).toBe(before);
});

it('A查不到时按原因给明确提示，任何一种都不显示B的正文',async()=>{
  const cases=[
    ['返回null',async()=>null,'没有找到这趟旅程的总结记录'],
    ['请求被拒绝',async()=>{throw new Error('旅行册暂时读不到这段旅程');},'旅行册暂时读不到这段旅程'],
    ['返回别的旅程',async()=>ready(B,'B 这趟的总结正文。'),'不属于这趟旅程'],
    ['ready但空正文',async()=>ready(A,'   '),'总结还是空的'],
  ];
  for(const [name,reply,hint] of cases){
    const a3=card('trip-a3','A的第三张',1000,series(A,3));
    const f=album({trip:null,cards:[a3],minutes:120,generatorConnected:true,journey:journey(B,{status:'ready',text:'B 这趟的总结正文。'})});
    f.setReply(A,reply);
    await mountAlbum(f.ctx);await settle();postcard(f,'A的第三张').click();await settle();
    expect(section(f).textContent,name).toContain(hint);
    expect(section(f).textContent,name).not.toContain('B 这趟的总结正文。');
    f.dispose();fixtures=fixtures.filter(x=>x!==f);
  }
});

it('cards不变时总结running→ready→failed，详情与横幅都跟上',async()=>{
  const a3=card('trip-a3','A的第三张',1000,series(A,3));
  const f=album({trip:null,cards:[a3],minutes:120,generatorConnected:true,journey:running(A)});
  await mountAlbum(f.ctx);await settle();
  postcard(f,'A的第三张').click();await settle();
  expect(section(f).textContent).toContain('正在整理这段旅程');

  f.setState({trip:null,cards:[a3],minutes:120,generatorConnected:true,journey:journey(A,{status:'ready',text:'整理完成的这趟总结。'})});
  await f.refresh();
  expect(section(f).textContent).toContain('整理完成的这趟总结。');
  expect(banner(f).hidden).toBe(false);
  expect(banner(f).textContent).toContain('整理完成的这趟总结。');

  f.setState({trip:null,cards:[a3],minutes:120,generatorConnected:true,journey:journey(A,{status:'failed',error:'文字服务返回429'})});
  await f.refresh();
  expect(section(f).textContent).toContain('总结尚未完成：文字服务返回429');
  expect(banner(f).hidden).toBe(true);
});

it('无变化轮询不重置翻面、不重取图片或总结；全局旅程换人也不改已选卡归属',async()=>{
  const a3=card('trip-a3','A的第三张',1000,series(A,3)),b3=card('trip-b3','B的第三张',2000,series(B,3));
  const f=album({trip:null,cards:[a3,b3],minutes:120,generatorConnected:true,journey:journey(B,{status:'ready',text:'B 这趟的总结正文。'})});
  f.setReply(A,async()=>ready(A,'A 这趟的总结正文。'));
  await mountAlbum(f.ctx);await settle();
  postcard(f,'A的第三张').click();await settle();
  flip(f).click();await settle();
  expect(f.root.querySelector('.pc-letter-back')).not.toBeNull();
  const images=f.ctx.invokeBinary.mock.calls.filter(c=>c[0]==='image').length;
  const queries=f.journeyCalls().length;
  for(let i=0;i<5;i++)await f.refresh();
  expect(f.root.querySelector('.pc-letter-back')).not.toBeNull();
  expect(f.ctx.invokeBinary.mock.calls.filter(c=>c[0]==='image').length).toBe(images);
  expect(f.journeyCalls().length).toBe(queries);

  f.setState({trip:null,cards:[a3,b3],minutes:120,generatorConnected:true,journey:journey(A,{status:'ready',text:'A 这趟的总结正文。'})});
  await f.refresh();
  expect(section(f).textContent).toContain('A 这趟的总结正文。');
  expect(f.root.querySelector('.pc-letter-back')).not.toBeNull();
});

it('短途与前两张卡不出现总结区，阅读不触发生成或恢复',async()=>{
  const short=card('trip-short','短途一张',3000);
  const first=card('trip-a1','A的第一张',1000,series(A,1));
  const second=card('trip-a2','A的第二张',2000,series(A,2));
  const f=album({trip:null,cards:[short,first,second],minutes:120,generatorConnected:true,journey:journey(A,{status:'ready',text:'A 这趟的总结正文。'})});
  await mountAlbum(f.ctx);await settle();
  for(const title of ['短途一张','A的第一张','A的第二张']){
    postcard(f,title).click();await settle();
    expect(section(f),title).toBeNull();
  }
  expect(f.journeyCalls()).toEqual([]);
  expect(f.otherCalls(['start','startShort','retry','retrySummary'])).toEqual([]);
});

it('历史failed的恢复只针对那趟旅程，取消确认则不调用',async()=>{
  const a3=card('trip-a3','A的第三张',1000,series(A,3)),b3=card('trip-b3','B的第三张',2000,series(B,3));
  const f=album({trip:null,cards:[a3,b3],minutes:120,generatorConnected:true,journey:journey(B,{status:'ready',text:'B 这趟的总结正文。'})});
  f.setReply(A,async()=>journey(A,{status:'failed',error:'文字服务超时'}));
  await mountAlbum(f.ctx);await settle();postcard(f,'A的第三张').click();await settle();
  expect(section(f).textContent).toContain('总结尚未完成：文字服务超时');
  retry(f).click();await settle();
  expect(f.otherCalls(['retrySummary'])).toEqual([['retrySummary',[A]]]);

  const canceled=album({trip:null,cards:[a3],minutes:120,generatorConnected:true,journey:journey(B,{status:'ready',text:'B 这趟的总结正文。'})});
  canceled.setReply(A,async()=>journey(A,{status:'failed',error:'文字服务超时'}));
  canceled.ctx.ui.confirm.mockResolvedValue(false);
  await mountAlbum(canceled.ctx);await settle();postcard(canceled,'A的第三张').click();await settle();
  retry(canceled).click();await settle();
  expect(canceled.otherCalls(['retrySummary','retry'])).toEqual([]);
});
