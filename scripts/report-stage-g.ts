/** Read-only proof book; thumbnail sheet is diagnostic, originals unchanged. */
import {readFileSync,writeFileSync,readdirSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {PNG} from 'pngjs';
import {SCENES,SCENE_LABELS} from '../src/scenes.ts';
const out=resolve('../../../../output/stage-g-scene-expansion');
const json=(f:string)=>JSON.parse(readFileSync(f,'utf8'));
const rows=SCENES.flatMap(s=>existsSync(join(out,'runs',s,'results.json'))?json(join(out,'runs',s,'results.json')):[]);
let imageRequests=0,imageReturned=0,textRequests=0,promptTokens=0,completionTokens=0,cacheTokens=0;
for(const row of rows){const folder=join(out,'runs',row.scene,'data/postcard/trips',row.tripId);for(const f of readdirSync(folder)){
 if(/^image-\d+-request\.json$/.test(f))imageRequests++;
 if(/^image-\d+-response\.json$/.test(f))imageReturned+=json(join(folder,f)).imageItems??0;
 if(/-response-\d+\.json$/.test(f)){textRequests++;const u=json(join(folder,f)).usage??{};promptTokens+=u.prompt_tokens??0;cacheTokens+=u.prompt_cache_hit_tokens??u.prompt_tokens_details?.cached_tokens??0;completionTokens+=u.completion_tokens??0;}
}}
const completed=rows.filter(r=>r.card),times=completed.map(r=>r.elapsedSec).sort((a,b)=>a-b);
const metrics={planned:16,attempted:rows.length,completed:completed.length,failed:rows.length-completed.length,imageRequests,imageReturned,textRequests,firstImageCompleted:completed.filter(r=>r.card.generation.imageAttempt===1).length,noteRewrites:completed.filter(r=>r.card.generation.noteAttempt>1).length,meanSec:times.reduce((a,b)=>a+b,0)/(times.length||1),p95Sec:times[Math.ceil(times.length*.95)-1],usage:{promptTokens,cacheTokens,completionTokens},estimate:{imageYuan:imageReturned*.62,textYuanPeak:((promptTokens-cacheTokens)*2+cacheTokens*.04+completionTokens*8)/1e6,basis:'public prices 2026-10-27, generated-trip calls only; controls/host calls separately; actual bill not read'},humanAudit:'pending'};
writeFileSync(join(out,'metrics.json'),JSON.stringify(metrics,null,2));
const width=960,cell=240,height=Math.max(1,Math.ceil(completed.length/4))*360;
const sheet=new PNG({width,height});sheet.data.fill(245);
for(let i=0;i<completed.length;i++){const r=completed[i],file=join(out,'runs',r.scene,'data/postcard/collection',r.tripId,'postcard.png'),bytes=readFileSync(file);if(createHash('sha256').update(bytes).digest('hex')!==r.card.sha256)throw Error('Hash mismatch');
 const src=PNG.sync.read(bytes),x0=i%4*cell,y0=Math.floor(i/4)*360;
 for(let y=0;y<360;y++)for(let x=0;x<240;x++){const sx=Math.min(src.width-1,Math.floor(x*src.width/240)),sy=Math.min(src.height-1,Math.floor(y*src.height/360));src.data.copy(sheet.data,((y0+y)*width+x0+x)*4,(sy*src.width+sx)*4,(sy*src.width+sx)*4+4);}
}
writeFileSync(join(out,'contact-sheet.png'),PNG.sync.write(sheet));
const esc=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
writeFileSync(join(out,'index.html'),`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>远方来信 · 新风景验证册</title><style>body{margin:0;background:#eef0e7;color:#35473e;font:16px/1.8 system-ui}main{max-width:1200px;margin:auto;padding:32px}h1,h2,h3{font-family:serif;font-weight:500}.grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:18px}article{background:#fffdf7;padding:10px;border-radius:6px}img{width:100%;display:block}small{color:#6c8073}.note{font-family:serif}a{color:#386c63}@media(max-width:800px){.grid{grid-template-columns:repeat(2,minmax(0,1fr))}main{padding:15px}}</style><main><small>G4开发验证册 · 实际云端生成 · 用户抽检待确认</small><h1>给收藏册，添一些新风景</h1><p>八类虚构环境，不对应真实地名。${completed.length}/16 张已完成。本页用于开发检查，不是宿主面板。每张可点开原图，短笺在图下。</p><p><a href="metrics.json">生成统计</a> · <a href="scene-catalog.json">场景目录</a> · <a href="pricing-estimate.md">费用口径</a></p><div class="grid">${rows.map(r=>`<article><small>${esc(SCENE_LABELS[r.scene as keyof typeof SCENE_LABELS])} ${r.index} · ${esc(r.scenePlan)}</small>${r.card?`<a href="runs/${r.scene}/data/postcard/collection/${r.tripId}/postcard.png" target="_blank"><img loading="lazy" src="runs/${r.scene}/data/postcard/collection/${r.tripId}/postcard.png" alt="${esc(r.card.title)}"></a><h3>${esc(r.card.title)}</h3><p class="note">${esc(r.card.note)}</p><small>${r.elapsedSec.toFixed(1)}秒 · 图片候选${r.card.generation.imageAttempt} · 文案${r.card.generation.noteAttempt}</small>`:`<p>${esc(r.error)}</p>`}</article>`).join('')}</div></main>`);
console.log(JSON.stringify(metrics));
