export interface VisiblePaperState {object:'menu'|'guide'|'book';state:'open'|'closed'|'uncertain';evidence:string;}
export const PAPER_STATE_PROMPT='另外独立观察图1，不参考故事预案，返回paperStates三项，object分别menu/guide/book，state为open/closed/uncertain，evidence说明可见位置和页片状态。menu是菜单，guide是导览折页/导览册，book是其他书册；同一物件只归最明确一类，无法辨认用途用book。摊开可见内页、翻页、双页张开均open；封面合拢或折叠收起且无内页展开才closed。未出现、遮挡或用途不明的类别用uncertain；不能根据希望合上就报告closed。';
export function validatePaperStates(v:any):asserts v is VisiblePaperState[]{
 if(!Array.isArray(v)||v.length!==3||new Set(v.map(x=>x?.object)).size!==3||v.some(x=>!x||!['menu','guide','book'].includes(x.object)||!['open','closed','uncertain'].includes(x.state)||typeof x.evidence!=='string'||!x.evidence.trim()))throw Error('paperStates须逐项报告menu/guide/book的open/closed/uncertain与可见证据');
}
export function paperStateConflicts(note:string,states:VisiblePaperState[]):string[]{
 const issues:string[]=[];
 const names={menu:'菜单',guide:'导览(?:页|册|折页)|游览(?:图|册)',book:'书(?:本|册)?|册子'};
 for(const sentence of note.split(/[。！？；，]/u)){
  // Explicitly separated earlier actions and negation do not assert the pictured state.
  if(/(?:之前|先前|早先|刚才|起初|原先|原来|本来|曾经|一度|想|准备|打算|没有|没把|未把|不把|没合|没折|还没|不曾|并未)/u.test(sentence))continue;
  for(const s of states){if(s.state==='uncertain')continue;
   if(new RegExp('(?:'+names[s.object]+')','u').test(sentence)){
    const close=/(?:合上|合起|合拢|折起|折好|折拢|收起)/u.test(sentence),open=/(?:摊开|摊在|展开|翻开|打开|翻着)/u.test(sentence);
    if(close&&!open&&s.state==='open')issues.push('文字“'+sentence+'”写纸页合拢/收起，图中'+s.object+'明确展开：'+s.evidence+'。只改为画面兼容的文字或删去该动作，不改图，也不要虚构重新打开来圆场。');
    if(open&&!close&&s.state==='closed')issues.push('文字“'+sentence+'”写纸页展开，图中'+s.object+'明确合拢：'+s.evidence+'。只改文字或删去该动作，不改图。');
   }
  }
 }
 return issues;
}
