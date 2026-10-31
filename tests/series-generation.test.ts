import {it,expect,vi} from 'vitest';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {PNG} from 'pngjs';
import {createCloudGenerator,type Transport} from '../src/generation.ts';
import type {StoryContext} from '../src/journey-types.ts';
import type {Trip} from '../src/travel.ts';
const response=(v:unknown)=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify(v)}}]});
it('系列生成使用本节点画面；场景偏离但身份与图片可用时只改文字，同图两次文案后保留事实哈希',async()=>{
 const root=mkdtempSync(join(tmpdir(),'postcard-series-generation-'));const png=new PNG({width:512,height:768});png.data.fill(240);const image=PNG.sync.write(png),ref=join(root,'ref.png');writeFileSync(ref,image);
 const id=randomUUID(),jid=randomUUID();const trip:Trip={id,scene:'coast',series:{id:jid,mark:'旅迹·test',nodeIndex:1,total:3},startedAt:0,dueAt:7200000,status:'generating'};
 const ctx:StoryContext={policy:'travel-story-v1',journeyId:jid,nodeIndex:1,planHash:'fixed-plan',priorHash:'no-prior',priorCards:[],node:{index:1,role:'看图示',location:'室内小馆',event:'读一页导览册',action:'看清一处图示',payoff:'知道一个展台的位置',visibleScene:'室内展台边，大肥鱼捧着导览册',composition:'桌边侧面中景',dependencies:[],carryovers:[],nextInterest:null}};
 let storyChecks=0;const transport=vi.fn<Transport>(async(kind,payload)=>{
  if(kind==='image')return {data:[{b64_json:image.toString('base64')}]};
  const p=(payload.messages as any[])[0].content[0].text;
  if(p.startsWith('图1为候选'))return response({paperRegions:[],paperStates:[{object:'menu',form:'absent',visibleInnerPages:null,spreadPanels:null,outerCoverOnly:null,evidence:'未见菜单'},{object:'guide',form:'booklet',visibleInnerPages:true,spreadPanels:true,outerCoverOnly:false,evidence:'手中可见摊开内页'},{object:'book',form:'absent',visibleInnerPages:null,spreadPanels:null,outerCoverOnly:null,evidence:'无其他书'}],portrayal:{orientation:'side',action:'sit',expression:'focused',subjectHeightRatio:.75},scene_match:false,character_match:true,usable:true,background_conflicts:[],issues:[],facts:['女孩坐在室内桌边','手里有一本导览册','旁边有展示台']});
  if(p.startsWith('写桌宠旅行'))return response({title:'导览册边的小停留',note:'我坐在小桌旁把导览册翻开，慢慢看清了一个图示，原来身边的展台就在这一页里。没有急着把每一页都读完，能先弄明白这一小处，我就觉得很有意思。'});
  if(p.startsWith('只检查文字'))return response({has_real_place_name:false,names:[]});
  if(p.startsWith('审核当前短笺'))return response({accepted:++storyChecks===2,issues:storyChecks===1?['受控替身首版需要改写']:[]});
  return response({checks:[],has_explicit_conflict:false,conflicts:[],uncertain_details:[]});
 });
 try{const generator=createCloudGenerator({root,characterReference:ref,styleReference:ref,secret:()=> 'test-only',storyContext:async()=>ctx},transport);trip.generation=generator.prepare!(trip);const result=await generator(trip,new AbortController().signal);
  expect(transport.mock.calls.filter(c=>c[0]==='image')).toHaveLength(1);expect(transport.mock.calls.find(c=>c[0]==='image')![1].prompt).toContain(ctx.node.visibleScene);expect(result.generation?.noteAttempt).toBe(2);expect(result.generation?.storyLocation).toBe('室内小馆');expect(result.generation?.portrayal).toMatchObject({orientation:'side',action:'sit'});expect(transport.mock.calls.find(c=>c[0]==='image')![1].prompt).toContain('人物大小与镜头距离完全遵循故事节点composition指定的景别');expect(result.generation?.visualEvidence).toMatchObject({facts:['女孩坐在室内桌边','手里有一本导览册','旁边有展示台']});
  const next={...trip,id:randomUUID(),contentId:trip.id};const calls=transport.mock.calls.length;await generator(next,new AbortController().signal);expect(transport).toHaveBeenCalledTimes(calls);
 }finally{rmSync(root,{recursive:true,force:true});}
});
