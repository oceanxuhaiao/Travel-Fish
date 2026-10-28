import {it,expect,vi} from 'vitest';
import {EventEmitter} from 'node:events';
vi.mock('node:child_process',()=>({spawn:vi.fn()}));
import {spawn} from 'node:child_process';
import {MailboxWindow} from '../src/mailbox-window.ts';
it.skipIf(process.platform!=='win32')('邮箱只启动自身窗口，子进程不接收API密钥，通信鉴权及白名单生效',async()=>{
 const child:any=new EventEmitter();child.exitCode=null;child.kill=vi.fn(()=>{child.exitCode=0;child.emit('exit',0);});vi.mocked(spawn).mockReturnValue(child);
 const markRead=vi.fn();const window=new MailboxWindow({profile:'test-profile',runtime:()=>process.execPath,snapshot:()=>({phase:'idle',trip:null,progress:0,remainingMs:0,unreadCount:0,cards:[]}),read:()=>({title:'已入藏'}),markRead});
 try{
  await Promise.all([window.open(),window.open()]);expect(spawn).toHaveBeenCalledTimes(1);const [,args,options]=vi.mocked(spawn).mock.calls[0];expect(args![0]).toMatch(/desktop[\\/]main\.cjs$/);const env=(options as any).env;
  expect(Object.keys(env).some(k=>/API_KEY|SECRET|CORTICO_DESKTOP_PET_HOST/.test(k))).toBe(false);
  expect((await fetch(env.POSTCARD_MAIL_ORIGIN+'/state')).status).toBe(401);
  const headers={Authorization:'Bearer '+env.POSTCARD_MAIL_TOKEN,'Content-Type':'application/json'};
  expect((await fetch(env.POSTCARD_MAIL_ORIGIN+'/state',{headers})).status).toBe(200);
  expect((await fetch(env.POSTCARD_MAIL_ORIGIN+'/mark-read',{method:'POST',headers,body:JSON.stringify({tripId:'../../config'})})).status).toBe(400);expect(markRead).not.toHaveBeenCalled();
  expect((await fetch(env.POSTCARD_MAIL_ORIGIN+'/start',{method:'POST',headers,body:'{}'})).status).toBe(404);
  await window.open();expect(spawn).toHaveBeenCalledTimes(1);
 }finally{await window.close();}expect(child.kill).toHaveBeenCalled();
});
