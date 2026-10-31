import {it,expect,vi} from 'vitest';import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {DevelopmentValidation} from '../src/development-validation.ts';import {TravelStore} from '../src/travel.ts';
const pause=()=>new Promise(r=>setTimeout(r,10));
it('显式开发复验只调用文字，完成缓存不重复调用，未知卡和路径不越界',async()=>{
 const root=mkdtempSync(join(tmpdir(),'postcard-validation-')),store=new TravelStore(join(root,'store')),dir=join(root,'validation');mkdirSync(dir);let calls=0;
 const transport:any=vi.fn(async(kind:string)=>{expect(kind).toBe('text');calls++;return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({accepted:true,issues:[]})}}]};});const runner=new DevelopmentValidation(dir,store,transport);
 try{writeFileSync(join(dir,'a-request.json'),JSON.stringify({kind:'decision',prompt:'controlled'}));runner.start('a');await pause();expect(runner.status('a').status).toBe('completed');expect(runner.start('a').status).toBe('completed');expect(calls).toBe(1);expect(()=>runner.start('../bad')).toThrow('编号');
 writeFileSync(join(dir,'b-request.json'),JSON.stringify({kind:'decision',prompt:'controlled',imageTripId:'00000000-0000-0000-0000-000000000000'}));runner.start('b');await pause();expect(runner.status('b')).toMatchObject({status:'failed',error:'只允许已入藏图'});expect(calls).toBe(1);
 }finally{await runner.stop();rmSync(root,{recursive:true,force:true});}
});
