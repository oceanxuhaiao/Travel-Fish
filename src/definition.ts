import { describeTools, type WorldDefinition } from 'cortico/world.ts';
import { POSTCARD_DEFAULTS, type PostcardConfigSection } from './config.ts';
import { POSTCARD_TOOL_DECLS, PostcardWorld } from './world.ts';
import { createCloudGenerator } from './generation.ts';
import { join } from 'node:path';
export const POSTCARD: WorldDefinition<PostcardConfigSection> = {
  id:'postcard', label:'旅行明信片', defaults:()=>({...POSTCARD_DEFAULTS}),
  create:ctx=>{
    let world:PostcardWorld;
    const generator=ctx.cfg.cloudEnabled?createCloudGenerator({root:join(ctx.dataDir,'postcard'),characterReference:ctx.cfg.characterReference,styleReference:ctx.cfg.styleReference,secret:name=>ctx.secret(name),imageProxyUrl:ctx.cfg.imageProxyUrl,visionProxyUrl:ctx.cfg.visionProxyUrl,recentTitles:()=>world.service.store.cards().slice(0,12).map(c=>c.title),recentVariants:scene=>world.service.store.cards().filter(c=>c.scene===scene&&typeof c.generation?.sceneVariant==='string').map(c=>c.generation!.sceneVariant as string)}):undefined;
    world=new PostcardWorld({cfg:ctx.cfg,dataDir:ctx.dataDir,generator});return world;
  },
  describe:{tools:describeTools(POSTCARD_TOOL_DECLS,{
    postcard_start:{zh:'开始一趟现实时间等待的旅行。',en:'Start one timed trip.'},
    postcard_status:{zh:'查看旅行与服务连接状态。',en:'Read trip and generator availability.'},
    postcard_list:{zh:'列出已保存的明信片。',en:'List saved postcards.'},
    postcard_read:{zh:'读取一份已完成的旅行短笺。',en:'Read a completed postcard.'},
    postcard_cancel:{zh:'取消未结束的旅行。',en:'Cancel an unfinished trip.'},
    postcard_retry:{zh:'按用户要求重试失败旅程。',en:'Retry a failed trip on user request.'},
  }),events:[
    {type:'postcard.started',description:{zh:'旅行核心已加载及生成服务可用情况。',en:'Travel core mounted and generator availability.'}},
    {type:'postcard.completed',description:{zh:'明信片已完整保存到收藏。',en:'A complete postcard was saved.'}},
  ]},
};
