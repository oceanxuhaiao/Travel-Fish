/** 40 pre-labelled controls, official cloud transport and identical production review. */
import {readFileSync,mkdirSync,existsSync,renameSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {cloudTransport,textReviewPrompt,textAccepted,VISION_MODEL,POLICY} from '../src/generation.ts';
import {atomicJson} from '../src/travel.ts';
const arg=(n:string)=>{const i=process.argv.indexOf('--'+n);if(i<0)throw Error('Missing '+n);return process.argv[i+1];};
const out=resolve(arg('out')),source=resolve(arg('source'));mkdirSync(out,{recursive:true});
const env=readFileSync(arg('vision-key-file'),'utf8').replace(/^\uFEFF/,'');
const line=env.split(/\r?\n/).find(x=>x.trim().startsWith('DEEPSEEK_API_KEY='));if(!line)throw Error('Missing credential');
const key=line.trim().slice('DEEPSEEK_API_KEY='.length).trim().replace(/^['"]|['"]$/g,'');
const transport=cloudTransport({root:out,characterReference:'',styleReference:'',secret:()=>key,visionProxyUrl:arg('vision-proxy')});
const sources={coast:'8af27c29-50a4-493e-989e-b5848013fca1',forest:'6862cc38-3aa8-487b-8ed8-d55a4145598b',snow:'f62d0ce6-349b-47a7-a712-d81cdfc3f436'};
// Expected labels fixed by direct developer-side visual inspection before calls.
// Coast: seated on sand, shell in hand, ocean/crab/sandcastle, clear sky.
// Forest: seated in mossy tree hollow, open visible hands, stream/ferns.
// Snow: seated wooden bench, both hands holding pale cup, snowy town/warm windows.
const wrong={
 coast:[['此刻我身在覆满积雪的小镇街上，坐在面包店橱窗外的长椅上。','海岸没有雪镇/长椅'],['此刻我坐在密林老树的树洞里，身边是苔藓和林间小溪。','海岸与树洞森林相反'],['此刻我正双脚着地直立在沙滩上，双腿伸直站着看海。','清晰坐姿与直立相反'],['此刻我双手把一把完全展开的大雨伞举在头顶，伞面盖住了头上的天空。','清晰头顶与双手不兼容大伞'],['此刻我把一把大吉他横抱在胸前，双手按着琴身弹奏。','可见胸前/双手没有大吉他'],['此刻我整个人仰面平躺在沙滩上，后背贴地，脸朝天空。','清晰坐姿与平躺相反'],['此刻我骑坐在一辆自行车的坐垫上，双手握住面前的车把。','完整人物/周边不兼容自行车']],
 forest:[['此刻我坐在海边的沙滩上，面前就是沙堡和一只红螃蟹。','森林与海岸相反'],['此刻我坐在积雪街道的长椅上，背后是亮着灯的面包店橱窗。','森林与雪镇相反'],['此刻我双脚踩地站得笔直，双膝伸直，身体竖立在树旁。','清晰坐姿与直立相反'],['此刻我双手端着一把展开的大雨伞，伞面正罩住我的鲸鱼帽。','可见手和帽顶不兼容大伞'],['此刻我双手把一把大提琴抱在身前，琴身挡住了我的整件裙子。','清晰身前没有大提琴'],['此刻我面朝下趴在地上，全身伸直，肚子紧贴地面。','树洞坐姿与俯卧相反'],['此刻我正骑在一匹高大的白马上，双手拉着面前的缰绳。','可见人物和树洞不兼容骑马']],
 snow:[['此刻我坐在晴日海岸的沙滩上，眼前海浪拍着沙堡。','雪镇与晴日海岸相反'],['此刻我躲在森林的老树洞里，脚旁只有苔藓和林间溪流。','雪镇与树洞森林相反'],['此刻我双脚着地站得笔直，两条腿完全伸直站在长椅旁。','清晰长椅坐姿与直立相反'],['此刻我双手举着一把完全展开的大雨伞，伞面盖住头顶。','可见双手持杯与大伞相反'],['此刻我怀里横抱着一把大吉他，双手正拨着弦。','清晰双手持杯不兼容吉他'],['此刻我整个人平躺在长椅上，头枕着椅端，双腿伸直。','清晰坐姿与平躺相反']],
};
const right={
 coast:['海风轻轻吹过，像把远方的问候送到了耳边。','浪声一遍遍响起，心里那些小小的烦恼也慢慢散开。','空气里仿佛有一点咸味，忽然很想把这片蓝寄给你。','云朵像松软的糖，我把想念悄悄藏进天边。','今天的海边让心情轻了许多，盼你也能有这样一刻。','我刚刚轻轻叹了口气，又开始期待回去见你的时候。','沙子摸起来暖暖的，陪着小沙堡待一会儿，时间也慢下来。'],
 forest:['林间似乎有风，叶子低低说着只有自己才懂的话。','溪水的声音让我放松下来，好像所有牵挂都有了落脚处。','空气里带着草木的清香，想把这份安宁分一点给你。','树洞像一封没有写完的信，把我轻轻收在怀里。','不知道你现在在做什么，我在树影里偷偷想了你一会儿。','刚才似乎听见远处有鸟叫，心情也跟着亮起来。','苔藓仿佛很柔软，连停下来的片刻都变得温柔了。'],
 snow:['捧着杯子，仿佛连心里的小角落也暖了一点，想把温柔寄给你。','风有些凉，橱窗的光却让我想到回家时有人等待的安心。','似乎闻到了面包的香气，忽然想和你说一声，我很好。','雪夜像一条柔软的毯子，把小镇和我的想念一起盖住。','远处仿佛传来轻轻的脚步声，我开始期待下一段路。','热饮尝起来应该甜甜的，就像惦记着你的心情。'],
};
const cases:any[]=Object.keys(sources).flatMap(scene=>[
 ...wrong[scene as keyof typeof wrong].map(([note,evidence])=>({scene,note,expectedConflict:true,evidence})),
 ...right[scene as keyof typeof right].map(note=>({scene,note,expectedConflict:false,evidence:'感受/比喻/风声气味温度或不确定细节，不与可见场景姿态道具相反'})),
]).map((c,i)=>({...c,id:String(i+1).padStart(2,'0')}));
if(process.argv.includes('--pose-source')){
 const regression=resolve(arg('pose-source'));
 for(const [scene,index] of [['coast',6],['forest',3]] as const){
  const rows=JSON.parse(readFileSync(join(regression,'runs',scene,'results.json'),'utf8'));
  const row=rows.find((r:any)=>r.index===index);
  const imageFile=join(regression,'runs',scene,'data/postcard/collection',row.tripId,'postcard.png');
  cases.push({id:String(cases.length+1),scene,title:row.card.title,note:row.card.note,expectedConflict:true,evidence:'原E批次漏过的蹲/坐案例：图片清晰坐姿，短笺直接写我蹲在；原文与原图不修改',imageFile});
 }
 for(const note of ['我把一点小小的牵挂蹲守在这里，等一封来自你的消息。','想蹲在你的心里躲一会儿，把疲惫都交给这片温柔的蓝。'])cases.push({id:String(cases.length+1),scene:'coast',note,expectedConflict:false,evidence:'蹲守/心里躲一会儿为比喻，不能按姿态关键词拒绝'});
}
atomicJson(join(out,'labels-before-calls.json'),{policy:POLICY,labelMethod:'native visual inspection by development agent, independent of cloud reviewer; no end-user human approval',sources,cases});
let next=0;const results:any[]=[];
async function worker(){while(next<cases.length){const c=cases[next++],file=join(out,c.id+'-response.json');if(existsSync(file)){
 const prior=JSON.parse(readFileSync(file,'utf8'));
 if(!prior.error||!process.argv.includes('--retry-errors')){results.push(prior);continue;}
 const previousFile=join(out,c.id+'-response.failed-1.json');if(existsSync(previousFile)){results.push(prior);continue;}
 renameSync(file,previousFile);
}
 const image=readFileSync(c.imageFile??join(source,'data/postcard/collection',sources[c.scene as keyof typeof sources],'postcard.png'));
 const prompt=textReviewPrompt({title:c.title??'旅行途中的来信',note:c.note});
 atomicJson(join(out,c.id+'-request.json'),{model:VISION_MODEL,prompt,imageSha256:createHash('sha256').update(image).digest('hex')});
 const started=Date.now();let result:any;
 try{const response=await transport('text',{model:VISION_MODEL,stream:false,thinking:{type:'disabled'},response_format:{type:'json_object'},max_tokens:1800,messages:[{role:'user',content:[{type:'text',text:prompt},{type:'image_url',image_url:{url:'data:image/png;base64,'+image.toString('base64')}}]}]},new AbortController().signal);
 const choice=(response.choices as any[])?.[0];if(choice?.finish_reason!=='stop')throw Error('Incomplete review');const review=JSON.parse(choice.message.content);
 result={...c,elapsedSec:(Date.now()-started)/1000,response,review,accepted:textAccepted(review),schemaValid:typeof review.has_explicit_conflict==='boolean'&&Array.isArray(review.conflicts)&&Array.isArray(review.uncertain_details)};
 }catch{result={...c,error:'Cloud or schema failure; not counted as successful classification',elapsedSec:(Date.now()-started)/1000};}
 atomicJson(file,result);results.push(result);console.log('CONTROL',c.id,result.error?'ERROR':result.accepted?'ALLOW':'REJECT',c.expectedConflict?'expected-reject':'expected-allow');
}}
await Promise.all([worker(),worker()]);results.sort((a,b)=>a.id.localeCompare(b.id));
atomicJson(join(out,'results.json'),{total:results.length,errors:results.filter(x=>x.error||!x.schemaValid).length,missedContradictions:results.filter(x=>x.expectedConflict&&x.accepted===true).length,falseRejects:results.filter(x=>!x.expectedConflict&&x.accepted===false).length,results});
