import {runtimesRoot} from 'cortico/paths.ts';
import {mailboxRuntime} from './mailbox-window.ts';
import {characterReference,styleReference} from './characters.ts';
import {HostModelBridge} from './host-model.ts';
import { describeTools, type WorldDefinition } from 'cortico/world.ts';
import { POSTCARD_DEFAULTS, type PostcardConfigSection } from './config.ts';
import { POSTCARD_TOOL_DECLS, PostcardWorld } from './world.ts';
import { createCloudGenerator } from './generation.ts';
import { join } from 'node:path';
export const POSTCARD: WorldDefinition<PostcardConfigSection> = {
  id:'postcard', label:'旅行大肥鱼', defaults:()=>({...POSTCARD_DEFAULTS}),
  create:ctx=>{
    let world:PostcardWorld;
    const bridge=new HostModelBridge(join(ctx.dataDir,'postcard/host-tasks'));
    const generator=ctx.cfg.cloudEnabled?createCloudGenerator({imageBackend:ctx.cfg.imageBackend,imageBaseUrl:ctx.cfg.imageBaseUrl,imageSize:ctx.cfg.imageSize,imageModel:ctx.cfg.imageModel,hostReady:()=>bridge.ready(),hostTransport:bridge.transport,useHostModel:ctx.cfg.useHostModel,root:join(ctx.dataDir,'postcard'),characterReference:characterReference(ctx.cfg),styleReference:styleReference(ctx.cfg),secret:name=>ctx.secret(name),imageProxyUrl:ctx.cfg.imageProxyUrl,visionProxyUrl:ctx.cfg.visionProxyUrl,recentTitles:()=>world.service.store.cards().slice(0,12).map(c=>c.title),recentVariants:scene=>world.service.store.cards().filter(c=>c.scene===scene&&typeof c.generation?.sceneVariant==='string').map(c=>c.generation!.sceneVariant as string)}):undefined;
    world=new PostcardWorld({cfg:ctx.cfg,dataDir:ctx.dataDir,generator,bridge,mailboxRuntime:()=>mailboxRuntime(runtimesRoot(),ctx.cfg.mailboxElectronFile),setup:{secret:name=>ctx.secret(name),storeSecret:(name,value)=>ctx.storeSecret(name,value)}});return world;
  },
  describe:{tools:describeTools([...POSTCARD_TOOL_DECLS,...HostModelBridge.prototype.tools.call({} as HostModelBridge)],{
    postcard_host_read:{zh:'读取宿主模型旅行待办及图片。',en:'Read host model task.'},
    postcard_host_submit:{zh:'提交宿主模型任务结果。',en:'Submit host model task result.'},
    postcard_pickup:{zh:'按当前请求协调靠近、开始取信或暂缓。',en:'Coordinate a saved postcard pickup.'},
    postcard_start:{zh:'开始一趟现实时间等待的旅行。',en:'Start one timed trip.'},
    postcard_status:{zh:'查看旅行与服务连接状态。',en:'Read trip and generator availability.'},
    postcard_list:{zh:'列出已保存的明信片。',en:'List saved postcards.'},
    postcard_read:{zh:'读取一份已完成的旅行短笺。',en:'Read a completed postcard.'},
    postcard_cancel:{zh:'取消未结束的旅行。',en:'Cancel an unfinished trip.'},
    postcard_retry:{zh:'按用户要求重试失败旅程。',en:'Retry a failed trip on user request.'},
  }),events:[
    {type:'postcard.pickup_due',description:{zh:'已入藏的明信片等待空闲取信演出。',en:'A saved postcard awaits an idle pickup performance.'}},
    {type:'postcard.host_task',description:{zh:'旅行宿主模型待办及候选附件。',en:'Host model postcard task and attachments.'}},
    {type:'postcard.started',description:{zh:'旅行核心已加载及生成服务可用情况。',en:'Travel core mounted and generator availability.'}},
    {type:'postcard.invitation_due',description:{zh:'用户配置的主动旅行询问时机已到，尚未获得出发许可。',en:'Configured invitation time is due; departure is not approved.'}},
    {type:'postcard.completed',description:{zh:'明信片已完整保存到收藏。',en:'A complete postcard was saved.'}},
  ]},
};
