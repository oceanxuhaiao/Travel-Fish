import {it,expect,vi} from 'vitest';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {StoryEngine,validateStoryReview} from '../src/story.ts';
import {objectContract,outputFeedback} from '../src/model-feedback.ts';
import {PipelineError} from '../src/generation.ts';
import {TravelService,TravelStore} from '../src/travel.ts';
import {PostcardPanel} from '../src/panel.ts';
const plans=JSON.parse(readFileSync(new URL('./fixtures/story-candidates.json',import.meta.url),'utf8'));
const dimensions=['detail','agency','connection','standalone_payoff','visual','novelty','naturalness'];
const review=()=>({reviews:plans.map((p:any)=>({candidateId:p.id,candidateVersion:p.version,historyIds:[],ruleIssues:[],decision:'accept',ratings:dimensions.map(d=>({dimension:d,score:d==='novelty'?null:2,reason:'具体依据'}))}))});
const contract=objectContract('story-review-seven-dimensions-v1',v=>validateStoryReview(v,plans,[]));
it('empty-history novelty errors identify the exact field and expected null without correcting the model',()=>{
 const v=review();v.reviews[0].ratings[5].score=0;const feedback=outputFeedback('review',contract,v);
 expect(feedback.errors[0]).toMatchObject({path:'reviews[0].ratings[5].score',expected:'null'});
 expect(feedback.errors[0].message).toContain('不是0或其他数字');expect(v.reviews[0].ratings[5].score).toBe(0);
 expect(outputFeedback('review',contract,review()).valid).toBe(true);
});
it('other rating errors identify reason, dimension and integer score fields',()=>{
 for(const [field,value,expected] of [['reason','','非空说明字符串'],['score',4,'0至3的整数']] as const){const v=review();(v.reviews[0].ratings[0] as any)[field]=value;expect(outputFeedback('review',contract,v).errors[0]).toMatchObject({path:'reviews[0].ratings[0].'+field,expected});}
 const v=review();v.reviews[0].ratings[0].dimension='unknown';expect(outputFeedback('review',contract,v).errors[0].path).toBe('reviews[0].ratings[0].dimension');
});
it('exhausted host errors survive story and travel layers into the panel without falling through to another plan',async()=>{
 const root=mkdtempSync(join(tmpdir(),'story-exhausted-'));let engine:StoryEngine;
 const s=new TravelService(new TravelStore(root),async(t,signal)=>{await engine.context(t,signal);throw Error('must stop');},()=>1000,true);s.open();
 engine=new StoryEngine(s,vi.fn());const call=vi.fn(async()=>{throw new PipelineError('本阶段两次结构提交已耗尽');});(engine as any).call=call;
 try{s.startSeries();await s.tick();const panel=new PostcardPanel(s,()=>({minutes:120,generatorConnected:true}));expect(panel.snapshot().trip?.error).toBe('本阶段两次结构提交已耗尽');expect(call).toHaveBeenCalledTimes(1);expect(s.store.cards()).toHaveLength(0);}
 finally{await s.close();rmSync(root,{recursive:true,force:true});}
});
