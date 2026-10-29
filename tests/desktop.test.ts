import {it,expect,vi,afterEach} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
const script=readFileSync(new URL('../desktop/mailbox.js',import.meta.url),'utf8');
const fixtures:JSDOM[]=[];
const flush=()=>new Promise(r=>setImmediate(r));
afterEach(()=>{for(const dom of fixtures)dom.window.close();fixtures.length=0;});
function letter(automatic:boolean){const dom=new JSDOM('<main id="root"></main>',{url:'https://local.test/#letter=00000000-0000-0000-0000-000000000001'+(automatic?'&preview=1':''),runScripts:'outside-only'});fixtures.push(dom);const api={call:vi.fn(async(action:string)=>action==='read'?{title:'已保存的信',note:'一段短笺',imageBase64:'AA=='}:{})};(dom.window as any).postcard=api;dom.window.eval(script);return {dom,api};}
it('自动演出预览即使图片载入也保持未读，用户明确收下才确认',async()=>{
 const {dom,api}=letter(true);await flush();const doc=dom.window.document;doc.querySelector('img')!.dispatchEvent(new dom.window.Event('load'));await flush();expect(api.call.mock.calls.some(c=>c[0]==='mark-read')).toBe(false);
 [...doc.querySelectorAll('button')].find(b=>b.textContent==='收下这封信')!.click();await flush();expect(api.call.mock.calls.filter(c=>c[0]==='mark-read')).toHaveLength(1);
});
it('自动预览可翻面明确读信；用户手动打开则图片显示后确认',async()=>{
 const automatic=letter(true);await flush();[...automatic.dom.window.document.querySelectorAll('button')].find(b=>b.textContent==='翻面读信')!.click();await flush();expect(automatic.api.call.mock.calls.some(c=>c[0]==='mark-read')).toBe(true);
 const manual=letter(false);await flush();manual.dom.window.document.querySelector('img')!.dispatchEvent(new manual.dom.window.Event('load'));await flush();expect(manual.api.call.mock.calls.some(c=>c[0]==='mark-read')).toBe(true);
});
it('看开盖可手动重复，只有视觉动画，不催促模型、不提交到达、不清未读',async()=>{
 const dom=new JSDOM('<main id="root"></main>',{url:'https://local.test/',runScripts:'outside-only'});fixtures.push(dom);const timers:Array<()=>unknown>=[];
 const state={phase:'mail_waiting',trip:null,height:120,cards:[{tripId:'00000000-0000-0000-0000-000000000001',unread:true}],unreadCount:1,pickup:{active:null,pending:[]}};
 const api={rects:vi.fn(),call:vi.fn(async(action:string)=>action==='state'?state:{imageBase64:'AA=='})};
 (dom.window as any).postcard=api;(dom.window as any).ResizeObserver=class{observe(){}};(dom.window as any).setInterval=()=>1;(dom.window as any).setTimeout=(f:()=>unknown)=>{timers.push(f);return timers.length;};
 dom.window.eval(script);await flush();const preview=[...dom.window.document.querySelectorAll('button')].find(b=>b.textContent==='看开盖')!;preview.click();await flush();await flush();expect(dom.window.document.querySelector('.opening')).not.toBeNull();
 await timers[0]();await flush();preview.click();await flush();await flush();expect(timers).toHaveLength(2);
 expect(api.call.mock.calls.some(c=>['pickup-request','presentation-done','mark-read','open-letter'].includes(c[0]))).toBe(false);
});

it.each([true,false])('点击邮箱请求桌宠取信（未读=%s），不直接打开来信或播放动画',async(unread)=>{
 const dom=new JSDOM('<main id="root"></main>',{url:'https://local.test/',runScripts:'outside-only'});fixtures.push(dom);
 const id='00000000-0000-0000-0000-000000000001';const state={phase:'mail_waiting',trip:null,cards:[{tripId:id,unread}],unreadCount:unread?1:0,pickup:{active:null,pending:[id]}};
 const api={rects:vi.fn(),call:vi.fn(async(action:string)=>action==='state'?state:{})};
 (dom.window as any).postcard=api;(dom.window as any).ResizeObserver=class{observe(){}};(dom.window as any).setInterval=()=>1;
 dom.window.eval(script);await flush();expect(api.call.mock.calls.some(c=>c[0]==='pickup-request')).toBe(false);
 (dom.window.document.getElementById('mail') as HTMLButtonElement).click();await flush();await flush();
 expect(api.call).toHaveBeenCalledWith('pickup-request',id);expect(api.call.mock.calls.some(c=>['open-letter','presentation-done','mark-read'].includes(c[0]))).toBe(false);expect(dom.window.document.querySelector('.opening')).toBeNull();
});

