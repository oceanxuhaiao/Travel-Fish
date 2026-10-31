import {it,expect,vi} from 'vitest';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';import {randomUUID} from 'node:crypto';import {PNG} from 'pngjs';
import {paperStateConflicts,validatePaperStates,type VisiblePaperState} from '../src/visible-state.ts';
import {createCloudGenerator,type Transport} from '../src/generation.ts';import type {Trip} from '../src/travel.ts';
const states=(object:'guide'|'menu'):VisiblePaperState[]=>['menu','guide','book'].map(o=>({object:o as any,state:o===object?'open':'uncertain',evidence:o===object?'明确可见张开的两页':'未见或无法判断'}));
it('明确展开反证合起，否定、先前动作和看不清不强判',()=>{
 expect(paperStateConflicts('我把导览页折起来收进手里，多站了一会儿。',states('guide'))).toHaveLength(1);
 expect(paperStateConflicts('听完就只点小的那份，配一碗汤，把菜单合上。',states('menu'))).toHaveLength(1);
 expect(paperStateConflicts('导览页摊在膝上，我也没折回去。',states('guide'))).toEqual([]);
 expect(paperStateConflicts('刚才把菜单合上了。',states('menu'))).toEqual([]);
 expect(paperStateConflicts('我没有把菜单合上。',states('menu'))).toEqual([]);
 expect(paperStateConflicts('我把菜单合上。',states('guide'))).toEqual([]);
 expect(()=>validatePaperStates([{object:'menu',state:'closed',evidence:'猜的'}])).toThrow('逐项');
});
it.each(['guide','menu'] as const)('实际生成链：%s展开拦截首稿，反馈后只改文字且复用图片',async(object)=>{
 const root=mkdtempSync(join(tmpdir(),'postcard-state-')),png=new PNG({width:512,height:768});png.data.fill(240);const bytes=PNG.sync.write(png),ref=join(root,'ref.png');writeFileSync(ref,bytes);
 const trip:Trip={id:randomUUID(),scene:'coast',series:{id:randomUUID(),mark:'test',nodeIndex:1,total:3},startedAt:0,dueAt:7200000,status:'generating'};let drafts=0;
 const transport=vi.fn<Transport>(async(kind,payload)=>{
  const result=(v:any)=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify(v)}}]});
  if(kind==='image')return {data:[{b64_json:bytes.toString('base64')}]};const p=(payload.messages as any)[0].content[0].text;
  if(p.startsWith('图1为候选'))return result({paperStates:states(object),portrayal:{orientation:'side',action:'sit',expression:'focused',subjectHeightRatio:.6},scene_match:true,character_match:true,usable:true,background_conflicts:[],issues:[],facts:['角色坐在桌边','纸页清晰摊开','桌边有窗户']});
  if(p.startsWith('写桌宠旅行'))return result({title:'先把眼前这页看清',note:++drafts===1?'我坐在桌旁，'+(object==='menu'?'把菜单合上':'把导览页折起来')+'，想着刚才还想把所有地方都走一遍，如今却愿意多停一会儿，先弄清眼前这一小处，倒也不用那么着急了。':'我坐在桌旁，让纸页摊在眼前，想着刚才还想把所有地方都走一遍，如今却愿意多停一会儿，先弄清眼前这一小处，倒也不用那么着急了。'});
  if(p.startsWith('只检查文字'))return result({has_real_place_name:false,names:[]});if(p.startsWith('审核当前短笺'))return result({accepted:true,issues:[]});return result({checks:[],has_explicit_conflict:false,conflicts:[],uncertain_details:[]});
 });
 try{const generator=createCloudGenerator({root,characterReference:ref,styleReference:ref,secret:()=> 'test-only',storyContext:async()=>({policy:'travel-story-v1',journeyId:trip.series!.id,nodeIndex:1,planHash:'fixed',priorHash:'none',priorCards:[],node:{index:1,role:'停留',location:'展馆',event:'看纸页',action:'阅读',payoff:'留下兴趣',visibleScene:'坐在桌旁看展开纸页',composition:'中景',dependencies:[],carryovers:[],nextInterest:null}})},transport);trip.generation=generator.prepare!(trip);const artifact=await generator(trip,new AbortController().signal);
 expect(artifact.generation?.noteAttempt).toBe(2);expect(transport.mock.calls.filter(c=>c[0]==='image')).toHaveLength(1);expect(transport.mock.calls.filter(c=>c[0]==='text'&&(c[1].messages as any)[0].content[0].text.startsWith('写桌宠旅行'))[1][1].messages).toEqual(expect.any(Array));
 const second=(transport.mock.calls.filter(c=>c[0]==='text'&&(c[1].messages as any)[0].content[0].text.startsWith('写桌宠旅行'))[1][1].messages as any)[0].content[0].text;expect(second).toContain('VISIBLE_PAPER_STATE_CONFLICT');expect(second).toContain('不改图');expect(artifact.generation?.visualEvidence).toHaveProperty('paperStates');
 const calls=transport.mock.calls.length;await generator(trip,new AbortController().signal);expect(transport).toHaveBeenCalledTimes(calls);
 }finally{rmSync(root,{recursive:true,force:true});}
});
