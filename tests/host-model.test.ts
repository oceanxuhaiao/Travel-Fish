import {it,expect,vi,afterEach,beforeEach} from 'vitest';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {HostModelBridge} from '../src/host-model.ts';import {FakeHost} from './helpers/fake-host.ts';
import {decisionContract} from '../src/model-feedback.ts';
let root:string;beforeEach(()=>{root=mkdtempSync(join(tmpdir(),'postcard-host-'));});afterEach(()=>{vi.useRealTimers();rmSync(root,{recursive:true,force:true});});
const payload={model:'host-model',__postcardTask:{tripId:'one',label:'review'},messages:[{content:[{type:'text',text:'test'}]}]};
const attach=(b:HostModelBridge)=>{const h=new FakeHost();h.modelFacts.accepts=()=>true;b.attach(h);return h;};
const task=(h:FakeHost)=>String(h.events[0].text).match(/taskId=([a-f0-9]{64})/)![1];
it('主会话繁忙时等待工具提交，摘要/JSON/覆盖校验且同结果幂等',async()=>{
 vi.useFakeTimers();const b=new HostModelBridge(root,1000),h=attach(b),p=b.transport('text',payload,new AbortController().signal);await vi.advanceTimersByTimeAsync(500);const id=task(h);
 expect(()=>b.submit(id,'wrong','{}')).toThrow('摘要');expect(()=>b.submit(id,id,'[]')).toThrow('对象');b.submit(id,id,'{"ok":true}');expect(b.submit(id,id,'{"ok":true}')).toMatchObject({duplicate:true});expect(()=>b.submit(id,id,'{}')).toThrow('不同');await vi.advanceTimersByTimeAsync(100);expect((await p).model).toBe('host-model');
});
it('超时后拒绝迟到结果，重新激活同待办恢复，不改候选',async()=>{
 vi.useFakeTimers();const b=new HostModelBridge(root,100),h=attach(b);const p=b.transport('text',payload,new AbortController().signal);const checked=expect(p).rejects.toThrow('超时');await vi.advanceTimersByTimeAsync(110);await checked;const id=task(h);expect(()=>b.submit(id,id,'{}')).toThrow('超时');
 const next=new HostModelBridge(root,1000),h2=attach(next),p2=next.transport('text',payload,new AbortController().signal);await vi.advanceTimersByTimeAsync(1);expect(task(h2)).toBe(id);next.submit(id,id,'{"restored":true}');await vi.advanceTimersByTimeAsync(100);await p2;
 const third=new HostModelBridge(root),h3=attach(third);await third.transport('text',payload,new AbortController().signal);expect(h3.events).toHaveLength(0);
});
it('取消与停止后不接收迟到提交，主模型不支持图片则不派发',async()=>{
 vi.useFakeTimers();const b=new HostModelBridge(root,1000),h=attach(b),abort=new AbortController();const p=b.transport('text',payload,abort.signal);await vi.advanceTimersByTimeAsync(1);const id=task(h);abort.abort();expect(()=>b.submit(id,id,'{}')).toThrow();const checked=expect(p).rejects.toThrow();await vi.advanceTimersByTimeAsync(100);await checked;b.detach();
 const c=new HostModelBridge(root);c.attach(new FakeHost());await expect(c.transport('text',payload,new AbortController().signal)).rejects.toThrow('PNG');
});

it('宿主停止中断等待，重新实例化同任务可继续',async()=>{
 vi.useFakeTimers();const b=new HostModelBridge(root,1000),h=attach(b),p=b.transport('text',payload,new AbortController().signal);await vi.advanceTimersByTimeAsync(1);const id=task(h);b.detach();const checked=expect(p).rejects.toThrow('中断');await vi.advanceTimersByTimeAsync(100);await checked;expect(()=>b.submit(id,id,'{}')).toThrow();
 const next=new HostModelBridge(root,1000),h2=attach(next),p2=next.transport('text',payload,new AbortController().signal);await vi.advanceTimersByTimeAsync(1);expect(task(h2)).toBe(id);next.submit(id,id,'{"resumed":true}');await vi.advanceTimersByTimeAsync(100);await p2;
});

it('结构错误在submit立即返回反馈，不缓存为成功；同任务修正后才交给业务层',async()=>{
 vi.useFakeTimers();const b=new HostModelBridge(root,1000),h=attach(b);
 const p=b.transport('text',payload,new AbortController().signal,{outputContract:decisionContract});await vi.advanceTimersByTimeAsync(1);const id=task(h);
 const bad=b.submit(id,id,'{"accepted":true,"issues":["仍有矛盾"]}');expect(bad).toMatchObject({accepted:false,remainingSubmissions:1,feedback:{valid:false,validation:'structure'}});
 const disk=JSON.parse(readFileSync(join(root,id+'.json'),'utf8'));expect(disk.result).toBeUndefined();expect(disk.submissions).toHaveLength(1);
 const read=await b.tools()[0].handler({taskId:id} as any,{} as any);expect(JSON.parse((read as any).text).feedback.errors[0].message).toContain('issues必须为空');
 const good=b.submit(id,id,'{"accepted":false,"issues":["这张图角色错误"]}');expect(good).toMatchObject({accepted:true,feedback:{valid:true,validation:'structure'}});
 await vi.advanceTimersByTimeAsync(100);const r=await p;expect(JSON.parse((r.choices as any)[0].message.content).accepted).toBe(false);
});

it('错误JSON同样可纠正；重启不会清空两次提交额度且耗尽后不再发事件',async()=>{
 vi.useFakeTimers();const b=new HostModelBridge(root,1000),h=attach(b);
 const p=b.transport('text',payload,new AbortController().signal,{outputContract:decisionContract});await vi.advanceTimersByTimeAsync(1);const id=task(h);
 expect(b.submit(id,id,'{broken')).toMatchObject({accepted:false,remainingSubmissions:1});b.detach();const stopped=expect(p).rejects.toThrow('中断');await vi.advanceTimersByTimeAsync(100);await stopped;
 const next=new HostModelBridge(root,1000),h2=attach(next),p2=next.transport('text',payload,new AbortController().signal,{outputContract:decisionContract});await vi.advanceTimersByTimeAsync(1);expect(task(h2)).toBe(id);
 expect(next.submit(id,id,'{}')).toMatchObject({accepted:false,remainingSubmissions:0});const failed=expect(p2).rejects.toThrow('两次结构提交');await vi.advanceTimersByTimeAsync(100);await failed;
 const last=new HostModelBridge(root),h3=attach(last);await expect(last.transport('text',payload,new AbortController().signal,{outputContract:decisionContract})).rejects.toThrow('耗尽');expect(h3.events).toHaveLength(0);
});

it('模型抄长任务编号得到精确反馈，不误报确定超时，不消耗原任务提交额度',async()=>{
 vi.useFakeTimers();const b=new HostModelBridge(root,1000),h=attach(b),p=b.transport('text',payload,new AbortController().signal,{outputContract:decisionContract});await vi.advanceTimersByTimeAsync(1);const id=task(h);
 expect(()=>b.submit(id+id.slice(0,12),id,'{}')).toThrow('INVALID_TASK_ID');
 expect(()=>b.submit('f'.repeat(64),id,'{}')).toThrow('可能是编号抄错');
 const saved=JSON.parse(readFileSync(join(root,id+'.json'),'utf8'));expect(saved.submissions).toBeUndefined();
 expect(b.submit(id,id,'{"accepted":true,"issues":[]}')).toMatchObject({accepted:true,remainingSubmissions:1});await vi.advanceTimersByTimeAsync(100);await p;
});
