import { describe,it,expect,beforeEach,afterEach } from 'vitest';
import { mkdtempSync,rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { ToolCallContext } from 'cortico/core/types.ts';
import { dryMountWorld,fakeWorldContext } from 'cortico/extensions/dry-mount.ts';
import { POSTCARD } from '../src/definition.ts';
import { FakeHost } from './helpers/fake-host.ts';
let scratchDir:string;
beforeEach(()=>{scratchDir=mkdtempSync(join(tmpdir(),'postcard-world-'));});
afterEach(()=>rmSync(scratchDir,{recursive:true,force:true}));
describe('Postcard World',()=>{
  it('真实契约干装载通过',async()=>{
    const result=await dryMountWorld(POSTCARD,{scratchDir});expect(result.failures).toEqual([]);
  });
  it('工具只返回可确认状态，支持出发和取消，停止后释放存档锁',async()=>{
    const world=POSTCARD.create(fakeWorldContext(POSTCARD,{scratchDir})),host=new FakeHost();
    await world.start(host);
    try {
      expect(host.events.map(e=>e.type)).toEqual(['postcard.started']);
      const call={} as ToolCallContext;
      const tool=(name:string)=>world.tools().find(t=>t.name===name)!;
      const trip=JSON.parse(await tool('postcard_start').handler({scene:'forest'},call) as string);
      const status=JSON.parse(await tool('postcard_status').handler({},call) as string);
      expect(status.trip.id).toBe(trip.id);expect(status.generatorConnected).toBe(false);
      expect(JSON.parse(await tool('postcard_list').handler({},call) as string)).toEqual([]);
      await tool('postcard_cancel').handler({tripId:trip.id},call);
    } finally {await world.stop();}
    const next=POSTCARD.create(fakeWorldContext(POSTCARD,{scratchDir}));await next.start(new FakeHost());await next.stop();
  });
});
