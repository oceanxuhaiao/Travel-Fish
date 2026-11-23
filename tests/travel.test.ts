import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TravelService, TravelStore, type Artifact } from '../src/travel.ts';
import { PipelineError } from '../src/generation.ts';

let root: string, time: number;
const openServices: TravelService[] = [];
const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64');
const artifact: Artifact = { image, title:'森林来信', note:'一份经过生成服务批准的测试成品。' };
function make(generator: ConstructorParameters<typeof TravelService>[1]): TravelService {
  const service = new TravelService(new TravelStore(root), generator, ()=>time); service.open(); openServices.push(service); return service;
}
beforeEach(()=>{ root=mkdtempSync(join(tmpdir(),'postcard-')); time=1000; });
afterEach(async()=>{ for (const s of openServices.splice(0)) await s.close(); rmSync(root,{recursive:true,force:true}); });

describe('旅行状态和收藏',()=>{
  it('未到期不生成，并发tick只生成及入库一次',async()=>{
    const generator=vi.fn(async()=>artifact), s=make(generator), trip=s.start('forest',1);
    await s.tick(); expect(generator).not.toHaveBeenCalled();
    time=trip.dueAt; await Promise.all([s.tick(),s.tick(),s.tick()]);
    expect(generator).toHaveBeenCalledTimes(1); expect(s.status()?.status).toBe('completed'); expect(s.store.cards()).toHaveLength(1);
    await s.tick(); expect(generator).toHaveBeenCalledTimes(1);
  });
  it('重复出发拒绝，取消后允许出发且原编号不复用',()=>{
    const s=make(undefined), t=s.start('forest',1);
    expect(()=>s.start('coast',1)).toThrow('未结束'); s.cancel(t.id);
    expect(s.start('snow',1).id).not.toBe(t.id);
  });
  it('重启保留dueAt与scene，过期补结算',async()=>{
    const a=make(undefined), trip=a.start('snow',1); await a.close();
    time=trip.dueAt+10000; const generator=vi.fn(async()=>artifact), b=make(generator);
    expect(b.status()).toEqual(trip); await b.tick(); expect(generator).toHaveBeenCalledTimes(1); expect(b.store.cards()[0].scene).toBe('snow');
  });
  it('没有生成服务只报告awaiting_service，不虚假入库',async()=>{
    const s=make(undefined), trip=s.start('coast',1); time=trip.dueAt;
    await s.tick(); expect(s.status()?.status).toBe('awaiting_service'); expect(s.store.cards()).toEqual([]);
  });
  it('失败不自动重试，手动重试仍用原tripId',async()=>{
    const generator=vi.fn().mockRejectedValueOnce(new Error('secret-must-not-be-logged')).mockResolvedValue(artifact);
    const s=make(generator),trip=s.start('forest',1);time=trip.dueAt;await s.tick();await s.tick();
    expect(generator).toHaveBeenCalledTimes(1); expect(s.status()?.error).not.toContain('secret');
    s.retry(trip.id);await s.tick();expect(s.store.cards()[0].tripId).toBe(trip.id);
  });
  it('生成中取消，迟到的结果不能入库',async()=>{
    let resolve!: (a:Artifact)=>void;
    const s=make(()=>new Promise(r=>{resolve=r;})),trip=s.start('forest',1);time=trip.dueAt;
    const work=s.tick();s.cancel(trip.id);resolve(artifact);await work;
    expect(s.status()?.status).toBe('cancelled');expect(s.store.cards()).toEqual([]);
  });
  it('提交后的状态写入失败不会重复生成，重启从收藏恢复',async()=>{
    const s=make(async()=>artifact),trip=s.start('forest',1);time=trip.dueAt;
    const original=s.store.save.bind(s.store);let failed=false;
    vi.spyOn(s.store,'save').mockImplementation(next=>{if (!failed && next.trips[0].status==='completed') {failed=true;throw new Error('disk failure');} original(next);});
    await s.tick();expect(s.store.cards()).toHaveLength(1);await s.close();
    const gen=vi.fn(async()=>artifact),b=make(gen);await b.tick();expect(b.status()?.status).toBe('completed');expect(gen).not.toHaveBeenCalled();
  });
  it('生成期间崩溃恢复为failed，不能盲目重新收费',async()=>{
    const s=make(undefined),trip=s.start('forest',1);const state=s.store.snapshot();state.trips[0].status='generating';s.store.save(state);await s.close();
    const gen=vi.fn(async()=>artifact),b=make(gen);time=trip.dueAt;await b.tick();expect(b.status()?.status).toBe('failed');expect(gen).not.toHaveBeenCalled();
  });
  it('一个数据目录拒绝第二写入者，损坏快照不能静默清空',async()=>{
    const s=make(undefined);expect(()=>new TravelStore(root).open()).toThrow('另一个实例');await s.close();
    writeFileSync(join(root,'state.json'),'not-json');expect(()=>new TravelStore(root).open()).toThrow();expect(readFileSync(join(root,'state.json'),'utf8')).toBe('not-json');
  });
  it('收藏内容被修改则停止，不能自动覆盖或重新生成',async()=>{
    const s=make(async()=>artifact),trip=s.start('forest',1);time=trip.dueAt;await s.tick();await s.close();
    writeFileSync(join(root,'collection',trip.id,'postcard.png'),'corrupt');
    expect(()=>new TravelStore(root).open()).toThrow('校验');expect(existsSync(join(root,'collection',trip.id,'record.json'))).toBe(true);
  });
  it('完成通知确认后不会因重启重复进入待发列表',async()=>{
    const s=make(async()=>artifact),trip=s.start('forest',1);time=trip.dueAt;await s.tick();expect(s.pendingNotifications()).toHaveLength(1);s.acknowledge(trip.id);await s.close();
    const b=make(undefined);expect(b.pendingNotifications()).toEqual([]);expect(b.store.cards()).toHaveLength(1);
  });
  it('列表缓存不泄漏可变对象，图片或记录变化立即重新校验，显式读取总验哈希',async()=>{
    const s=make(async()=>artifact),trip=s.start('forest',1);time=trip.dueAt;await s.tick();
    const card=s.store.cards()[0];card.title='caller mutation';expect(s.store.cards()[0].title).toBe(artifact.title);
    const original=readFileSync(join(root,'collection',trip.id,'postcard.png'));const changed=Buffer.from(original);changed[changed.length-1]^=1;
    writeFileSync(join(root,'collection',trip.id,'postcard.png'),changed);
    expect(()=>s.store.cards()).toThrow('校验');expect(()=>s.store.card(trip.id)).toThrow('校验');
    writeFileSync(join(root,'collection',trip.id,'postcard.png'),original);expect(s.store.cards()).toHaveLength(1);
    const path=join(root,'collection',trip.id,'record.json'),record=JSON.parse(readFileSync(path,'utf8'));record.scene='not-a-scene';writeFileSync(path,JSON.stringify(record));
    expect(()=>s.store.cards()).toThrow('校验');
  });
});

