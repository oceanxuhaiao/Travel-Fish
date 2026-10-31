import {Probe} from 'file:///C:/Users/Administrator/.codex/visualizations/2026/10/25/01a17219-9c8a-7ac1-9865-5ddec10d3d73/postcard-host-vision-probe/index.ts';
import {readFileSync,writeFileSync,mkdtempSync} from 'node:fs';import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';import assert from 'node:assert/strict';
const root=resolve('../../../../output/stage-m-host-vision-probe'),result=JSON.parse(readFileSync(join(root,'host-result.json'),'utf8').replace(/^\uFEFF/,''));const a=result.accepted.payload;
const cfg={enabled:true,image:resolve('../../../../output/stage-j-flash-comparison/forest/flash.png')};const temp=mkdtempSync(join(tmpdir(),'postcard-probe-'));
const p=new Probe(cfg,temp),checks=[];
assert.equal(p.submit(a).duplicate,false);checks.push('first submission persists');
assert.equal(p.submit(a).duplicate,true);checks.push('identical duplicate idempotent');
assert.throws(()=>p.submit({...a,probeId:'wrong'}));checks.push('wrong candidate rejected');
assert.throws(()=>p.submit({...a,imageSha:'wrong'}));checks.push('wrong image SHA rejected');
assert.throws(()=>p.submit({...a,note:'short'}));checks.push('invalid text length rejected');
assert.throws(()=>p.submit({...a,note:a.note+'改'}));checks.push('different second result cannot overwrite');
const reopened=new Probe(cfg,temp);assert.deepEqual(reopened.state().payload,a);checks.push('reopen preserves accepted result');
assert.equal(reopened.submit({...a}).duplicate,true);checks.push('reopen duplicate stays idempotent');
writeFileSync(join(root,'local-checks.json'),JSON.stringify({passed:checks.length,checks},null,2));console.log('Passed',checks.length);