it.each([[false,0,true],[false,1,true],[true,0,false]])('气泡显示按开发模式=%s及未读=%s决定',async(debug,unread,hidden)=>{
 const dom=new JSDOM('<main id="root"></main>',{url:'https://local.test/'+(debug?'#debug=1':''),runScripts:'outside-only'});fixtures.push(dom);
 const state={phase:'idle',trip:null,cards:[{tripId:'00000000-0000-0000-0000-000000000001',unread:!!unread}],unreadCount:unread,pickup:{active:null,pending:[]}};
 const api={rects:vi.fn(),call:vi.fn(async(action:string)=>action==='state'?state:{})};(dom.window as any).postcard=api;(dom.window as any).ResizeObserver=class{observe(){}};(dom.window as any).setInterval=()=>1;
 dom.window.eval(script);await flush();const doc=dom.window.document;expect((doc.querySelector('.status') as HTMLElement).hidden).toBe(hidden);expect((doc.querySelector('.buttons') as HTMLElement).hidden).toBe(!debug);
 const mail=doc.getElementById('mail')!;mail.dispatchEvent(new dom.window.Event('pointerenter'));expect((doc.querySelector('.status') as HTMLElement).hidden).toBe(false);mail.dispatchEvent(new dom.window.Event('pointerleave'));expect((doc.querySelector('.status') as HTMLElement).hidden).toBe(hidden);const pointer=(type:string,x:number)=>{const event=new dom.window.Event(type);Object.assign(event,{button:0,pointerId:1,clientX:x,clientY:10});mail.dispatchEvent(event);};pointer('pointerdown',10);pointer('pointermove',30);pointer('pointerup',30);mail.click();await flush();
 expect(api.call.mock.calls.some(c=>c[0]==='drag-move')).toBe(true);expect(api.call.mock.calls.some(c=>c[0]==='pickup-request')).toBe(false);
});

it.each(['requested','open_local','cooldown','error'])('100次前端连点合并一次IPC，结果%s处理正确且失败后可重试',async(kind)=>{
 const dom=new JSDOM('<main id="root"></main>',{url:'https://local.test/',runScripts:'outside-only'});fixtures.push(dom);const id='00000000-0000-0000-0000-000000000001',state={phase:'idle',trip:null,cards:[{tripId:id,unread:true}],unreadCount:1,pickup:{active:null,pending:[id]}};
 let release!:()=>void;const gate=new Promise<void>(r=>{release=r;});const api={rects:vi.fn(),call:vi.fn(async(action:string)=>{if(action==='state')return state;if(action==='pickup-request'){await gate;if(kind==='error')throw Error('network');return {kind};}return {};})};
 (dom.window as any).postcard=api;(dom.window as any).ResizeObserver=class{observe(){}};(dom.window as any).setInterval=()=>1;dom.window.eval(script);await flush();const mail=dom.window.document.getElementById('mail')!;for(let i=0;i<100;i++)mail.click();await flush();expect(api.call.mock.calls.filter(c=>c[0]==='pickup-request')).toHaveLength(1);release();await flush();await flush();expect(api.call.mock.calls.filter(c=>c[0]==='open-letter')).toHaveLength(kind==='open_local'?1:0);
 if(kind==='error'){mail.click();await flush();await flush();expect(api.call.mock.calls.filter(c=>c[0]==='pickup-request')).toHaveLength(2);}
});

it('正式提示悬停可见、离开隐藏，点击显示五秒，不因未读或旅行常驻',async()=>{
 const dom=new JSDOM('<main id="root"></main>',{url:'https://local.test/',runScripts:'outside-only'});fixtures.push(dom);let now=1000;const timers:Array<()=>void>=[];
 const state={phase:'traveling',trip:{startedAt:0,dueAt:7200000},cards:[],unreadCount:1,pickup:{active:null,pending:[]}};
 const api={rects:vi.fn(),call:vi.fn(async(action:string)=>action==='state'?state:{})};(dom.window as any).postcard=api;(dom.window as any).ResizeObserver=class{observe(){}};(dom.window as any).setInterval=(fn:()=>void)=>{timers.push(fn);return 1;};dom.window.Date.now=()=>now;
 dom.window.eval(script);await flush();const doc=dom.window.document,status=doc.querySelector('.status') as HTMLElement,mail=doc.getElementById('mail')!;
 expect(status.hidden).toBe(true);mail.dispatchEvent(new dom.window.Event('pointerenter'));expect(status.hidden).toBe(false);mail.dispatchEvent(new dom.window.Event('pointerleave'));expect(status.hidden).toBe(true);
 mail.click();await flush();expect(status.hidden).toBe(false);now+=5001;timers[1]();expect(status.hidden).toBe(true);expect(api.call.mock.calls.some(c=>c[0]==='pickup-request')).toBe(false);
});
