/** Six explicitly authorized Flash images; preserve every first result, no image retries. */
import {readFileSync,writeFileSync,mkdirSync,existsSync,readdirSync,copyFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {cloudTransport,decodePng,VISION_MODEL} from '../src/generation.ts';
import {atomicJson} from '../src/travel.ts';
const workspace=resolve('../../../..'),out=join(workspace,'output/stage-j-flash-comparison');mkdirSync(out,{recursive:true});
const model='doubao-seedream-5-0-flash-260915';
const ark=readFileSync(join(workspace,'模型密钥.txt'),'utf8').replace(/^\uFEFF/,'').trim();
const vision=readFileSync('E:/zcdfy/Coopanion/data/home/providers/deepseek/.env','utf8').split(/\r?\n/).find(s=>s.trim().startsWith('DEEPSEEK_API_KEY='))?.split('=').slice(1).join('=').trim().replace(/^['"]|['"]$/g,'');
if(!ark||!vision||/\s/.test(ark))throw Error('Credentials unavailable');
const refs=[join(workspace,'output/postcards-v2/assets/character-reference.png'),join(workspace,'output/postcards-v2/assets/00-coast-master.png')].map(p=>readFileSync(p));refs.forEach(decodePng);
const hash=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
const call=cloudTransport({root:out,characterReference:'',styleReference:'',secret:n=>n==='POSTCARD_ARK_API_KEY'?ark:n==='POSTCARD_VISION_API_KEY'?vision:'',visionProxyUrl:'http://127.0.0.1:7890'});
const scenes=['forest','coast','snow','lake','dunes','waterside'];
atomicJson(join(out,'plan.json'),{model,scenes,images:6,referenceSha:refs.map(hash),imageUnitYuan:0.12,imageTotalYuan:0.72,textBudgetYuan:0.18,method:'Reuse first historical Pro prompt and both reference images exactly; first Flash output only. Historical Pro comparison is not a simultaneous seeded trial.',imageRetries:0,productionChanged:false});
writeFileSync(join(out,'pricing-estimate.md'),'2026-10-27：方舟Flash官方0.12元/图，6张0.72元；视觉分析预留0.18元，实际token另计。无自动重生图。https://docs.volcengine.com/docs/ark/model-pricing?lang=zh');
copyFileSync(join(workspace,'output/postcards-v2/assets/character-reference.png'),join(out,'character.png'));copyFileSync(join(workspace,'output/postcards-v2/assets/00-coast-master.png'),join(out,'style.png'));
let cursor=0,stop=false;
async function worker(){while(!stop&&cursor<scenes.length){const scene=scenes[cursor++],folder=join(out,scene);mkdirSync(folder,{recursive:true});
 const old=join(workspace,'output/stage-g-scene-expansion/runs',scene),row=JSON.parse(readFileSync(join(old,'results.json'),'utf8'))[0];
 const tripFolder=join(old,'data/postcard/trips',row.tripId),spec=JSON.parse(readFileSync(join(tripFolder,'spec.json'),'utf8'));
 if(spec.characterSha!==hash(refs[0])||spec.styleSha!==hash(refs[1]))throw Error('Historical reference mismatch');
 copyFileSync(join(old,'data/postcard/collection',row.tripId,'postcard.png'),join(folder,'pro.png'));
 atomicJson(join(folder,'baseline.json'),row);const imageFile=join(folder,'flash.png');
 if(!existsSync(imageFile)){
  if(existsSync(join(folder,'image-request.json')))throw Error('Prior request exists without saved image; do not blindly retry');
  atomicJson(join(folder,'image-request.json'),{model,prompt:spec.prompt,size:'2K',referenceSha:refs.map(hash),startedAt:new Date().toISOString()});console.log('START',scene);
  const started=Date.now();try{const result=await call('image',{model,prompt:spec.prompt,image:refs.map(b=>'data:image/png;base64,'+b.toString('base64')),size:'2K',response_format:'b64_json',output_format:'png',watermark:false},new AbortController().signal);
   const item=(result.data as any[])?.[0];if(typeof item?.b64_json!=='string')throw Error('No base64 image');const image=Buffer.from(item.b64_json,'base64');const dims=decodePng(image);writeFileSync(imageFile,image);
   atomicJson(join(folder,'image-result.json'),{model:result.model,usage:result.usage,...dims,sha256:hash(image),elapsedMs:Date.now()-started});console.log('SAVED',scene,Date.now()-started);
  }catch(e){atomicJson(join(folder,'image-error.json'),{error:e instanceof Error?e.message:'Unknown',outcome:'No automatic retry; inspect service records'});console.log('IMAGE_FAILED',scene);stop=true;continue;}
 }
 if(!existsSync(join(folder,'visual-review.json'))){try{
  const prompt='这是桌宠旅行明信片选型开发抽检。图1是Flash候选，图2是历史Pro同提示词基线，图3是角色参考，图4是画风参考。请实事求是分别评估候选和基线，不因模型名称推断质量。重点观察：蓝发蓝眼、深蓝鲸鱼帽及白喷水顶/绒边、蓝白裙、小靴与尾巴身份是否保持；透明水彩晕染、纸张、线条、留白是否精美；环境主体与层次是否丰富且不会照搬画风图的海岸。可接受轻微服饰差异，不要求像素一致。返回JSON：flash和pro各含character_score、watercolor_score、scene_score（整数1至5）与observations、issues字符串数组；comparison含preferred为flash/pro/tie和reason；flash_note含title与note，note为40至100字温柔旅行短笺，不使用具体真实地名，不明确描写身体姿态/难辨道具。评分属于审美参考，不代表人工验收。场景要求：'+spec.scenePrompt;
  const images=[readFileSync(imageFile),readFileSync(join(folder,'pro.png')),...refs];const response=await call('text',{model:VISION_MODEL,stream:false,thinking:{type:'disabled'},response_format:{type:'json_object'},max_tokens:2600,messages:[{role:'user',content:[{type:'text',text:prompt},...images.map(b=>({type:'image_url',image_url:{url:'data:image/png;base64,'+b.toString('base64')}}))]}]},new AbortController().signal);
  const choice=(response.choices as any[])?.[0];if(choice?.finish_reason!=='stop')throw Error('Review incomplete');const review=JSON.parse(choice.message.content);atomicJson(join(folder,'visual-review.json'),{model:response.model,usage:response.usage,review});console.log('REVIEWED',scene);
 }catch{atomicJson(join(folder,'review-error.json'),{error:'Visual review failed; images preserved'});console.log('REVIEW_FAILED',scene);}}
}}
await Promise.all([worker(),worker()]);console.log('DONE');if(stop)process.exitCode=1;
