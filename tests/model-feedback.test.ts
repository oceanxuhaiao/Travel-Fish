import {it,expect} from 'vitest';
import {generationContract,outputFeedback,decisionContract} from '../src/model-feedback.ts';

it.each([
 ['image-1-review',{scene_match:true,character_match:true,usable:true,background_conflicts:[],issues:[],facts:['树','湖','码头']}],
 ['image-1-note-1',{title:'清晨的湖岸',note:'我在岸边走了一会儿。'}],
 ['image-1-note-1-review',{checks:[],has_explicit_conflict:false,conflicts:[],uncertain_details:[]}],
 ['image-1-note-1-scope',{has_real_place_name:false,names:[]}],
 ['image-1-note-1-story-review',{accepted:true,issues:[]}],
])('%s输出均有成功与失败结构反馈，不把结构通过称为事实通过',(label,value)=>{
 const contract=generationContract(label,true);
 expect(outputFeedback(label,contract,value)).toMatchObject({valid:true,validation:'structure',errors:[]});
 const bad=outputFeedback(label,contract,{});expect(bad.valid).toBe(false);expect(bad.errors[0]).toMatchObject({code:'OUTPUT_CONTRACT',path:label,expected:contract.id});expect(bad.repairInstruction).toContain('不要修改旧卡');
});

it('拒绝评审必须给出原因；明确反证、地名布尔值与清单不能自相矛盾',()=>{
 expect(outputFeedback('review',decisionContract,{accepted:false,issues:[]}).valid).toBe(false);
 expect(outputFeedback('scope',generationContract('note-scope',true),{has_real_place_name:false,names:['杭州']}).valid).toBe(false);
 const value={has_explicit_conflict:false,conflicts:[],uncertain_details:[],checks:[{claim:'蹲下',category:'posture',observation:'坐姿',clear_conflict:true}]};
 expect(outputFeedback('review',generationContract('image-1-note-1-review',true),value).valid).toBe(false);
});
