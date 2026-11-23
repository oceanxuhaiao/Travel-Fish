import {it,expect,vi} from 'vitest';
import {mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {PNG} from 'pngjs';
import {createCloudGenerator,type Transport} from '../src/generation.ts';
import type {StoryContext} from '../src/journey-types.ts';
import type {Trip} from '../src/travel.ts';

const response=(v:unknown)=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify(v)}}]});
const portrait={orientation:'side',action:'sit',expression:'focused',subjectHeightRatio:.75};

function fixture(){
 const root=mkdtempSync(join(tmpdir(),'image-grant-')),png=new PNG({width:512,height:768});png.data.fill(230);
 const image=PNG.sync.write(png),ref=join(root,'ref.png');writeFileSync(ref,image);
 const id=randomUUID(),jid=randomUUID();
 const trip:Trip={id,scene:'coast',series:{id:jid,mark:'旅迹·test',nodeIndex:1,total:3},startedAt:0,dueAt:7200000,status:'generating'};
 const ctx:StoryContext={policy:'travel-story-v1',journeyId:jid,nodeIndex:1,planHash:'fixed-plan',priorHash:'no-prior',priorCards:[],node:{index:1,role:'歇脚',location:'海边长椅',event:'坐下看海',action:'坐着听风',payoff:'缓一口气',visibleScene:'海边长椅旁，大肥鱼坐着看海',composition:'侧向中景',dependencies:[],carryovers:[],nextInterest:null}};
 const transport=vi.fn<Transport>(async(kind,payload)=>{
  if(kind==='image')return {data:[{b64_json:image.toString('base64')}]};
  const p=(payload.messages as any[])[0].content[0].text;
  if(p.startsWith('图1为候选'))return response({paperRegions:[],paperStates:[{object:'menu',form:'absent',visibleInnerPages:null,spreadPanels:null,outerCoverOnly:null,evidence:'未见菜单'},{object:'guide',form:'absent',visibleInnerPages:null,spreadPanels:null,outerCoverOnly:null,evidence:'未见导览页'},{object:'book',form:'absent',visibleInnerPages:null,spreadPanels:null,outerCoverOnly:null,evidence:'无书册'}],portrayal:portrait,scene_match:true,character_match:true,usable:true,background_conflicts:[],issues:[],facts:['女孩坐在长椅上','远处有海面','旁边有木栏']});
  if(p.startsWith('写桌宠旅行'))return response({title:'长椅上的海风',note:'我在长椅上坐下来，听了一会儿风，海面一直没有停。没有急着赶路，能这样坐一会儿，心里就慢慢安静下来。'});
  if(p.startsWith('只检查文字'))return response({has_real_place_name:false,names:[]});
  if(p.startsWith('审核当前短笺'))return response({accepted:true,issues:[]});
  return response({checks:[],has_explicit_conflict:false,conflicts:[],uncertain_details:[]});
 });
 const generator=createCloudGenerator({root,characterReference:ref,styleReference:ref,secret:()=> 'test-only',storyContext:async()=>ctx},transport);
 trip.generation=generator.prepare!(trip);
 // Two image attempts were already spent and both candidates were rejected.
 const folder=join(root,'trips',id);mkdirSync(folder,{recursive:true});
 writeFileSync(join(folder,'checkpoint.json'),JSON.stringify({schema:1,imageAttempt:2,pendingImage:false,stage:'image_rejected',textRequests:{},errors:[]}));
 writeFileSync(join(folder,'image-2.png'),image);
 writeFileSync(join(folder,'image-2.png.json'),JSON.stringify({sha256:createHash('sha256').update(image).digest('hex'),width:512,height:768}));
 writeFileSync(join(folder,'image-2-rejected.json'),JSON.stringify({rejected:true,validation:'business'}));
 return {root,id,jid,trip,transport,generator,folder,image};
}

it('图片上限用满后，没有显式授权就不再有第三次图片请求',async()=>{
 const f=fixture();
 try{
  await expect(f.generator(f.trip,new AbortController().signal)).rejects.toThrow('图片请求已达到两次上限');
  expect(f.transport.mock.calls.filter(c=>c[0]==='image')).toHaveLength(0);
  const saved=JSON.parse(readFileSync(join(f.folder,'checkpoint.json'),'utf8'));
  expect(saved.imageAttempt).toBe(2);
 }finally{rmSync(f.root,{recursive:true,force:true});}
});

it('一次性图片授权只把上限提高到第三次，成功入藏后不再追加请求',async()=>{
 const f=fixture();
 try{
  writeFileSync(join(f.root,'retry-grants.json'),JSON.stringify({schema:1,grants:[{id:'grant-image-1',tripId:f.id,owner:f.jid,stage:'image',kind:'image',createdAt:1,consumedAt:2,consumedBy:f.id}]}));
  const artifact=await f.generator(f.trip,new AbortController().signal);
  expect(f.transport.mock.calls.filter(c=>c[0]==='image')).toHaveLength(1);
  expect(artifact.title).toBe('长椅上的海风');
  const saved=JSON.parse(readFileSync(join(f.folder,'checkpoint.json'),'utf8'));
  expect(saved.imageAttempt).toBe(3);
  const review=JSON.parse(readFileSync(join(f.folder,'image-3-review.json'),'utf8'));
  expect(review.scene_match).toBe(true);
 }finally{rmSync(f.root,{recursive:true,force:true});}
});

it('授权属于本次旅行才生效：同系列其他节点的图片授权不会抬高本趟上限',async()=>{
 const f=fixture();
 try{
  writeFileSync(join(f.root,'retry-grants.json'),JSON.stringify({schema:1,grants:[{id:'other-node',tripId:randomUUID(),owner:f.jid,stage:'image',kind:'image',createdAt:1,consumedAt:2,consumedBy:'other'}]}));
  await expect(f.generator(f.trip,new AbortController().signal)).rejects.toThrow('图片请求已达到两次上限');
  expect(f.transport.mock.calls.filter(c=>c[0]==='image')).toHaveLength(0);
 }finally{rmSync(f.root,{recursive:true,force:true});}
});
