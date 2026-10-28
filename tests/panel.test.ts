import {beforeEach,afterEach,it,expect} from 'vitest';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {unzipSync,strFromU8} from 'fflate';
import {PNG} from 'pngjs';
import {TravelStore,TravelService} from '../src/travel.ts';
import {PostcardPanel,type PanelSnapshot} from '../src/panel.ts';

let root:string,now:number,service:TravelService,panel:PostcardPanel,image:Buffer;
beforeEach(()=>{root=mkdtempSync(join(tmpdir(),'postcard-panel-'));now=0;const png=new PNG({width:512,height:768});png.data.fill(235);image=PNG.sync.write(png);service=new TravelService(new TravelStore(root),async()=>({image,title:'森林的一封来信',note:'树影和溪流陪我待了一会儿。想把这一刻的安静寄给你。',generation:{privatePath:'private-must-not-export'}}),()=>now);service.open();panel=new PostcardPanel(service,()=>({minutes:30,generatorConnected:true}));});
afterEach(async()=>{await service.close();rmSync(root,{recursive:true,force:true});});
it('面板与工具共用旅行状态，刷新不另建旅程，取消/到期可见',async()=>{
  const view=await panel.invoke('album','start',['forest']) as PanelSnapshot;const id=view.trip!.id;
  expect(service.status()?.id).toBe(id);expect((await panel.invoke('album','snapshot',[]) as PanelSnapshot).trip!.id).toBe(id);
  await expect(panel.invoke('album','start',['snow'])).rejects.toThrow('未结束');
  await panel.invoke('album','cancel',[id]);expect(service.status()?.status).toBe('cancelled');
  const next=await panel.invoke('album','start',['snow']) as PanelSnapshot;now=next.trip!.dueAt;await service.tick();
  expect(panel.snapshot().cards).toHaveLength(1);expect(panel.snapshot().trip!.status).toBe('completed');
});
it('PNG原样导出、ZIP内容一致且剔除内部路径/检查信息',async()=>{
  const trip=service.start('forest',1);now=trip.dueAt;await service.tick();
  const original=readFileSync(join(root,'collection',trip.id,'postcard.png'));
  const png=await panel.invoke('album','png',[trip.id]) as {$binary:{mime:string;base64:string}};
  expect(Buffer.from(png.$binary.base64,'base64')).toEqual(original);expect(png.$binary.mime).toBe('image/png');
  const packed=await panel.invoke('album','zip',[trip.id]) as typeof png;
  const files=unzipSync(Buffer.from(packed.$binary.base64,'base64'));expect(Object.keys(files).sort()).toEqual(['metadata.json','note.md','postcard.png']);
  expect(Buffer.from(files['postcard.png'])).toEqual(original);const meta=strFromU8(files['metadata.json']);expect(meta).not.toContain('private-must-not-export');expect(meta).not.toContain('generation');expect(meta).not.toContain(root);
  expect(strFromU8(files['note.md'])).toContain('森林的一封来信');
});
it('缩略图保持比例且不改写原始成图，不接受任意路径下载',async()=>{
  const trip=service.start('coast',1);now=trip.dueAt;await service.tick();
  const result=await panel.invoke('album','thumbnail',[trip.id]) as {$binary:{base64:string}};
  const thumb=PNG.sync.read(Buffer.from(result.$binary.base64,'base64'));expect(thumb.width).toBe(360);expect(thumb.height).toBe(540);
  expect(readFileSync(join(root,'collection',trip.id,'postcard.png'))).toEqual(image);
  await expect(panel.invoke('album','image',['../../config'])).rejects.toThrow('无效');await expect(panel.invoke('other','snapshot',[])).rejects.toThrow('未知');
});
it('重启后无需云端服务仍可读取与导出旧收藏',async()=>{
  const trip=service.start('forest',1);now=trip.dueAt;await service.tick();await service.close();
  service=new TravelService(new TravelStore(root),undefined,()=>now);service.open();panel=new PostcardPanel(service,()=>({minutes:30,generatorConnected:false}));
  expect(panel.snapshot().cards[0].tripId).toBe(trip.id);const bytes=await panel.invoke('album','png',[trip.id]) as {$binary:{base64:string}};expect(Buffer.from(bytes.$binary.base64,'base64')).toEqual(image);
});

it('面板忽略旧设置与额外参数，新旅行固定两小时',async()=>{
 const state=await panel.invoke('album','start',[1]) as PanelSnapshot;
 expect(state.minutes).toBe(120);expect(state.trip!.dueAt-state.trip!.startedAt).toBe(7200000);
});

it('邮箱显隐操作幂等且不改变进行中的旅行或收藏',async()=>{
 let phase='running';let closes=0;
 panel=new PostcardPanel(service,()=>({minutes:120,generatorConnected:true}),{snapshot:()=>({unreadCount:0} as any),markRead:()=>{},open:async()=>{phase='running';return {phase:'running',detail:'opened'};},close:async()=>{phase='closed';closes++;},windowState:()=>({phase:phase as any,detail:phase})});
 const trip=service.start('forest',120);
 for(let i=0;i<2;i++)expect((await panel.invoke('album','closeMailbox',[]) as PanelSnapshot).mailboxWindow?.phase).toBe('closed');
 expect(closes).toBe(2);expect(service.status()?.id).toBe(trip.id);expect(service.status()?.status).toBe('traveling');
 expect((await panel.invoke('album','openMailbox',[]) as PanelSnapshot).mailboxWindow?.phase).toBe('running');
 expect(service.store.cards()).toHaveLength(0);
});
