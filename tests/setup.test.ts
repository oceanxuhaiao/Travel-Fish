import {describe,it,expect} from 'vitest';
import {SetupPanel} from '../src/setup.ts';
import {POSTCARD_DEFAULTS} from '../src/config.ts';
describe('configuration guide',()=>{
 it('only saves whitelisted keys and never returns their values',()=>{
  const values:Record<string,string>={};const panel=new SetupPanel({...POSTCARD_DEFAULTS},{secret:n=>values[n]??'',storeSecret:(n,v)=>{values[n]=v;}});
  expect(()=>panel.invoke('setKey',['OTHER_SECRET','test-token'])).toThrow();
  const result=panel.invoke('setKey',['ark','test-token']);expect(values.POSTCARD_ARK_API_KEY).toBe('test-token');expect(JSON.stringify(result)).not.toContain('test-token');
  expect((result as any).keys.ark).toBe(true);
 });
 it('redacts storage failures and rejects malformed credentials',()=>{
  const panel=new SetupPanel({...POSTCARD_DEFAULTS},{secret:()=>'',storeSecret:()=>{throw new Error('private-token');}});
  expect(()=>panel.invoke('setKey',['vision','private-token'])).toThrow('密钥未能保存');
  expect(()=>panel.invoke('setKey',['ark','a b'])).toThrow('有效');
 });
 it('checks locally without claiming service authentication',()=>{
  const panel=new SetupPanel({...POSTCARD_DEFAULTS,imageProxyUrl:'socks5://localhost:1234'});
  const check=panel.invoke('check') as any;expect(check.characterReference).toBe(true);expect(check.keys.ark).toBe(false);expect(check.imageProxy).toBe(false);expect(check.visionProxy).toBe(true);expect(check.cloudEnabled).toBe(true);
 });
});

it('千问与Gemini密钥独立，配置检查不接受错误服务Key',()=>{
 const values:Record<string,string>={POSTCARD_ARK_API_KEY:'ark-test',POSTCARD_IMAGE_API_KEY:'compatible-test'};const cfg={...POSTCARD_DEFAULTS,imageBackend:'qwen' as const,imageModel:'qwen-image-2.0',imageBaseUrl:'https://dashscope.aliyuncs.com/api/v1',imageSize:'1024*1536'};let panel=new SetupPanel(cfg,{secret:n=>values[n]??'',storeSecret:(n,v)=>{values[n]=v;}},undefined,()=>true);expect((panel.invoke('check') as any).imageReady).toBe(false);panel.invoke('setKey',['qwen','qwen-test']);expect(values.POSTCARD_QWEN_API_KEY).toBe('qwen-test');expect(JSON.stringify(panel.snapshot())).not.toContain('qwen-test');panel=new SetupPanel(cfg,{secret:n=>values[n]??'',storeSecret(){}},undefined,()=>true);expect((panel.invoke('check') as any).configurationReady).toBe(true);
});