it('新旅行提前生成但不到期不入册/通知，重启且生成离线仍按期交付',async()=>{
 const gen=vi.fn(async()=>artifact),s=new TravelService(new TravelStore(root),gen,()=>time,true);s.open();openServices.push(s);const trip=s.start('forest',120);await s.tick();expect(gen).toHaveBeenCalledTimes(1);expect(s.status()?.phase).toBe('ready_for_return');expect(s.store.cards()).toEqual([]);expect(s.pendingNotifications()).toEqual([]);await s.tick();expect(gen).toHaveBeenCalledTimes(1);await s.close();
 const resumed=new TravelService(new TravelStore(root),undefined,()=>time,true);resumed.open();openServices.push(resumed);time=trip.dueAt-1;await resumed.tick();expect(resumed.store.cards()).toEqual([]);time=trip.dueAt;await resumed.tick();expect(resumed.status()?.status).toBe('completed');expect(resumed.pendingNotifications()).toHaveLength(1);
});
it('预制完成后取消，归来时间后仍不交付',async()=>{
 const s=new TravelService(new TravelStore(root),async()=>artifact,()=>time,true);s.open();openServices.push(s);const trip=s.start('forest',120);await s.tick();s.cancel(trip.id);time=trip.dueAt;await s.tick();expect(s.store.cards()).toEqual([]);expect(s.pendingNotifications()).toEqual([]);
});
it('预制缓存损坏不自动重生图或发布',async()=>{
 const gen=vi.fn(async()=>artifact),s=new TravelService(new TravelStore(root),gen,()=>time,true);s.open();openServices.push(s);const trip=s.start('forest',120);await s.tick();writeFileSync(join(root,'prepared',trip.id,'postcard.png'),'corrupt');time=trip.dueAt;await s.tick();expect(s.status()?.status).toBe('failed');expect(gen).toHaveBeenCalledTimes(1);expect(s.store.cards()).toEqual([]);
});

