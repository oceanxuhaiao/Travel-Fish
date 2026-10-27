/** Explicitly authorized cloud validation: pilot five, then eight categories x2 total. */
import {readFileSync,mkdirSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createCloudGenerator} from '../src/generation.ts';
import {PostcardWorld} from '../src/world.ts';
import {POSTCARD_DEFAULTS} from '../src/config.ts';
import {FakeHost} from '../tests/helpers/fake-host.ts';
import {atomicJson} from '../src/travel.ts';
import {SCENES,type Scene} from '../src/scenes.ts';
const workspace=resolve('../../../..'),out=join(workspace,'output/stage-g-scene-expansion');
if(!existsSync(join(out,'pricing-estimate.md')))throw Error('Pricing record required before cloud calls');
const ark=readFileSync(join(workspace,'模型密钥.txt'),'utf8').replace(/^\uFEFF/,'').trim();
const vision=readFileSync('E:/zcdfy/Coopanion/data/home/providers/deepseek/.env','utf8').split(/\r?\n/).find(s=>s.trim().startsWith('DEEPSEEK_API_KEY='))?.trim().slice('DEEPSEEK_API_KEY='.length).trim().replace(/^['"]|['"]$/g,'');
if(!vision||!ark||/\s/.test(ark))throw Error('Credentials unavailable');
const secret=(n:string)=>n==='POSTCARD_ARK_API_KEY'?ark:n==='POSTCARD_VISION_API_KEY'?vision:'';
const pilot=process.argv.includes('--pilot'),scenes:Scene[]=pilot?['lake','valley','dunes','flowers','waterside']:[...SCENES];
if(!pilot&&!existsSync(join(out,'pilot-inspection.json')))throw Error('Inspect pilot before remaining paid batch');
const cfg={...POSTCARD_DEFAULTS,enabled:true,cloudEnabled:true,minutes:1,characterReference:join(workspace,'output/postcards-v2/assets/character-reference.png'),styleReference:join(workspace,'output/postcards-v2/assets/00-coast-master.png'),imageProxyUrl:'',visionProxyUrl:'http://127.0.0.1:7890'};
let next=0,stop=false;const batch:any[]=[];
async function worker(){while(!stop&&next<scenes.length){
 const scene=scenes[next++],folder=join(out,'runs',scene);mkdirSync(folder,{recursive:true});
 const resultFile=join(folder,'results.json'),results:any[]=existsSync(resultFile)?JSON.parse(readFileSync(resultFile,'utf8')):[];
 let now=Date.now(),world:PostcardWorld;
 const generator=createCloudGenerator({root:join(folder,'data/postcard'),...cfg,secret,recentTitles:()=>world.service.store.cards().map(c=>c.title)});
 world=new PostcardWorld({cfg,dataDir:join(folder,'data'),generator,now:()=>now});const host=new FakeHost();await world.start(host);
 const eventFile=join(folder,'events.json'),events=existsSync(eventFile)?JSON.parse(readFileSync(eventFile,'utf8')):[];
 try{
  const prior=world.service.status();if(prior&&['traveling','generating','awaiting_service','failed'].includes(prior.status))throw Error('Unfinished trip preserved; inspect before continuing');
  for(let i=results.length;i<(pilot?1:2)&&!stop;i++){
   const trip=world.service.start(scene,1);now=trip.dueAt+1;const started=Date.now();
   atomicJson(join(folder,'in-flight.json'),{scene,index:i+1,tripId:trip.id,startedAt:new Date().toISOString()});console.log('START',scene,i+1,trip.sceneSnapshot?.id);
   await world.pulse();const status=world.service.status()!;
   const row={scene,index:i+1,tripId:trip.id,scenePlan:trip.sceneSnapshot?.id,status:status.status,error:status.error,elapsedSec:(Date.now()-started)/1000,card:world.service.store.card(trip.id)};
   results.push(row);atomicJson(resultFile,results);atomicJson(eventFile,[...events,...host.events]);console.log('RESULT',scene,i+1,status.status,row.elapsedSec,status.error??'');
   if(status.status!=='completed'){stop=true;atomicJson(join(folder,'failed-trip.json'),status);throw Error('Batch stopped at preserved failure');}
  }
  batch.push({scene,status:'fulfilled',trips:results.length});
 }catch(error){stop=true;batch.push({scene,status:'rejected',error:String(error)});}finally{await world.stop();}
}}
await Promise.all([worker(),worker()]);atomicJson(join(out,pilot?'pilot-status.json':'batch-status.json'),batch);
if(stop)process.exitCode=1;console.log('BATCH_FINISHED',pilot?'pilot':'remaining');
