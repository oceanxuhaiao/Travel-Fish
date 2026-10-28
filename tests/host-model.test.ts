import {it,expect,vi,afterEach,beforeEach} from 'vitest';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {HostModelBridge} from '../src/host-model.ts';import {FakeHost} from './helpers/fake-host.ts';
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