describe('失败分型与重试阻断',()=>{
 it('记录结构化失败类别，预算耗尽时在改状态前阻断重试',async()=>{
  const generator=vi.fn(async()=>{throw new PipelineError('两次尝试上限','budget_exhausted','v2-expand-1');});
  const s=make(generator),trip=s.start('forest',1);
  time+=60000;await s.tick();
  const failed=s.store.snapshot().trips.find(t=>t.id===trip.id)!;
  expect(failed.status).toBe('failed');expect(failed.error).toBe('两次尝试上限');
  expect(failed.failure).toMatchObject({kind:'budget_exhausted',stage:'v2-expand-1',message:'两次尝试上限'});
  expect(()=>s.retry(trip.id)).toThrow('显式追加一次重试授权');
  const after=s.store.snapshot().trips.find(t=>t.id===trip.id)!;
  expect(after.status).toBe('failed');expect(after.failure?.kind).toBe('budget_exhausted');expect(after.error).toBe('两次尝试上限');
  expect(generator).toHaveBeenCalledTimes(1);
 });
 it('内容策略拦截不空转；临时故障仍可手动重试并清空失败状态',async()=>{
  const blocked=vi.fn(async()=>{throw new PipelineError('内容过滤','policy_blocked','plan-1');});
  const s=make(blocked),t=s.start('forest',1);
  time+=60000;await s.tick();
  expect(()=>s.retry(t.id)).toThrow('策略拦截');
  expect(blocked).toHaveBeenCalledTimes(1);
  s.cancel(t.id);await s.close();openServices.length=0;
  let calls=0;const generator=vi.fn(async()=>{if(calls++===0)throw new PipelineError('服务暂时不可用','transient');return artifact;});
  const s2=make(generator),trip=s2.start('forest',1);
  time+=60000;await s2.tick();
  expect(s2.store.snapshot().trips.find(x=>x.id===trip.id)!.failure?.kind).toBe('transient');
  s2.retry(trip.id);
  expect(s2.store.snapshot().trips.find(x=>x.id===trip.id)!.failure).toBeUndefined();
  time+=60000;await s2.tick();expect(s2.store.cards()).toHaveLength(1);
 });
});

