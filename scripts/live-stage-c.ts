/** Opt-in, billable isolated World validation. Never reads or changes host config. */
import { readFileSync,mkdirSync,existsSync,writeFileSync } from 'node:fs';
import { resolve,join } from 'node:path';
import { createCloudGenerator } from '../src/generation.ts';
import { PostcardWorld } from '../src/world.ts';
import { POSTCARD_DEFAULTS } from '../src/config.ts';
import { FakeHost } from '../tests/helpers/fake-host.ts';
import { atomicJson,type Scene } from '../src/travel.ts';
import type { ToolCallContext } from 'cortico/core/types.ts';

function arg(name:string):string {const i=process.argv.indexOf('--'+name);if(i<0||!process.argv[i+1])throw new Error('Missing --'+name);return process.argv[i+1];}
function credential(file:string,name:string):string {
  const text=readFileSync(file,'utf8').replace(/^\uFEFF/,'').trim();
  const line=text.split(/\r?\n/).find(s=>s.trim().startsWith(name+'='));
  const key=line?line.trim().slice(name.length+1).trim().replace(/^['"]|['"]$/g,''):text.split(/\r?\n/).length===1?text:'';
  if(!key||/\s/.test(key))throw new Error('Missing or malformed credential');return key;
}
const out=resolve(arg('out'));mkdirSync(out,{recursive:true});
const previousEvents=existsSync(join(out,'events.json'))?JSON.parse(readFileSync(join(out,'events.json'),'utf8')):[];
const ark=credential(arg('ark-key-file'),'ARK_API_KEY');
const vision=credential(arg('vision-key-file'),'DEEPSEEK_API_KEY');
const proxyAt=process.argv.indexOf('--vision-proxy');
const secret=(name:string)=>name==='POSTCARD_ARK_API_KEY'?ark:name==='POSTCARD_VISION_API_KEY'?vision:'';
let now=Date.now();let world:PostcardWorld;
const cfg={...POSTCARD_DEFAULTS,enabled:true,cloudEnabled:true,minutes:1,characterReference:resolve(arg('character')),styleReference:resolve(arg('style')),visionProxyUrl:proxyAt>=0?process.argv[proxyAt+1]:''};
const generator=createCloudGenerator({root:join(out,'data/postcard'),characterReference:cfg.characterReference,styleReference:cfg.styleReference,secret,visionProxyUrl:cfg.visionProxyUrl,recentTitles:()=>world.service.store.cards().map(c=>c.title)});
world=new PostcardWorld({cfg,dataDir:join(out,'data'),generator,now:()=>now});
const host=new FakeHost();
await world.start(host);
try {
  const call={} as ToolCallContext;
  const tool=(name:string)=>world.tools().find(t=>t.name===name)!;
  for(const scene of ['coast','forest','snow'] as Scene[]){
    const existing=world.service.store.cards().find(c=>c.scene===scene);
    if(existing){console.log('REUSE_COMPLETED',scene,existing.tripId);continue;}
    const current=world.service.status();
    const resume=process.argv.includes('--resume-failed')&&current?.status==='failed'&&current.scene===scene;
    if(current&&['generating','failed','awaiting_service','traveling'].includes(current.status)&&!resume)throw new Error('Unfinished prior trip preserved; inspect before retrying');
    const trip=resume?JSON.parse(await tool('postcard_retry').handler({tripId:current!.id,confirmUnknownOutcome:false},call) as string):JSON.parse(await tool('postcard_start').handler({scene},call) as string);
    console.log('WORLD_STARTED_TRIP',scene,trip.id);
    now=trip.dueAt+1;
    const started=Date.now();await world.pulse();
    const status=world.service.status();console.log('WORLD_FINISHED_TRIP',scene,status?.status,'seconds',((Date.now()-started)/1000).toFixed(3));
    atomicJson(join(out,'events.json'),[...previousEvents,...host.events]);
    if(status?.status!=='completed'){atomicJson(join(out,'failed-trip.json'),status);throw new Error('Trip failed; saved state retained. No automatic paid retry.');}
    const card=JSON.parse(await tool('postcard_read').handler({tripId:trip.id},call) as string);
    atomicJson(join(out,scene+'-result.json'),{card,elapsedSec:(Date.now()-started)/1000,hostMode:'isolated World with FakeHost',clock:'virtual travel waiting only; all cloud generation real',localModelsUsed:false});
  }
  atomicJson(join(out,'result.json'),{status:'three_scenes_completed_in_production_World',cards:world.service.store.cards(),targetCoopanionInstalled:false,manualOverrides:0,localModelsUsed:false});
} finally {await world.stop();}
console.log('LIVE_STAGE_C_COMPLETED');
