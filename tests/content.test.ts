import {it,expect} from 'vitest';
import {selectCoastVariant,COAST_VARIANTS,LEGACY_POLICY,notePrompt} from '../src/content.ts';
import {textReviewPrompt} from '../src/generation.ts';
it('海岸连续六趟不重复，重启仅凭收藏中的近期构图即可避重',()=>{
 const recent:string[]=[];for(let i=0;i<6;i++){const v=selectCoastVariant('trip-'+i,recent);expect(recent).not.toContain(v.id);recent.unshift(v.id);}
 expect(new Set(recent).size).toBe(COAST_VARIANTS.length);
 const afterRestart=selectCoastVariant('next',JSON.parse(JSON.stringify(recent)));expect(recent.slice(0,5)).not.toContain(afterRestart.id);
 expect(selectCoastVariant('same',recent)).toEqual(selectCoastVariant('same',recent));
});
it('未知和历史空构图不消耗避重名额，各构图均明确排除沙堡复制',()=>{
 expect(selectCoastVariant('trip',['legacy','',...COAST_VARIANTS.slice(0,5).map(v=>v.id)]).id).toBe(COAST_VARIANTS[5].id);
 for(const v of COAST_VARIANTS)expect(v.prompt).toContain('不要沙堡');
});
it('新短笺只用背景锚点，旧策略提示保持原样且审核不按姿态关键词一律拒绝',()=>{
 const prompt=notePrompt(['女孩坐在苔藓上','溪流穿过树影'],['旧标题'],'温柔问候');
 expect(prompt).not.toContain('女孩坐在苔藓上');expect(prompt).toContain('溪流穿过树影');expect(prompt).toContain('不要写自己坐');expect(prompt).toContain('不声称用户怕冷');
 const legacy=notePrompt(['女孩坐在苔藓上'],[]);expect(legacy).toContain('女孩坐在苔藓上');expect(legacy).not.toContain('不要写自己坐');
 expect(textReviewPrompt({note:'我蹲在这里'})).toContain('双腿向前');
 expect(textReviewPrompt({note:'我蹲在这里'},LEGACY_POLICY)).not.toContain('双腿向前');
 expect(textReviewPrompt({note:'海风轻轻'})).toContain('不要将未能证明的内容当成矛盾');
});