describe('一次性追加授权',()=>{
 const spent=()=>vi.fn(async()=>{throw new PipelineError('两次尝试上限','budget_exhausted','v2-expand-1');});
 it('申请幂等，消费一次后可重试；已消费不能复用，再失败可重新申请',async()=>{
  const generator=spent(),s=make(generator),trip=s.start('forest',1);time+=60000;await s.tick();
  expect(()=>s.retry(trip.id)).toThrow('显式追加一次重试授权');
  const g1=s.grantRetry(trip.id),g2=s.grantRetry(trip.id);
  expect(g2.grantId).toBe(g1.grantId);expect(g1).toMatchObject({stage:'v2-expand-1',kind:'text'});
  expect(g1.message).toContain('只追加一次文字调用');
  s.retry(trip.id,false,g1.grantId);
  expect(s.store.snapshot().trips.find(t=>t.id===trip.id)!.status).toBe('traveling');
  expect(s.store.snapshot().trips.find(t=>t.id===trip.id)!.failure).toBeUndefined();
  time+=60000;await s.tick();
  const again=s.store.snapshot().trips.find(t=>t.id===trip.id)!;
  expect(again.status).toBe('failed');expect(again.failure?.kind).toBe('budget_exhausted');
  expect(()=>s.retry(trip.id,false,g1.grantId)).toThrow('已经用过');
  const g3=s.grantRetry(trip.id);expect(g3.grantId).not.toBe(g1.grantId);
  expect(generator).toHaveBeenCalledTimes(2);
 });
 it('无效或跨旅行的授权被拒绝且不改变状态',async()=>{
  const generator=spent(),s=make(generator),trip=s.start('forest',1);time+=60000;await s.tick();
  writeFileSync(join(root,'retry-grants.json'),JSON.stringify({schema:1,grants:[{id:'other',tripId:'f'.repeat(36),owner:'x',stage:'v2-expand-1',kind:'text',createdAt:1}]}));
  expect(()=>s.retry(trip.id,false,'other')).toThrow('不属于本次旅行');
  expect(()=>s.retry(trip.id,false,'missing')).toThrow('无效');
  expect(s.store.snapshot().trips.find(t=>t.id===trip.id)!.status).toBe('failed');
  expect(generator).toHaveBeenCalledTimes(1);
 });
 it('未消费的授权在重启后仍可使用，取消确认不产生第二个授权',async()=>{
  const generator=spent(),s=make(generator),trip=s.start('forest',1);time+=60000;await s.tick();
  const g=s.grantRetry(trip.id);expect(s.grantRetry(trip.id).grantId).toBe(g.grantId);
  openServices.splice(openServices.indexOf(s),1);await s.close();
  const s2=make(generator);
  const g2=s2.grantRetry(trip.id);expect(g2.grantId).toBe(g.grantId);
  s2.retry(trip.id,false,g.grantId);
  expect(s2.store.snapshot().trips.find(t=>t.id===trip.id)!.status).toBe('traveling');
 });
});

describe('图片阶段的追加授权',()=>{
 it('失败阶段为图片时授予图片许可，消费一次后必须重新确认',async()=>{
  const generator=vi.fn(async()=>{throw new PipelineError('本趟图片请求已达到上限（2次）；需要你再次确认追加一次图片制作，不会自动重试','budget_exhausted','image');});
  const s=make(generator),trip=s.start('forest',1);time+=60000;await s.tick();
  const failed=s.store.snapshot().trips.find(t=>t.id===trip.id)!;
  expect(failed.failure).toMatchObject({kind:'budget_exhausted',stage:'image'});
  expect(()=>s.retry(trip.id)).toThrow('显式追加一次重试授权');
  const grant=s.grantRetry(trip.id);
  expect(grant).toMatchObject({stage:'image',kind:'image'});
  expect(grant.message).toContain('追加一次图片制作');expect(grant.message).not.toContain('只追加一次文字调用');
  s.retry(trip.id,false,grant.grantId);
  expect(s.store.snapshot().trips.find(t=>t.id===trip.id)!.status).toBe('traveling');
  time+=60000;await s.tick();
  expect(s.store.snapshot().trips.find(t=>t.id===trip.id)!.failure?.stage).toBe('image');
  expect(()=>s.retry(trip.id,false,grant.grantId)).toThrow('已经用过');
  const next=s.grantRetry(trip.id);expect(next.grantId).not.toBe(grant.grantId);expect(next.kind).toBe('image');
  expect(generator).toHaveBeenCalledTimes(2);
 });
});
