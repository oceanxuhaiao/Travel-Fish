import {createHash} from 'node:crypto';
import {COAST_VARIANTS} from './content.ts';
export const SCENES=['forest','coast','snow','lake','valley','dunes','flowers','waterside'] as const;
export type Scene=typeof SCENES[number];
export type Destination=Scene|'surprise';
export const SCENE_LABELS:Record<Scene,string>={forest:'萤光森林',coast:'海岸',snow:'雪夜小镇',lake:'湖畔',valley:'山谷',dunes:'沙丘',flowers:'花田',waterside:'水边小镇'};
export const CATALOG_VERSION='imagined-scenes-v3';
export interface ScenePlan {id:string;scene:Scene;label:string;subject:string;composition:string;moods:string[];core:string;optional:string;conflicts:string;}
export interface SceneSnapshot extends ScenePlan {catalogVersion:string;mood:string;moment?:string;visualVariation?:VisualVariation;prompt:string;recentScenes:Scene[];recentVariants:string[];}
const plan=(scene:Scene,id:string,label:string,subject:string,composition:string,moods:string[],core:string,optional:string,conflicts:string):ScenePlan=>({scene,id,label,subject,composition,moods,core,optional,conflicts});
export const SCENE_PLANS:readonly ScenePlan[]=[
 plan('forest','forest-hollow','树洞与溪流','苔藓老树与蕨叶间的浅溪，角色位于树旁','溪流由前景弯入树后，树干偏左',['暮色微光','雨后薄雾'],'树木占主景，有明显林间纵深','萤光、蕨叶、落叶','开阔海滩、沙漠主景、城市街道'),
 plan('forest','forest-canopy','树冠间的小路','高大树冠下蜿蜒的林间小路，角色在小路一侧','抬高视点，树冠框住上方，小路沿对角线深入',['斑驳午后光','清晨轻雾'],'树林与林间路径','蘑菇、苔藓、细小光点','海滩、大片沙漠、城市街道'),
 plan('forest','forest-clearing','林中空地','森林环抱的柔软草地，角色位于空地边缘','开阔中心留白，远处层叠树影，角色偏左下',['日落前的柔光','晴朗清晨'],'林中空地与环绕树林','野花、倒木、萤光','海水岸线、大片积雪、沙漠'),
 ...COAST_VARIANTS.map(v=>plan('coast',v.id,({ 'tide-pools':'岩岸潮池','lighthouse-meadow':'灯塔草坡','coastal-boardwalk':'海边栈道','shell-dunes':'海草沙丘','sunset-rock-arch':'暮色海拱','sheltered-cove':'环抱海湾'} as Record<string,string>)[v.id],v.prompt,'遵循本方案的独立构图，不搬用风格参考背景',['保持方案所述光照'],'海水与海岸关系清楚','贝壳、海草、小水洼','内陆沙漠主景、积雪街道')),
 plan('snow','snow-window','雪街窗灯','积雪小镇街道和温暖橱窗，角色位于街边','斜向街道进入远处，窗光位于画面一侧',['蓝紫雪夜','轻雪初夜'],'夜色中的积雪建筑街道','长椅、杯子、细小雪花','晴日海滩、沙漠、无雪夏日街景'),
 plan('snow','snow-square','雪夜小广场','小镇积雪广场和低矮屋顶，角色在前景边缘','俯看小广场，建筑环抱留白中心',['月光下的静夜','飘雪黄昏入夜'],'夜色、积雪与小镇建筑','路灯、小树、足迹','海滩、沙漠、白昼夏日'),
 plan('snow','snow-lane','坡上的雪巷','积雪石阶和顺坡层叠的小屋，角色靠近下方巷口','石阶从右下折向左上，屋顶形成纵深',['深蓝夜色与窗灯','薄雪初夜'],'积雪小镇巷道与夜色','栏杆、窗灯、细雪','热带海景、沙漠、无雪夏日'),
 plan('lake','lake-reeds','芦苇浅湾','宁静湖面与岸边芦苇，角色位于近岸','芦苇由左下框景，湖面留出宽阔空间',['晨雾','柔和晚霞'],'内陆平静水域与岸线','芦苇、小石、远山','明显海浪、海岸灯塔、沙漠主景'),
 plan('lake','lake-jetty','湖边木码头','短木码头伸入安静湖面，角色在近岸码头边','木码头斜向深入，远岸层叠，避免水平沙滩构图',['澄澈清晨','雨后微光'],'平静湖面及近岸空间','木码头、岸树、远山','大海巨浪、积雪街道、沙漠'),
 plan('lake','lake-hills','山影环湖','低缓山丘环抱清亮湖泊，角色在前景草岸','较高视点，弯曲湖岸环抱中景',['清爽午后','浅淡黄昏'],'被陆地环绕的湖水与岸边','草坡、野花、倒影','开阔海岸灯塔、密集城市、沙漠'),
 plan('valley','valley-stream','溪谷小径','山坡之间的溪谷和狭窄草径，角色在溪边小路','溪水由前景曲折通向远山，两坡形成纵深',['清晨轻雾','雨后透光'],'山坡夹出的谷地空间','溪流、小石、草花','海平线、沙漠主景、城市街道'),
 plan('valley','valley-overlook','高处望山谷','开阔山谷与层叠远山，角色位于安全的前景缓坡','高处远眺，前景草坡偏右，谷地占大部分画面',['浅金色黄昏','晴朗清晨'],'山地起伏与可见谷地','草地、细小山径、云影','海景、城市广场、大片沙丘'),
 plan('valley','valley-bridge','谷底的小桥','柔软山坡间的浅溪与简朴小木桥，角色在近岸','低视点斜望桥与溪，坡地向两侧展开',['阴天柔光','午后斑驳阳光'],'谷地中的溪流和坡地','小木桥、蕨草、碎石','海岸、沙漠、现代都市'),
 plan('dunes','dunes-ridges','沙脊的曲线','连绵柔软沙丘和清楚的沙脊，角色在前景低缓沙坡','高低沙脊形成S曲线，远景留白',['日落前柔光','浅淡清晨'],'以干燥沙丘地貌为主，无海水','风纹、稀疏耐旱草、足迹','海水、湖面、湿润森林、积雪街道'),
 plan('dunes','dunes-shade','沙丘背面的阴影','明暗相间的沙坡，角色在低矮沙丘阴影旁','侧向近景沙坡与远处开阔地平线',['淡桃黄昏','清晨侧光'],'内陆沙地与起伏沙丘','碎石、细小干草、风纹','大海、绿洲湖泊、茂密树林、雪景'),
 plan('dunes','dunes-distance','远处的沙海','开阔沙丘间的低缓通道，角色小小身影融入环境','通道由左下引向远方，天空与沙丘通透留白',['清亮早晨','浅紫暮色'],'沙丘为主的干燥开阔环境','风纹、小石、淡云','海岸线、河流、湖泊、森林主景'),
 plan('flowers','flowers-path','花田里的小路','大片高低错落花田与窄小土路，角色在小路一侧','小路弯入花丛，近处花朵略大，远处层次柔和',['明亮清晨','柔和午后'],'成片花卉构成主要环境','蝴蝶、篱笆、远树','积雪主景、荒漠、海岸主景'),
 plan('flowers','flowers-hill','开花的小坡','柔软起伏的开花草坡，角色位于坡下','斜坡由左下向右上延展，天空留白',['浅金黄昏','雨后明亮天光'],'成片花卉与草坡','小径、野草、淡云','雪地、大片裸沙、城市街道'),
 plan('flowers','flowers-fence','篱笆边的花海','低矮木篱笆旁延伸的花田，角色在篱笆开口边','木篱笆斜向引导视线，花田向远处展开',['清晨露光','柔和晚霞'],'花田占画面主要部分','木篱笆、小门、远处小屋','雪景、沙漠、繁忙城市主景'),
 plan('waterside','waterside-bridge','雨后的石桥','白墙小屋与河道间的简朴石桥，角色在近岸','低视点斜望河道，桥在中景，建筑沿水展开',['雨后柔光','清晨薄雾'],'小镇建筑与河道共同构成主景','石桥、窗灯、盆栽','海滩巨浪、沙漠、积雪夜街'),
 plan('waterside','waterside-dock','黄昏的小码头','临水小屋与小小停靠处，角色在岸边','岸线从右下弯向左远处，水面倒影占中景',['暖色黄昏','阴天傍晚'],'小镇建筑与内河水域','木码头、停泊小船、灯光','开阔海岸、沙漠主景、积雪街道'),
 plan('waterside','waterside-alley','晨雾河巷','窄河两侧低矮小屋与临水巷道，角色在近处巷口','从巷口向河道望去，屋檐框住上部',['清晨薄雾','雨后午后'],'临河建筑、巷道与河水','小阶、窗台植物、微弱倒影','现代高楼主景、沙漠、雪景、开阔海滩'),
];
const seed=(s:string)=>createHash('sha256').update(s).digest().readUInt32BE(0);
export function chooseScene(id:string,recent:readonly Scene[]=[]):Scene {
 const last=recent.slice(0,12);const excluded=new Set(last.slice(0,2));
 const available=SCENES.filter(s=>!excluded.has(s));
 const minimum=Math.min(...available.map(s=>last.filter(r=>r===s).length));
 const balanced=available.filter(s=>last.filter(r=>r===s).length===minimum);
 return balanced[seed('scene:'+id)%balanced.length];
}
export interface VisualVariation {version:'postcard-framing-v1';orientation:'front'|'side'|'three-quarter-back';action:'pause'|'sit'|'walk';framing:'wide'|'medium-wide';id:string;reason?:'history-relaxed'|'safe-default';}
export const ALLOWED_ACTIONS:Readonly<Record<string,readonly VisualVariation['action'][]>>={
 'forest-hollow':['pause','sit','walk'],'forest-canopy':['pause','walk'],'forest-clearing':['pause','sit','walk'],
 'tide-pools':['pause','walk'],'lighthouse-meadow':['pause','sit','walk'],'coastal-boardwalk':['pause','walk'],'shell-dunes':['pause','sit','walk'],'sunset-rock-arch':['pause','walk'],'sheltered-cove':['pause','walk'],
 'snow-window':['pause','walk'],'snow-square':['pause','sit','walk'],'snow-lane':['pause','walk'],
 'lake-reeds':['pause','sit','walk'],'lake-jetty':['pause','walk'],'lake-hills':['pause','sit','walk'],
 'valley-stream':['pause','walk'],'valley-overlook':['pause','sit','walk'],'valley-bridge':['pause','walk'],
 'dunes-ridges':['pause','sit','walk'],'dunes-shade':['pause','sit','walk'],'dunes-distance':['pause','sit','walk'],
 'flowers-path':['pause','walk'],'flowers-hill':['pause','sit','walk'],'flowers-fence':['pause','walk'],
 'waterside-bridge':['pause','walk'],'waterside-dock':['pause','walk'],'waterside-alley':['pause','walk'],
};
export function chooseVisualVariation(tripId:string,planId:string,recent:readonly VisualVariation[]=[]):VisualVariation {
 const actions=ALLOWED_ACTIONS[planId];if(!actions)return {version:'postcard-framing-v1',orientation:'side',action:'pause',framing:'wide',id:'side-pause-wide',reason:'safe-default'};
 const candidates:VisualVariation[]=[];
 for(const orientation of ['front','side','three-quarter-back'] as const)for(const action of actions)for(const framing of ['wide','medium-wide'] as const)candidates.push({version:'postcard-framing-v1',orientation,action,framing,id:[orientation,action,framing].join('-')});
 const history=recent.filter(v=>v?.version==='postcard-framing-v1'&&typeof v.id==='string').slice(0,6);
 let exclusions=history.slice(0,2),available=candidates.filter(v=>!exclusions.some(h=>h.id===v.id)),relaxed=false;
 while(!available.length&&exclusions.length){exclusions=exclusions.slice(0,-1);relaxed=true;available=candidates.filter(v=>!exclusions.some(h=>h.id===v.id));}
 const last=history[0],different=last?available.filter(v=>v.orientation!==last.orientation||v.action!==last.action):available;
 if(different.length)available=different;
 const selected={...available[seed('framing-v1:'+tripId)%available.length]};if(relaxed)selected.reason='history-relaxed';return selected;
}
export function variationPrompt(v:VisualVariation):string {
 const orientation={front:'正面自然看向风景，视线不必朝向镜头',side:'轻微侧面，看向身旁风景', 'three-quarter-back':'轻微侧背面看向远处，露出部分侧脸，保留参考图的发型、头饰或其他独特配件与服装辨识，不用完全背影'}[v.orientation];
 const action={pause:'在安全平坦位置停下看风景，站姿放松',sit:'在安全平坦草地、岸边空地或低缓沙地坐下休息，不坐栏杆或阶梯边缘',walk:'沿本场景安全平缓路径缓步经过，不涉水、不攀爬'}[v.action];
 const framing=v.framing==='wide'?'全景，人物含帽约占画面高度18%至25%':'中远景，人物含帽约占画面高度25%至33%';
 return orientation+'；'+action+'；'+framing+'，风景主导。保留原场景的位置、视点与景观构图。图1仅提供身份与服装特征，不照搬其站姿和视线方向，按本次镜头建议重新安排人物';
}
export function freezeScene(id:string,scene:Scene,recentScenes:Scene[]=[],recentVariants:string[]=[],recentVisual:readonly VisualVariation[]=[]):SceneSnapshot {
 const plans=SCENE_PLANS.filter(p=>p.scene===scene);if(!plans.length)throw Error('未知旅行环境');
 let history=recentVariants.filter(v=>plans.some(p=>p.id===v)).slice(0,5);
 let available=plans.filter(p=>!history.includes(p.id));
 while(!available.length){history=history.slice(0,-1);available=plans.filter(p=>!history.includes(p.id));}
 const selected=available[seed('variant:'+id)%available.length];const mood=selected.moods[seed('mood:'+id)%selected.moods.length];
 const visualVariation=chooseVisualVariation(id,selected.id,recentVisual);
 const moment=variationPrompt(visualVariation);
 const prompt=selected.subject+'。构图：'+selected.composition+'。氛围：'+mood+'。核心景观：'+selected.core+'。可有可无的装饰：'+selected.optional+'。不要出现：'+selected.conflicts+'。角色自然姿态建议：'+moment+'，不作为必须逐项兑现的动作要求。地点完全虚构，不模仿或标注具体真实地名，不画任何文字。角色姿态自然，具体手势不作硬要求。';
 return {...structuredClone(selected),catalogVersion:CATALOG_VERSION,mood,moment,visualVariation,prompt,recentScenes:recentScenes.slice(0,12),recentVariants:recentVariants.slice(0,5)};
}
