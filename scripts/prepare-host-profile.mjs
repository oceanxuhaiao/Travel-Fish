/** Seed an isolated profile through the target's own seed function; no host files changed. */
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
const profile=resolve(process.argv[2]),app=resolve(process.argv[3]),workspace=resolve(process.argv[4]);
if(!profile.startsWith(join(workspace,'output','stage-f-host-validation')+'\\')||profile===resolve('E:/zcdfy/Coopanion/data'))throw Error('Not an isolated validation profile');
const home=join(profile,'home');mkdirSync(home,{recursive:true});
await import(pathToFileURL(join(app,'build/cortico/src/extensions/runtime.ts')).href);
const {seed}=await import(pathToFileURL(join(app,'core/seed.ts')).href);seed(home,'zh');
const deploy=join(home,'companion'),file=join(deploy,'config.json'),cfg=JSON.parse(readFileSync(file,'utf8'));
cfg.displayName='旅行明信片隔离验收';cfg.web={...cfg.web,port:18788};cfg.tick={intervalMinutes:null};cfg.companion={...cfg.companion,telemetry:false};
cfg.worlds={...cfg.worlds,console:{enabled:true,pin:''},'desktop-pet':{...cfg.worlds?.['desktop-pet'],enabled:false},postcard:{enabled:true,cloudEnabled:true,minutes:1,characterReference:join(workspace,'output/postcards-v2/assets/character-reference.png'),styleReference:join(workspace,'output/postcards-v2/assets/00-coast-master.png'),imageProxyUrl:'',visionProxyUrl:'http://127.0.0.1:7890'}};
writeFileSync(file,JSON.stringify(cfg,null,2));
writeFileSync(join(deploy,'guide.json'),JSON.stringify({doneAt:new Date().toISOString(),testProfile:true}));
const provider=join(home,'providers',cfg.activeProvider,'config.json');
if(existsSync(provider)){const entry=JSON.parse(readFileSync(provider,'utf8'));entry.spec={...entry.spec,model:'deepseek-flash',thinking:false,maxTokens:1600};writeFileSync(provider,JSON.stringify(entry,null,2));}
const ext=join(profile,'extensions');mkdirSync(ext,{recursive:true});
if(!existsSync(join(ext,'package.json')))writeFileSync(join(ext,'package.json'),JSON.stringify({name:'postcard-host-validation-extensions',private:true,type:'module',packageManager:'pnpm@11.28.6'}));
writeFileSync(join(ext,'pnpm-workspace.yaml'),'');
console.log(JSON.stringify({profile,activeProvider:cfg.activeProvider,port:cfg.web.port,targetVersion:JSON.parse(readFileSync(join(app,'package.json'),'utf8')).version,originalProfileTouched:false}));
