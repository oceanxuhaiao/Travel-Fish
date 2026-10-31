export interface VisiblePaperState {object:'menu'|'guide'|'book';state:'open'|'closed'|'not_applicable'|'uncertain';evidence:string;}
export const PAPER_STATE_PROMPT='另外独立观察图1，不参考故事预案，返回paperStates三项，object分别menu/guide/book，state为open/closed/uncertain，evidence说明可见位置和页片状态。menu是菜单，guide是导览折页/导览册，book是其他书册；同一物件只归最明确一类，无法辨认用途用book。摊开可见内页、翻页、双页张开均open；封面合拢或折叠收起且无内页展开才closed。未出现、遮挡或用途不明的类别用uncertain；不能根据希望合上就报告closed。';
export function validatePaperStates(v:any):asserts v is VisiblePaperState[]{
 if(!Array.isArray(v)||v.length!==3||new Set(v.map(x=>x?.object)).size!==3||v.some(x=>!x||!['menu','guide','book'].includes(x.object)||!['open','closed','uncertain'].includes(x.state)||typeof x.evidence!=='string'||!x.evidence.trim()))throw Error('paperStates须逐项报告menu/guide/book的open/closed/uncertain与可见证据');
}
export function paperStateConflicts(note:string,states:VisiblePaperState[]):string[]{
 const issues:string[]=[];
 const names={menu:'菜单',guide:'导览(?:页|册|折页)|游览(?:图|册)|折页|路线图',book:'书本|书册|册子|这本书|手里的书'};
 for(const sentence of note.split(/[。！？；，]/u)){
  // Explicitly separated earlier actions and negation do not assert the pictured state.
  if(/(?:之前|先前|早先|刚才|起初|原先|原来|本来|曾经|一度|想|准备|打算|没有|没把|未把|不把|没合|没折|还没|不曾|并未)/u.test(sentence))continue;
  for(const s of states){if(s.state==='uncertain'||s.state==='not_applicable')continue;
   if(new RegExp('(?:'+names[s.object]+')','u').test(sentence)){
    const close=/(?:合上|合起|合拢|折起|折好|折拢|收起)/u.test(sentence),open=/(?:摊开|摊在|展开|翻开|打开|翻着)/u.test(sentence);
    if(close&&!open&&s.state==='open')issues.push('文字“'+sentence+'”写纸页合拢/收起，图中'+s.object+'明确展开：'+s.evidence+'。只改为画面兼容的文字或删去该动作，不改图，也不要虚构重新打开来圆场。');
    if(open&&!close&&s.state==='closed')issues.push('文字“'+sentence+'”写纸页展开，图中'+s.object+'明确合拢：'+s.evidence+'。只改文字或删去该动作，不改图。');
   }
  }
 }
 return issues;
}

export interface PaperObservation {
 object:'menu'|'guide'|'book';
 form:'booklet'|'foldout'|'single_sheet'|'display_stand'|'absent'|'unknown';
 visibleInnerPages:boolean|null;
 spreadPanels:boolean|null;
 outerCoverOnly:boolean|null;
 evidence:string;
}
export const PAPER_OBSERVATION_PROMPT='另外独立观察图1，不参考故事预案，返回paperStates三项原始观察，object分别menu/guide/book，每项仅含object、form、visibleInnerPages、spreadPanels、outerCoverOnly、evidence。不直接猜open/closed。先分物理形态form=booklet(装订册)/foldout(可折多页)/single_sheet(单页)/display_stand(立牌、桌牌、展示板)/absent/unknown。用途不清不能因在桌上就假定菜单册。visibleInnerPages=能否看见内页，spreadPanels=是否可见两片或多片展开面板，outerCoverOnly=是否明确只见合拢外封面，三项为true/false/无法确认时null。折痕、竖着拿、只露一侧不是合拢证据；有折痕但两片展开仍是展开；立牌不属于书册开合，单页也没有合拢状态。evidence只写可见位置、页片/折缝/封面等物理证据，不重复预案。未出现类别填absent及三个null；只看见背面或遮挡用unknown或不确定值，不编造封面。';
export function validatePaperObservations(v:any):asserts v is PaperObservation[]{
 if(!Array.isArray(v)||v.length!==3||new Set(v.map(x=>x?.object)).size!==3)throw Error('paperStates须逐项报告menu/guide/book物理观察');
 for(const x of v){
  if(!x||!['menu','guide','book'].includes(x.object)||!['booklet','foldout','single_sheet','display_stand','absent','unknown'].includes(x.form)||!['visibleInnerPages','spreadPanels','outerCoverOnly'].every(k=>x[k]===null||typeof x[k]==='boolean')||typeof x.evidence!=='string'||!x.evidence.trim())throw Error('物理观察须有form、三个boolean/null与具体evidence，不接受直接猜开合');
  if(x.outerCoverOnly===true&&(x.visibleInnerPages===true||x.spreadPanels===true))throw Error('只见外封面与可见内页/展开面板矛盾，请重看同图修正观察，不能重画');
  if(x.form==='absent'&&['visibleInnerPages','spreadPanels','outerCoverOnly'].some(k=>x[k]!==null))throw Error('absent时三个观察值必须为null，不能臆测状态');
 }
}
export function derivePaperStates(observations:PaperObservation[]):VisiblePaperState[]{
 validatePaperObservations(observations);
 return observations.map(o=>{
  let state:VisiblePaperState['state']='uncertain';
  if(o.form==='display_stand')state='not_applicable';
  else if(o.visibleInnerPages===true||o.spreadPanels===true)state='open';
  else if(o.form==='single_sheet')state='not_applicable';
  else if(o.form==='booklet'||o.form==='foldout'){
   if(o.outerCoverOnly===true&&o.visibleInnerPages===false&&o.spreadPanels===false)state='closed';
  }
  return {object:o.object,state,evidence:o.evidence};
 });
}

export const PAPER_REGION_PROMPT='另给paperRegions数组，每项{object:menu|guide|book,box:[左,上,右,下]}框住实际可见的纸页/册子，坐标归一化0至1，无法确认位置就返回空数组，不框不存在物件。用于在同图上局部放大检查，不是新画面。';
export function validatePaperRegions(v:any){if(!Array.isArray(v)||v.length>3||v.some((r:any)=>!r||!['menu','guide','book'].includes(r.object)||!Array.isArray(r.box)||r.box.length!==4||r.box.some((x:any)=>typeof x!=='number'||!Number.isFinite(x)||x<0||x>1)||r.box[2]<=r.box[0]||r.box[3]<=r.box[1]))throw Error('paperRegions须为最多三个有效的归一化矩形，无法定位用[]');}
