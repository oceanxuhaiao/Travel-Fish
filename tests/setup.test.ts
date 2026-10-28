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
