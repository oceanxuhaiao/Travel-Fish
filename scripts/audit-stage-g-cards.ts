/** Final-rule recheck of immutable produced cards, no image generation or rewrites. */
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {SCENES} from '../src/scenes.ts';
import {cloudTransport,textReviewPrompt,placeScopePrompt,textAccepted,VISION_MODEL} from '../src/generation.ts';
const root=resolve('../../../..'),out=join(root,'output/stage-g-scene-expansion/final-card-checks');mkdirSync(out,{recursive:true});
const env=readFileSync('E:/zcdfy/Coopanion/data/home/providers/deepseek/.env','utf8');const key=env.split(/\r?\n/).find(l=>l.trim().startsWith('DEEPSEEK_API_KEY='))!.trim().slice('DEEPSEEK_API_KEY='.length).trim().replace(/^['"]|['"]$/g,'');
const call=cloudTransport({root:out,characterReference:'',styleReference:'',secret:()=>key,visionProxyUrl:'http://127.0.0.1:7890'});
const rows=SCENES.flatMap(s=>JSON.parse(readFileSync(join(root,'output/stage-g-scene-expansion/runs',s,'results.json'),'utf8')));
let cursor=0;const results:any[]=[];
async function worker(){while(cursor<rows.length){const row=rows[cursor++],file=join(out,row.tripId+'.json');if(existsSync(file)){results.push(JSON.parse(readFileSync(file,'utf8')));continue;}
 const note={title:row.card.title,note:row.card.note};const result:any={scene:row.scene,index:row.index,tripId:row.tripId,sha256:row.card.sha256,immutable:true};
 try{for(const kind of ['visual','scope']){const prompt=kind==='visual'?textReviewPrompt(note):placeScopePrompt(note),content:any[]=[{type:'text',text:prompt}];if(kind==='visual')content.push({type:'image_url',image_url:{url:'data:image/png;base64,'+readFileSync(join(root,'output/stage-g-scene-expansion/runs',row.scene,'data/postcard/collection',row.tripId,'postcard.png')).toString('base64')}});
 const response=await call('text',{model:VISION_MODEL,stream:false,thinking:{type:'disabled'},response_format:{type:'json_object'},max_tokens:1800,messages:[{role:'user',content}]},new AbortController().signal);const choice=(response.choices as any[])?.[0];if(choice?.finish_reason!=='stop')throw Error('Incomplete');const review=JSON.parse(choice.message.content);result[kind]={prompt,response,review};
 const valid=kind==='visual'?Array.isArray(review.checks)&&typeof review.has_explicit_conflict==='boolean'&&Array.isArray(review.conflicts)&&Array.isArray(review.uncertain_details):typeof review.has_real_place_name==='boolean'&&Array.isArray(review.names);if(!valid)throw Error('Schema');
 result[kind].accepted=kind==='visual'?textAccepted(review):!review.has_real_place_name&&review.names.length===0;
 }result.accepted=result.visual.accepted&&result.scope.accepted;}catch{result.error='Cloud/schema failure preserved; no implicit pass';}
 writeFileSync(file,JSON.stringify(result,null,2));results.push(result);console.log('FINAL_CARD',row.scene,row.index,result.error?'ERROR':result.accepted?'PASS':'REJECT');
}}
await Promise.all([worker(),worker()]);writeFileSync(join(out,'results.json'),JSON.stringify({total:results.length,errors:results.filter(r=>r.error).length,rejected:results.filter(r=>r.accepted===false).length,results},null,2));
