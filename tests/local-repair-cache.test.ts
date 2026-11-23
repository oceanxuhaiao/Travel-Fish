import {it,expect,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,rmSync,unlinkSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PNG} from 'pngjs';
import {createCloudGenerator,type Transport} from '../src/generation.ts';
import {HostModelBridge} from '../src/host-model.ts';
import type {StoryContext} from '../src/journey-types.ts';
import type {Trip} from '../src/travel.ts';
import {FakeHost} from './helpers/fake-host.ts';

const response=(v:unknown)=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify(v)}}]});
const portrait={orientation:'side',action:'sit',expression:'focused',subjectHeightRatio:.75};

/** Answers match the prompt the generator actually sent, so the host submissions pass the same contracts. */
const transport=vi.fn<Transport>(async(kind,payload)=>{
 if(kind==='image')return {data:[{b64_json:PNG.sync.write(new PNG({width:512,height:768})).toString('base64')}]};
 const p=(payload.messages as any[])[0].content[0].text as string;
 if(p.startsWith('图1为候选'))return response({paperRegions:[],paperStates:[{object:'menu',form:'absent',visibleInnerPages:null,spreadPanels:null,outerCoverOnly:null,evidence:'未见菜单'},{object:'guide',form:'absent',visibleInnerPages:null,spreadPanels:null,outerCoverOnly:null,evidence:'未见导览页'},{object:'book',form:'absent',visibleInnerPages:null,spreadPanels:null,outerCoverOnly:null,evidence:'无书册'}],portrayal:portrait,scene_match:true,character_match:true,usable:true,background_conflicts:[],issues:[],facts:['女孩坐在长椅上','远处有海面','旁边有木栏']});
 if(p.startsWith('写桌宠旅行'))return response({title:'长椅上的海风',note:'我在长椅上坐下来，听了一会儿风，海面一直没有停。没有急着赶路，能这样坐一会儿，心里就慢慢安静下来。'});
 if(p.startsWith('只检查文字'))return response({has_real_place_name:false,names:[]});
 if(p.startsWith('审核当前短笺'))return response({accepted:true,issues:[]});
 return response({checks:[],has_explicit_conflict:false,conflicts:[],uncertain_details:[]});
});

function fixture(){
 const root=mkdtempSync(join(tmpdir(),'local-cache-')),png=new PNG({width:512,height:768});png.data.fill(230);
 const image=PNG.sync.write(png),ref=join(root,'ref.png');writeFileSync(ref,image);
 const id=randomUUID(),jid=randomUUID();
 const trip:Trip={id,scene:'coast',series:{id:jid,mark:'旅迹·test',nodeIndex:1,total:3},startedAt:0,dueAt:7200000,status:'generating'};
 const ctx:StoryContext={policy:'travel-story-v1',journeyId:jid,nodeIndex:1,planHash:'fixed-plan',priorHash:'no-prior',priorCards:[],node:{index:1,role:'歇脚',location:'海边长椅',event:'坐下看海',action:'坐着听风',payoff:'缓一口气',visibleScene:'海边长椅旁，大肥鱼坐着看海',composition:'侧向中景',dependencies:[],carryovers:[],nextInterest:null}};
 const bridge=new HostModelBridge(join(root,'host-tasks'),5000,join(root,'retry-grants.json')),host=new FakeHost();
 host.modelFacts.accepts=()=>true;bridge.attach(host);
 const generator=createCloudGenerator({root,characterReference:ref,styleReference:ref,secret:()=> 'test-only',storyContext:async()=>ctx,
  useHostModel:true,hostTransport:bridge.transport,hostReady:()=>bridge.ready()},transport);
 trip.generation=generator.prepare!(trip);
 return {root,id,trip,generator,bridge,host,image};
}

/** Plays the host model: submits whatever the mock transport would have answered for the task it was handed. */
async function play(run:Promise<any>,host:FakeHost,bridge:HostModelBridge,root:string){
 let seen=0;const settled=run.then(v=>({ok:true,value:v}),e=>({ok:false,error:String(e)}));
 for(;;){
  const quick=await Promise.race([settled,new Promise(r=>setTimeout(()=>r(undefined),20))]);
  if(quick)return quick as {ok:boolean;value?:any;error?:string};
  while(seen<host.events.length){
   const id=String(host.events[seen++].text).match(/taskId=([a-f0-9]{64})/)![1];
   const task=JSON.parse(readFileSync(join(root,'host-tasks',id+'.json'),'utf8'));
   const reply=await transport('text',task.payload,new AbortController().signal) as any;
   const answer=reply.choices[0].message.content as string;
   const out=bridge.submit(id,id,answer);
   if(!out.accepted)throw Error(task.label+' 提交被拒：'+JSON.stringify(out.feedback.errors));
  }
 }
}

it('制作文字的本地修复会回放已保存的宿主结果：不新建任务、不增计数、不发事件',async()=>{
 const f=fixture();
 try{
  const first=await play(f.generator(f.trip,new AbortController().signal),f.host,f.bridge,f.root);
  expect(first.ok).toBe(true);
  const eventsAfterFirst=f.host.events.length;
  expect(eventsAfterFirst).toBeGreaterThan(0);
  const folder=join(f.root,'trips',f.id);
  const checkpoint=()=>JSON.parse(readFileSync(join(folder,'checkpoint.json'),'utf8'));
  const counts=JSON.stringify(checkpoint().textRequests);
  const written=readdirSync(folder).filter(n=>/^image-1-(review|note-[^.]*)\.json$/.test(n)&&!/-request\.json$/.test(n));
  expect(written.length).toBeGreaterThan(0);

  // A newer repairer is asked to redo the text stages; the saved JSON files are gone but the paid host tasks remain.
  for(const name of written)unlinkSync(join(folder,name));
  expect(existsSync(join(folder,'image-1-review.json'))).toBe(false);
  f.trip.localRetry=true;

  const second=await play(f.generator(f.trip,new AbortController().signal),f.host,f.bridge,f.root);
  expect(second.ok).toBe(true);
  expect(second.value.title).toBe('长椅上的海风');
  expect(f.host.events).toHaveLength(eventsAfterFirst);
  expect(JSON.stringify(checkpoint().textRequests)).toBe(counts);
  for(const name of written)expect(existsSync(join(folder,name)),name).toBe(true);
  expect(JSON.parse(readFileSync(join(folder,'image-1-review-request.json'),'utf8')).model).toBe('host-model');
 }finally{rmSync(f.root,{recursive:true,force:true});}
});

it('宿主任务确实不存在时才报“无法本地恢复”，且计数不变',async()=>{
 const f=fixture();
 try{
  const folder=join(f.root,'trips',f.id);mkdirSync(folder,{recursive:true});
  writeFileSync(join(folder,'checkpoint.json'),JSON.stringify({schema:1,imageAttempt:0,pendingImage:false,stage:'',textRequests:{},errors:[]}));
  f.trip.localRetry=true;
  const outcome=f.generator(f.trip,new AbortController().signal).then(()=>({ok:true,error:''}),e=>({ok:false,error:String(e)}));
  const settled=await outcome;
  expect(settled.ok).toBe(false);
  // The image stage runs first and has nothing saved either, so the repair stops there without a call.
  expect(settled.error).toContain('没有可复用的候选图');
  expect(f.host.events).toHaveLength(0);
  const saved=JSON.parse(readFileSync(join(folder,'checkpoint.json'),'utf8'));
  expect(saved.imageAttempt).toBe(0);
  expect(saved.textRequests).toEqual({});
 }finally{rmSync(f.root,{recursive:true,force:true});}
});
