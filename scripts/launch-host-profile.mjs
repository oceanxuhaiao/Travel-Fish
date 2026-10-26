/** Launch the actual packaged application against only the opt-in isolated profile. */
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {spawn} from 'node:child_process';
const workspace=resolve(process.argv[2]),profile=join(workspace,'output/stage-f-host-validation/profile');
const ark=readFileSync(join(workspace,'模型密钥.txt'),'utf8').replace(/^\uFEFF/,'').trim();
const text=readFileSync('E:/zcdfy/Coopanion/data/home/providers/deepseek/.env','utf8');
const vision=text.split(/\r?\n/).find(s=>s.trim().startsWith('DEEPSEEK_API_KEY='))?.trim().slice('DEEPSEEK_API_KEY='.length).trim().replace(/^['"]|['"]$/g,'');
if(!vision||/\s/.test(ark))throw Error('Credential not available');
const env={...process.env,CORTICO_COMPANION_DATA:profile,POSTCARD_ARK_API_KEY:ark,POSTCARD_VISION_API_KEY:vision,DEEPSEEK_API_KEY:vision};delete env.ELECTRON_RUN_AS_NODE;
const child=spawn('E:/zcdfy/Coopanion/Coopanion.exe',[],{env,windowsHide:true,stdio:'ignore'});
writeFileSync(join(workspace,'output/stage-f-host-validation/launch.json'),JSON.stringify({pid:child.pid,profile,mode:'actual packaged Coopanion application with separate profile',startedAt:new Date().toISOString(),secretPersistence:'process environment only'},null,2));
console.log('ISOLATED_COOPANION_STARTED',child.pid);
child.on('error',()=>{console.error('Target process failed to launch');process.exitCode=1;});
child.on('exit',(code)=>{console.log('ISOLATED_COOPANION_EXITED',code);process.exitCode=code??0;});
