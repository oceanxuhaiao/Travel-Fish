import {createHash} from 'node:crypto';
import {StoryEngine} from '../src/story.ts';
import {it,expect,vi} from 'vitest';
import {readFileSync,mkdtempSync,rmSync,mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {validateGroundedPlan,validateExpressivePlan,validatePortrayal,portrayalIssues} from '../src/story-quality.ts';
import {TravelService,TravelStore,collectionSceneLabel} from '../src/travel.ts';
import {PostcardPanel} from '../src/panel.ts';
const plans=JSON.parse(readFileSync(new URL('./fixtures/story-candidates.json',import.meta.url),'utf8'));
it('骨架有事件触发的情感、反应与不同朝向动作神态；三张同款或缺少情绪结构会反馈失败',()=>{
 expect(()=>validateExpressivePlan(plans[0])).not.toThrow();
 const a=structuredClone(plans[0]);a.nodes.forEach((n:any)=>n.visualBeat={orientation:'front',action:'站着',expression:'平静'});expect(()=>validateExpressivePlan(a)).toThrow('不能只换背景');
 const b=structuredClone(plans[0]);delete b.nodes[1].emotionalBeat;expect(()=>validateExpressivePlan(b)).toThrow('emotionalBeat');
});
it('按实际看图评估三项全同，不按人物比例拦截；不把背面看不见表情当成同款',()=>{
 const p={orientation:'front',action:'idle',expression:'neutral',subjectHeightRatio:.25};
 expect(portrayalIssues(p,{...p})).toHaveLength(1);
 expect(portrayalIssues({...p,action:'reach'},p)).toHaveLength(0);
 expect(portrayalIssues({...p,subjectHeightRatio:.65})).toHaveLength(0);
 expect(portrayalIssues({...p,expression:'not-visible'},p)).toHaveLength(0);
 expect(()=>validatePortrayal({...p,subjectHeightRatio:65})).toThrow('比例');
});
it('实际服务入口和面板一致：开发5分钟，正式120分钟，不能被系列内部覆盖',async()=>{
 for(const minutes of [5,120]){const root=mkdtempSync(join(tmpdir(),'postcard-timing-'));
  const s=new TravelService(new TravelStore(root),undefined,()=>1000,true,minutes);s.open();
  try{const t=s.startSeries();expect(t.dueAt-t.startedAt).toBe(minutes*60000);const panel=new PostcardPanel(s,()=>({minutes:999,generatorConnected:false}));expect(panel.snapshot().minutes).toBe(minutes);}
  finally{await s.close();rmSync(root,{recursive:true,force:true});}
 }
});

it('旧系列卡不把旧目录标签当成实际场景，新卡用故事地点且不改原记录',()=>{
 const card:any={series:{nodeIndex:1},sceneLabel:'树洞与溪流'};expect(collectionSceneLabel(card)).toBeUndefined();expect(card.sceneLabel).toBe('树洞与溪流');expect(collectionSceneLabel({...card,generation:{storyLocation:'村口晾衣绳旁'}})).toBe('村口晾衣绳旁');expect(collectionSceneLabel({sceneLabel:'旧单卡标签'} as any)).toBe('旧单卡标签');
});

it('grounding缺失和不受控知识依据会反馈失败',()=>{
 const p=structuredClone(plans[0]);expect(()=>validateGroundedPlan(p)).not.toThrow();
 delete p.grounding;expect(()=>validateGroundedPlan(p)).toThrow('覆盖三个节点');
 p.grounding=structuredClone(plans[0].grounding);p.grounding[0].knowledgeClaims=[{statement:'越高风越狠',basis:'invented',evidence:'划沙'}];expect(()=>validateGroundedPlan(p)).toThrow('知识结论');
});
it('开发预审阻止未批准或改动的方案；批准后精确复用方案且不调用模型规划',async()=>{
 const root=mkdtempSync(join(tmpdir(),'postcard-review-')),transport=vi.fn();
 const service=new TravelService(new TravelStore(root),undefined);service.open();
 try{const trip=service.startSeries(),engine=new StoryEngine(service,transport,undefined,true),signal=new AbortController().signal;
  await expect(engine.context(trip,signal)).rejects.toThrow('等待用户预审');expect(transport).not.toHaveBeenCalled();
  mkdirSync(join(root,'development-story-review'),{recursive:true});const file=join(root,'development-story-review/approved-plan.json');
  const plan=structuredClone(plans[0]),planHash=createHash('sha256').update(JSON.stringify(plan)).digest('hex');
  writeFileSync(file,JSON.stringify({approved:false,planHash,plan}));await expect(engine.context(trip,signal)).rejects.toThrow('明确批准');
  writeFileSync(file,JSON.stringify({approved:true,planHash,plan:{...plan,theme:'changed'}}));await expect(engine.context(trip,signal)).rejects.toThrow('哈希');
  writeFileSync(file,JSON.stringify({approved:true,planHash,plan}));const ctx=await engine.context(trip,signal);expect(ctx.planHash).toBe(planHash);expect(ctx.node).toEqual(plan.nodes[0]);expect(transport).not.toHaveBeenCalled();
 }finally{await service.close();rmSync(root,{recursive:true,force:true});}
});
