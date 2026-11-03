import {mountSetup} from '../webui/setup.ts';
import {it,expect,vi,afterEach} from 'vitest';
import {JSDOM} from 'jsdom';
import {mountAlbum} from '../webui/client.ts';
let fixtures=[];
function fixture(cards=[]){
  const dom=new JSDOM('<main id="root"></main>',{url:'https://local.test/'});const w=dom.window;w.HTMLElement.prototype.scrollIntoView=()=>{};
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
it('开发5分钟的初始和续行文案都取服务时长，不残留固定2小时',async()=>{
 const f=fixture();f.setState({trip:null,cards:[],minutes:5,generatorConnected:true});await mountAlbum(f.ctx);await flush();expect(f.ctx.root.textContent).toContain('开发测试等待5分钟');expect(f.ctx.root.textContent).not.toContain('2 小时');
 f.setState({trip:null,cards:[],minutes:5,generatorConnected:true,journey:{id:'dev',mark:'测试',phase:'waiting_continue',completed:1,nextNode:2}});f.timers.forEach(fn=>fn());await flush();expect(f.ctx.root.textContent).toContain('继续长途 · 第2/3张 · 5分钟');expect(f.ctx.root.textContent).not.toContain('仍等2小时');
});
it('系列仍时间平铺，旅程印章标出共同标识与序号；等待继续必须点新一轮按钮',async()=>{
 const a={...card('a','forest'),series:{id:'journey-a',mark:'旅迹·abcd',nodeIndex:1,total:3}},f=fixture([a]);
 f.setState({trip:null,cards:[a],minutes:120,generatorConnected:true,journey:{id:'journey-a',mark:'旅迹·abcd',phase:'waiting_continue',completed:1,nextNode:2}});
 await mountAlbum(f.ctx);await flush();expect(f.ctx.root.querySelectorAll('.pc-grid')).toHaveLength(1);const seal=f.ctx.root.querySelector('.pc-seal');expect(seal).not.toBeNull();expect(seal.getAttribute('title')).toContain('旅迹·abcd · 第1/3张');expect(seal.textContent).toContain('1/3');
 expect(f.ctx.root.querySelector('.pc-card-footer').textContent).not.toContain('1/3');
 expect(f.ctx.invoke.mock.calls.some(c=>c[0]==='start')).toBe(false);const next=[...f.ctx.root.querySelectorAll('button')].find(b=>b.textContent==='继续长途 · 第2/3张');expect(next).toBeDefined();next.click();await flush();expect(f.ctx.invoke.mock.calls.some(c=>c[0]==='start')).toBe(false);[...f.ctx.root.querySelectorAll('button')].find(b=>b.textContent==='开始旅行').click();await flush();expect(f.ctx.invoke).toHaveBeenCalledWith('start',[]);
});
it('每趟长途的印章按旅程 id 区分，第二章后明确提示最后一张附总结',async()=>{
 const a={...card('a','forest'),completedAt:1000,series:{id:'journey-a',mark:'旅迹·aaaa',nodeIndex:1,total:3}},b={...card('b','coast'),completedAt:2000,series:{id:'journey-b',mark:'旅迹·bbbb',nodeIndex:2,total:3}},f=fixture([a,b]);
 f.setState({trip:null,cards:[a,b],minutes:120,generatorConnected:true,journey:{id:'journey-b',mark:'旅迹·bbbb',phase:'waiting_continue',completed:2,nextNode:3}});
 await mountAlbum(f.ctx);await flush();const seals=[...f.ctx.root.querySelectorAll('.pc-seal')];expect(seals).toHaveLength(2);const styles=seals.map(s=>[s.style.getPropertyValue('--pc-seal-hue'),s.style.getPropertyValue('--pc-seal-rotate')]);expect(styles[0].join('|')).not.toBe(styles[1].join('|'));expect(f.ctx.root.textContent).toContain('下一张是三张里的最后一张');
});
it('第三张卡面标注含总结，收藏册给出总结入口，打开即见总结且不触发生成',async()=>{
 vi.spyOn(URL,'createObjectURL').mockReturnValue('blob:test');vi.spyOn(URL,'revokeObjectURL').mockImplementation(()=>{});
 const c={...card('last','forest'),series:{id:'journey-last',mark:'旅迹·last',nodeIndex:3,total:3}},f=fixture([c]);
 f.setState({trip:null,cards:[c],minutes:120,generatorConnected:true,journey:{id:'journey-last',mark:'旅迹·last',phase:'completed',completed:3,nextNode:null,summary:{status:'ready',text:'三个节点已见过的小事。'}}});
 await mountAlbum(f.ctx);await flush();expect(f.ctx.root.querySelector('.pc-summary-tag').textContent).toContain('含这趟总结');const bar=f.ctx.root.querySelector('.pc-journey-summary');expect(bar).not.toBeNull();expect(bar.textContent).toContain('这趟的总结笔记');
 [...f.ctx.root.querySelectorAll('button')].find(b=>b.textContent==='读这趟的总结').click();await flush();await flush();
 expect(f.ctx.root.querySelector('.pc-summary').textContent).toContain('三个节点已见过的小事');expect(f.ctx.invoke.mock.calls.some(c=>['start','retry','markRead','journey'].includes(c[0]))).toBe(false);
});
it('收到图片数据不提前清未读，实际显示图片或翻面读信才确认',async()=>{
 vi.spyOn(URL,'createObjectURL').mockReturnValue('blob:test');vi.spyOn(URL,'revokeObjectURL').mockImplementation(()=>{});
 const unread={...card('a','forest'),unread:true};const f=fixture([unread]);
 const state={trip:null,cards:[unread],minutes:120,generatorConnected:true,mailbox:{unreadCount:1}};f.setState(state);
 const invoke=f.ctx.invoke.getMockImplementation();f.ctx.invoke.mockImplementation(async(method,args)=>{if(method==='markRead')f.setState({...state,cards:[{...unread,unread:false}],mailbox:{unreadCount:0}});return invoke(method,args);});
 await mountAlbum(f.ctx);await flush();expect(f.ctx.root.textContent).toContain('1 封未读');f.ctx.root.querySelector('.pc-postcard').click();await flush();
 expect(f.ctx.invoke.mock.calls.some(c=>c[0]==='markRead')).toBe(false);
 [...f.ctx.root.querySelectorAll('button')].find(b=>b.textContent==='翻到背面读信').click();await flush();await flush();
 expect(f.ctx.invoke).toHaveBeenCalledWith('markRead',['a']);expect(f.ctx.root.textContent).not.toContain('1 封未读');
});
afterEach(()=>{fixtures.forEach(f=>f.dispose());fixtures=[];vi.restoreAllMocks();});
it('空态、出发、等待和取消通过标准invoke调用',async()=>{
  const f=fixture();await mountAlbum(f.ctx);expect(f.ctx.root.textContent).toContain('第一封来信');
  const b=[...f.ctx.root.querySelectorAll('button')].find(b=>b.textContent==='长途 · 3×2小时');b.click();await flush();[...f.ctx.root.querySelectorAll('button')].find(b=>b.textContent==='开始旅行').click();await flush();
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

it('配置引导解释当前设置，密钥输入保存后清空且不缓存',async()=>{
 const f=fixture();f.ctx.invoke.mockImplementation(async(method)=>method==='snapshot'?{keys:{ark:false,vision:false},secureSaveAvailable:true,cloudEnabled:false,characterReference:'',styleReference:''}:{keys:{ark:true,vision:false}});
 await mountSetup(f.ctx);expect(f.ctx.root.querySelectorAll('dt').length).toBeGreaterThanOrEqual(15);expect(f.ctx.root.textContent).toContain('不调用 API');
 const input=f.ctx.root.querySelector('input');expect(input.type).toBe('password');input.value='mock-only-key';[...f.ctx.root.querySelectorAll('button')].find(b=>b.textContent==='保存此服务密钥').click();await flush();expect(input.value).toBe('');expect(f.memo.size).toBe(0);expect(f.ctx.root.textContent).not.toContain('mock-only-key');
});

it('旅行进度按保存的起止时间计算，制作阶段不冒充已收到',async()=>{
 const f=fixture();vi.spyOn(Date,'now').mockReturnValue(3600000);
 f.setState({trip:{id:'progress',scene:'forest',status:'traveling',startedAt:0,dueAt:7200000},cards:[],minutes:120,generatorConnected:true});await mountAlbum(f.ctx);
 expect(f.ctx.root.querySelector('progress').value).toBe(50);expect(f.ctx.root.textContent).toContain('约 60 分钟');
 Date.now.mockReturnValue(-100);f.timers[1]();expect(f.ctx.root.querySelector('progress').value).toBe(0);
 Date.now.mockReturnValue(7200000);f.setState({trip:{id:'progress',scene:'forest',status:'generating',startedAt:0,dueAt:7200000},cards:[],minutes:120,generatorConnected:true});await f.timers[0]();await flush();expect(f.ctx.root.querySelector('progress').value).toBe(100);expect(f.ctx.root.textContent).toContain('来信仍在整理');expect(f.ctx.root.textContent).not.toContain('已收到');
});

it('内置三服饰展示并通过标准配置接口选择，保留自定义入口',async()=>{
 vi.spyOn(URL,'createObjectURL').mockReturnValue('blob:preset');vi.spyOn(URL,'revokeObjectURL').mockImplementation(()=>{});
 const f=fixture();f.ctx.setConfig=vi.fn(async()=> 'saved');f.ctx.invoke.mockResolvedValue({presets:[{id:'maid',label:'女仆装'},{id:'winter',label:'冬装'},{id:'crew',label:'店员装'}],characterPreset:'auto',keys:{ark:false,vision:false},secureSaveAvailable:true,characterReference:'',styleReference:''});await mountSetup(f.ctx);expect(f.ctx.root.querySelectorAll('.pc-presets img')).toHaveLength(3);[...f.ctx.root.querySelectorAll('button')].find(b=>b.textContent==='店员装').click();await flush();expect(f.ctx.setConfig).toHaveBeenCalledWith('world:postcard',{'worlds.postcard.characterPreset':'crew'});expect(f.ctx.root.textContent).toContain('当前角色：店员装');expect(f.ctx.root.textContent).toContain('选择角色参考 PNG');
});

it('新引导仅配置生图、展示本地接口与费用，上传图和三内置图并列选择',async()=>{
 vi.spyOn(URL,'createObjectURL').mockReturnValue('blob:ref');vi.spyOn(URL,'revokeObjectURL').mockImplementation(()=>{});const f=fixture();f.ctx.setConfig=vi.fn(async()=> 'saved');
 f.ctx.invoke.mockResolvedValue({presets:[{id:'maid',label:'女仆装'},{id:'winter',label:'冬装'},{id:'crew',label:'店员装'}],customReferences:[{id:'custom:abc',label:'我的兔子',path:'C:/imports/rabbit.png'}],characterPreset:'winter',keys:{ark:false,compatible:false},secureSaveAvailable:true,useHostModel:true,cloudEnabled:true,characterReference:'',styleReference:''});
 await mountSetup(f.ctx);expect(f.ctx.root.textContent).not.toContain('DeepSeek');expect(f.ctx.root.textContent).toContain('¥0.12');expect(f.ctx.root.querySelectorAll('input[type="password"]')).toHaveLength(1);expect(f.ctx.root.querySelectorAll('.pc-presets img')).toHaveLength(4);[...f.ctx.root.querySelectorAll('button')].find(b=>b.textContent==='我的兔子').click();await flush();expect(f.ctx.setConfig).toHaveBeenCalledWith('world:postcard',{'worlds.postcard.characterPreset':'custom','worlds.postcard.characterReference':'C:/imports/rabbit.png'});expect(f.ctx.root.querySelector('input[aria-label="生图 API 请求地址"]')).not.toBeNull();expect(f.ctx.root.textContent).toContain('交给你的Agent');
});

it('邮箱按钮随实际窗口状态切换，忙碌中不能重复提交',async()=>{
 const f=fixture();let phase='running',resolve;
 const state=()=>({trip:null,cards:[],minutes:120,generatorConnected:true,mailboxWindow:{phase,detail:phase}});
 f.ctx.invoke.mockImplementation(async method=>{if(method==='closeMailbox')await new Promise(r=>resolve=r);if(method==='closeMailbox')phase='closed';if(method==='openMailbox')phase='running';return state();});
 await mountAlbum(f.ctx);
 const find=text=>[...f.ctx.root.querySelectorAll('button')].find(b=>b.textContent===text);
 find('关闭桌面邮箱').click();expect(find('关闭桌面邮箱').disabled).toBe(true);find('关闭桌面邮箱').click();
 expect(f.ctx.invoke.mock.calls.filter(c=>c[0]==='closeMailbox')).toHaveLength(1);
 resolve();await flush();find('显示桌面邮箱').click();await flush();expect(find('关闭桌面邮箱')).toBeTruthy();
 expect(f.ctx.invoke).toHaveBeenCalledWith('openMailbox',[]);
 phase='closed';await f.timers[0]();await flush();expect(find('显示桌面邮箱')).toBeTruthy();
});

it('配置引导说明复制来源，按服务切换帮助，推荐预填不自动保存或调用生图',async()=>{
 const f=fixture();f.ctx.setConfig=vi.fn();f.ctx.invoke.mockResolvedValue({imageBackend:'compatible',imageModel:'my-model',imageBaseUrl:'https://custom.example/v1/images/generations',keys:{ark:false},presets:[]});await mountSetup(f.ctx);
 const doc=f.ctx.root.ownerDocument,model=doc.querySelector('input[aria-label="服务商提供的模型名称或接入点 ID"]'),endpoint=doc.querySelector('input[aria-label="生图 API 请求地址"]');
 expect(model.value).toBe('my-model');expect(endpoint.value).toContain('/images/generations');expect(f.ctx.root.textContent).toContain('复制 model 字段的值');expect(f.ctx.root.querySelector('pre').textContent).toContain('POST https://api.example.com');
 const prompt=f.ctx.root.querySelector('textarea');expect(prompt.readOnly).toBe(true);expect(prompt.value).toContain('请求和响应JSON示例');expect(prompt.value).not.toContain('my-model');
 const backend=f.ctx.root.querySelector('select');backend.value='ark';backend.dispatchEvent(new f.dom.window.Event('change'));const preset=[...f.ctx.root.querySelectorAll('button')].find(b=>b.textContent==='填入推荐的方舟 Flash 配置');expect(preset.hidden).toBe(false);preset.click();await flush();expect(model.value).toBe('doubao-seedream-5-0-flash-260915');expect(endpoint.value).toBe('https://custom.example/v1/images/generations');expect(f.ctx.setConfig).not.toHaveBeenCalled();expect(f.ctx.invoke.mock.calls.every(c=>['snapshot','verification','restartStatus'].includes(c[0]))).toBe(true);
});

it('禁用出发显示原因，前往验证定位第5步，不自动启动付费验证',async()=>{
 const f=fixture();f.setState({trip:null,cards:[],minutes:120,generatorConnected:true,readyForTravel:false});await mountAlbum(f.ctx);
 const start=[...f.ctx.root.querySelectorAll('button')].find(b=>b.textContent==='长途 · 3×2小时');expect(start.disabled).toBe(true);expect(f.ctx.root.textContent).toContain('配置已更改，请先验证明信片制作');expect(start.getAttribute('aria-describedby').split(' ')).toContain('pc-start-disabled-reason');
 const link=f.ctx.root.querySelector('.pc-start-blocked a');expect(link.getAttribute('href')).toBe('#/provider/world%3Apostcard/setup');link.click();expect(f.dom.window.sessionStorage.getItem('postcard:focus-verification')).toBe('1');
 f.ctx.root.replaceChildren();f.ctx.invoke.mockImplementation(async method=>method==='verification'?{phase:'required'}:{keys:{ark:false},presets:[]});const scroll=vi.spyOn(f.dom.window.HTMLElement.prototype,'scrollIntoView');await mountSetup(f.ctx);expect(scroll).toHaveBeenCalled();expect(f.dom.window.document.activeElement.id).toBe('pc-setup-step-5');expect(f.dom.window.sessionStorage.getItem('postcard:focus-verification')).toBeNull();expect(f.ctx.invoke.mock.calls.some(c=>c[0]==='verify'||c[0]==='start')).toBe(false);
});

it('制作验证失败呈现步骤、原因、建议与错误编号，不再只显示尚未通过',async()=>{
 const f=fixture();f.ctx.invoke.mockImplementation(async method=>method==='verification'?{phase:'failed',failedAt:1700000000000,failure:{diagnosticId:'gemini-11111111-1111-1111-1111-111111111111',code:'HTTP_401',stage:'生图服务生成图片',reason:'服务身份验证失败',advice:'检查当前失败步骤对应服务的API Key是否正确'}}:{keys:{ark:false},presets:[]});await mountSetup(f.ctx);const status=f.ctx.root.querySelector('.pc-verification-status');expect(status.dataset.state).toBe('failed');expect(status.textContent).toContain('失败步骤：生图服务生成图片');expect(status.textContent).toContain('原因：服务身份验证失败');expect(status.textContent).toContain('处理建议：检查');expect(status.textContent).toContain('错误编号：HTTP_401');expect(status.textContent).toContain('postcard/diagnostics/gemini-11111111-1111-1111-1111-111111111111/summary.json');expect(status.textContent).toContain('重新验证可能再次计费');expect(f.ctx.invoke.mock.calls.some(c=>c[0]==='verify')).toBe(false);
});

it('保存后显示重启提示，不自动重启或验证；诊断显示未应用模型',async()=>{
 const f=fixture();let pending=false;f.ctx.setConfig=vi.fn(async()=> 'saved');f.ctx.invoke.mockImplementation(async method=>{if(method==='settingsSaved')pending=true;if(method==='restartStatus')return {required:pending,supported:true,appliedModel:'old-image',savedModel:'new-image'};if(method==='verification')return {phase:pending?'restart_required':'required',appliedModel:'old-image',savedModel:'new-image'};return {keys:{ark:false},presets:[]};});await mountSetup(f.ctx);
 [...f.ctx.root.querySelectorAll('button')].find(b=>b.textContent==='保存生图模型与接口').click();await flush();await flush();expect(f.ctx.root.querySelector('.pc-restart-needed').hidden).toBe(false);expect(f.ctx.root.textContent).toContain('当前生成器：old-image；已保存模型：new-image');expect(f.ctx.invoke.mock.calls.some(c=>c[0]==='restart'||c[0]==='verify')).toBe(false);
 f.timers.forEach(fn=>fn());await flush();expect(f.ctx.root.querySelector('.pc-verification-status').textContent).toContain('配置已保存但尚未应用');
});

it('千问与Gemini预填原生配置，不自动保存、不调用付费验证',async()=>{
 const f=fixture();f.ctx.setConfig=vi.fn();f.ctx.invoke.mockResolvedValue({imageBackend:'ark',keys:{ark:false},presets:[]});await mountSetup(f.ctx);
 const d=f.ctx.root,backend=d.querySelector('[aria-label="生图服务"]');expect([...backend.options].map(o=>o.value)).toEqual(['ark','qwen','gemini','compatible']);
 const click=text=>[...d.querySelectorAll('button')].find(b=>b.textContent===text).click();
 backend.value='qwen';backend.dispatchEvent(new f.dom.window.Event('change'));click('填入所选服务的推荐配置');await flush();expect(d.querySelector('[aria-label="服务商提供的模型名称或接入点 ID"]').value).toBe('qwen-image-2.0');expect(d.querySelector('[aria-label="兼容接口出图尺寸"]').value).toBe('1024*1536');
 backend.value='gemini';backend.dispatchEvent(new f.dom.window.Event('change'));click('填入所选服务的推荐配置');await flush();expect(d.querySelector('[aria-label="生图 API 请求地址"]').value).toBe('https://generativelanguage.googleapis.com/v1beta');expect(d.querySelector('[aria-label="兼容接口出图尺寸"]').value).toBe('2K');expect(f.ctx.setConfig).not.toHaveBeenCalled();expect(f.ctx.invoke.mock.calls.some(c=>c[0]==='verify')).toBe(false);
});


it('trip mode buttons only select; only the separate start button dispatches the selected trip',async()=>{
 const f=fixture();f.setState({trip:null,cards:[],minutes:120,generatorConnected:true,readyForTravel:true});await mountAlbum(f.ctx);
 const button=text=>[...f.ctx.root.querySelectorAll('button')].find(b=>b.textContent===text);
 expect(button('开始旅行').disabled).toBe(true);
 button('短途 · 2小时 · 一张卡').click();await flush();expect(button('短途 · 2小时 · 一张卡').getAttribute('aria-pressed')).toBe('true');
 button('长途 · 3×2小时').click();await flush();expect(button('长途 · 3×2小时').getAttribute('aria-pressed')).toBe('true');expect(button('短途 · 2小时 · 一张卡').getAttribute('aria-pressed')).toBe('false');
 button('短途 · 2小时 · 一张卡').click();await flush();expect(f.ctx.invoke.mock.calls.some(c=>c[0]==='start'||c[0]==='startShort')).toBe(false);
 button('开始旅行').click();await flush();expect(f.ctx.invoke).toHaveBeenCalledWith('startShort',[]);expect(f.ctx.invoke.mock.calls.filter(c=>c[0]==='startShort')).toHaveLength(1);
});


