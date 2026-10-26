/** Explicitly billable development regression; three isolated single-trip Worlds. */
import {readFileSync,mkdirSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createCloudGenerator} from '../src/generation.ts';
import {PostcardWorld} from '../src/world.ts';
import {POSTCARD_DEFAULTS} from '../src/config.ts';
import {FakeHost} from '../tests/helpers/fake-host.ts';
import {atomicJson,type Scene} from '../src/travel.ts';
const arg=(name:string)=>{const i=process.argv.indexOf('--'+name);if(i<0||!process.argv[i+1])throw Error('Missing '+name);return process.argv[i+1];};
function credential(file:string,name:string){const text=readFileSync(file,'utf8').replace(/^\uFEFF/,'').trim();const line=text.split(/\r?\n/).find(s=>s.trim().startsWith(name+'='));const key=line?line.trim().slice(name.length+1).trim().replace(/^['"]|['"]$/g,''):text.split(/\r?\n/).length===1?text:'';if(!key||/\s/.test(key))throw Error('Invalid credential');return key;}
const out=resolve(arg('out'));mkdirSync(out,{recursive:true});
if(!existsSync(join(out,'pricing-estimate.md')))throw Error('Record pricing before billable run');
const counts:Record<Scene,number>=process.argv.includes('--quality')?{coast:6,forest:2,snow:2}:{coast:10,forest:10,snow:10};
atomicJson(join(out,'run-plan.json'),{counts,plannedTotal:Object.values(counts).reduce((a,b)=>a+b,0),qualityRevision:process.argv.includes('--quality')});
const ark=credential(arg('ark-key-file'),'ARK_API_KEY'),vision=credential(arg('vision-key-file'),'DEEPSEEK_API_KEY');
const secret=(name:string)=>name==='POSTCARD_ARK_API_KEY'?ark:name==='POSTCARD_VISION_API_KEY'?vision:'';
const cfg={...POSTCARD_DEFAULTS,enabled:true,cloudEnabled:true,minutes:1,characterReference:resolve(arg('character')),styleReference:resolve(arg('style')),visionProxyUrl:arg('vision-proxy')};
async function worker(scene:Scene){
 const folder=join(out,'runs',scene);mkdirSync(folder,{recursive:true});
 const resultsFile=join(folder,'results.json');
 const previousEvents=existsSync(join(folder,'events.json'))?JSON.parse(readFileSync(join(folder,'events.json'),'utf8')):[];
 const results:any[]=existsSync(resultsFile)?JSON.parse(readFileSync(resultsFile,'utf8')):[];
 let now=Date.now(),world:PostcardWorld;
 const generator=createCloudGenerator({root:join(folder,'data/postcard'),characterReference:cfg.characterReference,styleReference:cfg.styleReference,secret,visionProxyUrl:cfg.visionProxyUrl,recentTitles:()=>world.service.store.cards().map(c=>c.title),recentVariants:scene=>world.service.store.cards().filter(c=>c.scene===scene&&typeof c.generation?.sceneVariant==='string').map(c=>c.generation!.sceneVariant as string)});
 world=new PostcardWorld({cfg,dataDir:join(folder,'data'),generator,now:()=>now});const host=new FakeHost();await world.start(host);
 try{
  const prior=world.service.status();
  if(prior&&['traveling','generating','awaiting_service','failed'].includes(prior.status))throw Error('Prior unfinished run preserved: inspect manually');
  for(let i=results.length;i<counts[scene];i++){
   const trip=world.service.start(scene,1);now=trip.dueAt+1;
   atomicJson(join(folder,'in-flight.json'),{index:i+1,tripId:trip.id,started:new Date().toISOString()});
   console.log('START',scene,i+1,trip.id);const started=Date.now();await world.pulse();
   const status=world.service.status()!;
   results.push({index:i+1,scene,tripId:trip.id,status:status.status,error:status.error,elapsedSec:(Date.now()-started)/1000,card:world.service.store.card(trip.id)});
   atomicJson(resultsFile,results);atomicJson(join(folder,'events.json'),[...previousEvents,...host.events]);
   console.log('RESULT',scene,i+1,status.status,((Date.now()-started)/1000).toFixed(2),status.error??'');
   if(status.status!=='completed'){
    // Keep the failed result/checkpoints; cancelling only frees this test World's queue.
    atomicJson(join(folder,trip.id+'-failed.json'),status);
    if(/HTTP (401|403|429)/.test(status.error??''))throw Error('Account/auth/quota limit; stop this worker without repeated paid attempts');
    world.service.cancel(trip.id);
   }
  }
 }finally{await world.stop();}
 return results;
}
const settled=await Promise.allSettled((['coast','forest','snow'] as Scene[]).map(worker));
atomicJson(join(out,'batch-status.json'),settled.map((r,i)=>({scene:['coast','forest','snow'][i],status:r.status,...(r.status==='rejected'?{error:String(r.reason)}:{trips:r.value.length,completed:r.value.filter(t=>t.status==='completed').length})})));
console.log('BATCH_FINISHED');
if(settled.some(r=>r.status==='rejected'))process.exitCode=1;
