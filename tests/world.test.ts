import { describe,it,expect,beforeEach,afterEach,vi } from 'vitest';
import { mkdtempSync,rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { ToolCallContext } from 'cortico/core/types.ts';
import { dryMountWorld,fakeWorldContext } from 'cortico/extensions/dry-mount.ts';
import { POSTCARD } from '../src/definition.ts';
import { FakeHost } from './helpers/fake-host.ts';
import {PostcardWorld} from '../src/world.ts';
import {POSTCARD_DEFAULTS} from '../src/config.ts';
let scratchDir:string;
beforeEach(()=>{scratchDir=mkdtempSync(join(tmpdir(),'postcard-world-'));});
afterEach(()=>rmSync(scratchDir,{recursive:true,force:true}));
describe('Postcard World',()=>{
  it('完成事件实际投递失败后可补发，收藏不回滚也不重新生图',async()=>{
    let now=0;const generator=vi.fn(async()=>({image:Buffer.from('89504e470d0a1a0a00000000','hex'),title:'通知测试',note:'测试成品'}));
    const world=new PostcardWorld({cfg:POSTCARD_DEFAULTS,dataDir:scratchDir,generator,now:()=>now}),host=new FakeHost();
    await world.start(host);const push=host.pushEvent.bind(host);let failed=false;
    vi.spyOn(host,'pushEvent').mockImplementation(async(event,options)=>{if(event.type==='postcard.completed'&&!failed){failed=true;throw Error('event transport unavailable');}return push(event,options);});
    try{const trip=world.service.start('forest',1);now=trip.dueAt;
      await expect(world.pulse()).rejects.toThrow('event transport');expect(world.service.status()?.status).toBe('completed');expect(world.service.pendingNotifications()).toHaveLength(1);
      await world.pulse();await world.pulse();expect(generator).toHaveBeenCalledTimes(1);expect(world.service.pendingNotifications()).toEqual([]);expect(host.events.filter(e=>e.type==='postcard.completed')).toHaveLength(1);expect(host.events.find(e=>e.type==='postcard.completed')!.text).toContain('你是旅行者和寄信人');
      const read=world.tools().find(t=>t.name==='postcard_read')!;const receipt=JSON.parse(await read.handler({tripId:trip.id},{} as ToolCallContext) as string);expect(receipt.note).toBe('测试成品');expect(receipt.narrativeContext).toContain('用户是收信人');expect(receipt.narrativeContext).toContain('开发验证');
    }finally{await world.stop();}
  });
  it('真实契约干装载通过',async()=>{
    const result=await dryMountWorld(POSTCARD,{scratchDir});expect(result.failures).toEqual([]);
  });
  it('工具只返回可确认状态，生成关闭时禁止工具与面板出发，停止后释放存档锁',async()=>{
    const world=POSTCARD.create({...fakeWorldContext(POSTCARD,{scratchDir}),cfg:{...POSTCARD_DEFAULTS,cloudEnabled:false}}),host=new FakeHost();
    await world.start(host);
    try {
      expect(host.events.map(e=>e.type)).toEqual(['postcard.started']);
      const call={} as ToolCallContext;
      const tool=(name:string)=>world.tools().find(t=>t.name===name)!;
      await expect(tool('postcard_start').handler({},call)).rejects.toThrow('尚未开始旅行');
      const status=JSON.parse(await tool('postcard_status').handler({},call) as string);
      expect(status.trip).toBeNull();expect(status.generatorConnected).toBe(false);
      expect(JSON.parse(await tool('postcard_list').handler({},call) as string)).toEqual([]);
      await expect(world.webUi!().invoke!('album','start',[])).rejects.toThrow('尚未开始旅行');
    } finally {await world.stop();}
    const next=POSTCARD.create({...fakeWorldContext(POSTCARD,{scratchDir}),cfg:{...POSTCARD_DEFAULTS,cloudEnabled:false}});await next.start(new FakeHost());await next.stop();
  });
});
