/** Profile copies of real immutable collections; no host or API access. */
import {readFileSync,mkdirSync,copyFileSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {performance} from 'node:perf_hooks';
import {TravelStore,atomicJson} from '../src/travel.ts';
const out=resolve(process.argv[2]),tag=process.argv[3]??'current';if(!existsSync(join(out,'pricing-estimate.md'))||!/^[a-z0-9-]+$/.test(tag))throw Error('Invalid output');
const root=join(out,'performance-copy');mkdirSync(join(root,'collection'),{recursive:true});
for(const scene of ['coast','forest','snow']){const run=join(out,'runs',scene);if(!existsSync(join(run,'results.json')))continue;for(const row of JSON.parse(readFileSync(join(run,'results.json'),'utf8'))){if(!row.card)continue;const dst=join(root,'collection',row.tripId);mkdirSync(dst,{recursive:true});for(const f of ['postcard.png','record.json','note.md'])if(!existsSync(join(dst,f)))copyFileSync(join(run,'data/postcard/collection',row.tripId,f),join(dst,f));}}
const store=new TravelStore(root);store.open();try{
 const cards=store.cards().length,cpu=process.cpuUsage(),times=[];for(let i=0;i<20;i++){const started=performance.now();store.cards();times.push(performance.now()-started);}
 const used=process.cpuUsage(cpu);times.sort((a,b)=>a-b);const result={tag,cards,iterations:20,meanMs:times.reduce((a,b)=>a+b,0)/times.length,p95Ms:times[18],cpuMs:(used.user+used.system)/1000,environment:'Windows/Node '+process.version,method:'real PNG copies, warm filesystem cache, synchronous collection scan; 20 iterations'};
 atomicJson(join(out,'performance-'+tag+'.json'),result);console.log(JSON.stringify(result));
}finally{store.close();}
