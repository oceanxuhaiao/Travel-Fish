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
