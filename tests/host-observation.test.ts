import {it,expect,vi,beforeEach,afterEach} from 'vitest';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {join} from 'node:path';import {tmpdir} from 'node:os';
import {HostModelBridge} from '../src/host-model.ts';
import {FakeHost} from './helpers/fake-host.ts';
let root:string;beforeEach(()=>{root=mkdtempSync(join(tmpdir(),'postcard-terminal-'));vi.useFakeTimers();});
afterEach(()=>{vi.useRealTimers();rmSync(root,{recursive:true,force:true});});
const payload=(label='plan-1')=>({__postcardTask:{tripId:'test',label},messages:[{content:[{type:'text',text:'fixture'}]}]});
function open(){const bridge=new HostModelBridge(root,1000),host=new FakeHost();host.modelFacts.accepts=()=>true;bridge.attach(host);return {bridge,host};}
const id=(h:FakeHost,n=0)=>String(h.events[n].text).match(/taskId=([a-f0-9]{64})/)![1];
const disk=(task:string)=>JSON.parse(readFileSync(join(root,task+'.json'),'utf8'));
const phase=(b:HostModelBridge,state:'model'|'tools'|'delivering',round:number)=>b.onRunPhase({state,round,running:state==='tools'?['postcard_host_read']:[],enteredAt:new Date().toISOString()});
async function read(b:HostModelBridge,task:string){phase(b,'tools',11);await b.tools()[0].handler({taskId:task} as any,{} as any);}
function terminal(b:HostModelBridge,reason='max_output_tokens',responseId='response-one'){
 phase(b,'model',12);const tap=b.outputTap();tap.onEvent({type:'response.created',response:{id:responseId}} as any);
 tap.onEvent({type:'response.incomplete',response:{id:responseId,status:'incomplete',incomplete_details:{reason},usage:{output_tokens:8192,output_tokens_details:{reasoning_tokens:8192}}}} as any);
}
it('离线回放8192截断：已读待办快速失败，留下终态且不重投或生成结果',async()=>{
 const {bridge:b,host:h}=open(),p=b.transport('text',payload(),new AbortController().signal);const failed=expect(p).rejects.toThrow('输出被截断');await vi.advanceTimersByTimeAsync(1);const task=id(h);
 b.onEventsSettled(h.events,'delivered');await read(b,task);terminal(b);await vi.advanceTimersByTimeAsync(100);await failed;
 expect(h.events).toHaveLength(1);expect(disk(task)).toMatchObject({lifecycle:{activation:1,deliveries:1,reads:1,state:'output_truncated',terminalReason:'output_truncated',responseId:'response-one'}});
 expect(disk(task).lifecycle.deliveredAt).toBeDefined();expect(disk(task).result).toBeUndefined();expect(disk(task).submissions).toBeUndefined();
});
it('其他聊天截断、读任务后的新投递、隔轮输出均不误归因',async()=>{
 const {bridge:b,host:h}=open(),p=b.transport('text',payload(),new AbortController().signal);await vi.advanceTimersByTimeAsync(1);const task=id(h);
 terminal(b);await vi.advanceTimersByTimeAsync(100);expect(disk(task).lifecycle.terminalReason).toBeUndefined();
 await read(b,task);phase(b,'delivering',11);terminal(b);await vi.advanceTimersByTimeAsync(100);expect(disk(task).lifecycle.terminalReason).toBeUndefined();
 await read(b,task);phase(b,'model',13);b.outputTap().onEvent({type:'response.created',response:{id:'other'}} as any);b.outputTap().onEvent({type:'response.incomplete',response:{id:'other',incomplete_details:{reason:'max_output_tokens'}}} as any);
 b.submit(task,task,'{"ok":true}');await vi.advanceTimersByTimeAsync(100);await p;
});
it('同轮读取多个待办时归属不清，不将截断扣到任何一项',async()=>{
 const {bridge:b,host:h}=open(),p=b.transport('text',payload(),new AbortController().signal),q=b.transport('text',payload('other'),new AbortController().signal);await vi.advanceTimersByTimeAsync(1);
 await read(b,id(h));await read(b,id(h,1));terminal(b);await vi.advanceTimersByTimeAsync(100);
 for(const task of [id(h),id(h,1)]){expect(disk(task).lifecycle.terminalReason).toBeUndefined();b.submit(task,task,'{"ok":true}');}
 await vi.advanceTimersByTimeAsync(100);await Promise.all([p,q]);
});
it('有效提交优先于后到截断元数据，不倒退成失败',async()=>{
 const {bridge:b,host:h}=open(),p=b.transport('text',payload(),new AbortController().signal);await vi.advanceTimersByTimeAsync(1);const task=id(h);await read(b,task);terminal(b);b.submit(task,task,'{"ok":true}');await vi.advanceTimersByTimeAsync(100);await p;
 expect(disk(task).lifecycle.state).toBe('submitted');expect(disk(task).lifecycle.terminalReason).toBeUndefined();
});
it('内容过滤单独归类，未知incomplete原因仍保留超时兜底',async()=>{
 const {bridge:b,host:h}=open(),p=b.transport('text',payload(),new AbortController().signal);const failed=expect(p).rejects.toThrow('内容过滤');await vi.advanceTimersByTimeAsync(1);await read(b,id(h));terminal(b,'content_filter');await vi.advanceTimersByTimeAsync(100);await failed;
 const q=b.transport('text',payload('unknown'),new AbortController().signal);const timed=expect(q).rejects.toThrow('等待超时');await vi.advanceTimersByTimeAsync(1);await read(b,id(h,1));terminal(b,'unknown');await vi.advanceTimersByTimeAsync(1100);await timed;
 expect(disk(id(h,1)).lifecycle.terminalReason).toBe('no_result_timeout');
});
it('截断后重新挂载不自动处理；显式恢复保留投递/读取历史且不增加提交额度',async()=>{
 const {bridge:b,host:h}=open(),p=b.transport('text',payload(),new AbortController().signal);const failed=expect(p).rejects.toThrow('输出被截断');await vi.advanceTimersByTimeAsync(1);const task=id(h);await read(b,task);terminal(b);await vi.advanceTimersByTimeAsync(100);await failed;
 const {bridge:c,host:j}=open();expect(j.events).toHaveLength(0);const q=c.transport('text',payload(),new AbortController().signal);await vi.advanceTimersByTimeAsync(1);expect(id(j)).toBe(task);await read(c,task);c.submit(task,task,'{"ok":true}');await vi.advanceTimersByTimeAsync(100);await q;
 expect(disk(task).lifecycle).toMatchObject({activation:2,deliveries:2,reads:2,state:'submitted'});expect(disk(task).lifecycle.terminals).toHaveLength(1);
});
it('丢弃队列中的本扩展事件后退出等待，不重新推送',async()=>{
 const {bridge:b,host:h}=open(),p=b.transport('text',payload(),new AbortController().signal);const failed=expect(p).rejects.toThrow('队列清除');await vi.advanceTimersByTimeAsync(1);b.onEventsSettled(h.events,'discarded');await vi.advanceTimersByTimeAsync(100);await failed;expect(h.events).toHaveLength(1);
});
it('排队后读取会更新进展期限，但重复读取不能超过总等待上限',async()=>{
 const {bridge:b,host:h}=open(),p=b.transport('text',payload(),new AbortController().signal);const timed=expect(p).rejects.toThrow('等待超时');
 await vi.advanceTimersByTimeAsync(900);const task=id(h);await read(b,task);await vi.advanceTimersByTimeAsync(500);
 expect(disk(task).lifecycle.terminalReason).toBeUndefined();await read(b,task);await vi.advanceTimersByTimeAsync(700);await timed;expect(h.events).toHaveLength(1);
});
it('流式提前执行read时，模型阶段的工具起止通知不丢失关联',async()=>{
 const {bridge:b,host:h}=open(),p=b.transport('text',payload(),new AbortController().signal);const failed=expect(p).rejects.toThrow('输出被截断');await vi.advanceTimersByTimeAsync(1);const task=id(h);
 b.onRunPhase({state:'model',round:11,running:['postcard_host_read'],enteredAt:new Date().toISOString()});
 await b.tools()[0].handler({taskId:task} as any,{} as any);
 b.onRunPhase({state:'model',round:11,running:[],enteredAt:new Date().toISOString()});
 phase(b,'tools',11);terminal(b);await vi.advanceTimersByTimeAsync(100);await failed;
 expect(disk(task).lifecycle.terminalReason).toBe('output_truncated');
});
