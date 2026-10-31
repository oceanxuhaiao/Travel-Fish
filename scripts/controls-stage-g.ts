/** Fixed independent labels, same production prompts; no image generation. */
import {readFileSync,writeFileSync,mkdirSync,existsSync,renameSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {cloudTransport,textReviewPrompt,placeScopePrompt,textAccepted,VISION_MODEL} from '../src/generation.ts';
const root=resolve('../../../..'),out=join(root,process.argv.includes('--structured')?'output/stage-g-scene-expansion/controls-new-structured':process.argv.includes('--r3')?'output/stage-g-scene-expansion/controls-new-r3':process.argv.includes('--r2')?'output/stage-g-scene-expansion/controls-new-r2':'output/stage-g-scene-expansion/controls-new');mkdirSync(out,{recursive:true});
const env=readFileSync('E:/zcdfy/Coopanion/data/home/providers/deepseek/.env','utf8');
const key=env.split(/\r?\n/).find(l=>l.trim().startsWith('DEEPSEEK_API_KEY='))!.trim().slice('DEEPSEEK_API_KEY='.length).trim().replace(/^['"]|['"]$/g,'');
const call=cloudTransport({root:out,characterReference:'',styleReference:'',secret:()=>key,visionProxyUrl:'http://127.0.0.1:7890'});
const cases:any[]=[];
for(const scene of ['lake','valley','dunes','flowers','waterside']){
 const r=JSON.parse(readFileSync(join(root,'output/stage-g-scene-expansion/runs',scene,'results.json'),'utf8'))[0];
 cases.push({id:scene+'-opposite',kind:'visual',scene,tripId:r.tripId,note:scene==='dunes'?'此刻我坐在积雪覆盖的城镇街道上，身旁是亮灯的面包店。':'此刻我身处一望无际的干燥沙漠，眼前只有连绵沙丘，没有河水、湖水、花草或山谷。',expectedReject:true,evidence:'Native pilot inspection: dunes shows bare sand; other images explicitly show water/green valley/flower field.'});
 cases.push({id:scene+'-metaphor',kind:'visual',scene,tripId:r.tripId,note:'风好像把一点牵挂放进了口袋，我想在这里蹲守一封来自你的消息。',expectedReject:false,evidence:'Wind, feeling and 蹲守 are unverifiable or figurative, not conflicting postures.'});
}
for(const [i,note] of ['我来到杭州西湖边。','今天在桂林漓江停留。','这是敦煌鸣沙山的来信。','到了云南大理。','我正在北京颐和园。','从日本京都寄给你。','在湖边歇了一会儿。','山谷里有一阵轻风。','我走进水边的小镇。','想把这片沙海寄给你。','把心里的江南写进信里。','海岸与远山让我慢慢安静。'].entries())cases.push({id:'scope-'+(i+1),kind:'scope',note,expectedReject:i<6||i===10,evidence:i===10?'江南是明确真实地域名，虽然比喻允许，专有地名范围仍需重写':i<6?'明确真实专有地名':'通用地貌或情绪描述'});
// Labels recorded before model calls. Scope is content range, separate from visual contradiction.
writeFileSync(join(out,'labels-before-calls.json'),JSON.stringify({method:'development agent independent native visual labels, not end-user human approval',cases},null,2));
let cursor=0;const results:any[]=[];
async function worker(){while(cursor<cases.length){const c=cases[cursor++],file=join(out,c.id+'.json');if(existsSync(file)){const prior=JSON.parse(readFileSync(file,'utf8'));if(!prior.error||!process.argv.includes('--retry-errors')||existsSync(file+'.failed-1')){results.push(prior);continue;}renameSync(file,file+'.failed-1');}
 const note={title:'旅途中的一封来信',note:c.note};const prompt=c.kind==='scope'?placeScopePrompt(note):textReviewPrompt(note);
 const content:any[]=[{type:'text',text:prompt}];if(c.kind==='visual')content.push({type:'image_url',image_url:{url:'data:image/png;base64,'+readFileSync(join(root,'output/stage-g-scene-expansion/runs',c.scene,'data/postcard/collection',c.tripId,'postcard.png')).toString('base64')}});
 let row:any;try{const response=await call('text',{model:VISION_MODEL,stream:false,thinking:{type:'disabled'},response_format:{type:'json_object'},max_tokens:1800,messages:[{role:'user',content}]},new AbortController().signal);const choice=(response.choices as any[])?.[0];if(choice?.finish_reason!=='stop')throw Error('Incomplete');const review=JSON.parse(choice.message.content);
 const valid=c.kind==='scope'?typeof review.has_real_place_name==='boolean'&&Array.isArray(review.names):typeof review.has_explicit_conflict==='boolean'&&Array.isArray(review.conflicts)&&Array.isArray(review.uncertain_details);
 if(!valid)throw Error('Schema');const rejected=c.kind==='scope'?review.has_real_place_name||review.names.length>0:!textAccepted(review);row={...c,prompt,response,review,rejected,correct:rejected===c.expectedReject};
 }catch{row={...c,error:'Cloud/schema failure preserved; no automatic retry'};}
 writeFileSync(file,JSON.stringify(row,null,2));results.push(row);console.log('NEW_CONTROL',c.id,row.error?'ERROR':row.correct?'PASS':'FAIL');
}}
await Promise.all([worker(),worker()]);writeFileSync(join(out,'results.json'),JSON.stringify({total:results.length,errors:results.filter(r=>r.error).length,incorrect:results.filter(r=>r.correct===false).length,results},null,2));
