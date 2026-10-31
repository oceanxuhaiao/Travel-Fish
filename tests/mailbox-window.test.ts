import {it,expect,vi} from 'vitest';
import {EventEmitter} from 'node:events';
vi.mock('node:child_process',()=>({spawn:vi.fn()}));
import {spawn} from 'node:child_process';
import {MailboxWindow} from '../src/mailbox-window.ts';
it.skipIf(process.platform!=='win32')('邮箱只启动自身窗口，子进程不接收API密钥，通信鉴权及白名单生效',async()=>{
 const child:any=new EventEmitter();child.exitCode=null;child.kill=vi.fn(()=>{child.exitCode=0;child.emit('exit',0);});vi.mocked(spawn).mockReturnValue(child);
 const markRead=vi.fn(),pausePickup=vi.fn(),pickupRequest=vi.fn(()=>({kind:'requested'}));const window=new MailboxWindow({profile:'test-profile',runtime:()=>process.execPath,snapshot:()=>({phase:'idle',trip:null,progress:0,remainingMs:0,unreadCount:0,cards:[]}),read:()=>({title:'已入藏'}),markRead,pausePickup,pickupRequest});
 try{
  await Promise.all([window.open(),window.open()]);expect(spawn).toHaveBeenCalledTimes(1);const [,args,options]=vi.mocked(spawn).mock.calls[0];expect(args![0]).toMatch(/desktop[\\/]main\.cjs$/);const env=(options as any).env;
  expect(Object.keys(env).some(k=>/API_KEY|SECRET|CORTICO_DESKTOP_PET_HOST/.test(k))).toBe(false);
  expect((await fetch(env.POSTCARD_MAIL_ORIGIN+'/state')).status).toBe(401);
  const headers={Authorization:'Bearer '+env.POSTCARD_MAIL_TOKEN,'Content-Type':'application/json'};
  expect((await fetch(env.POSTCARD_MAIL_ORIGIN+'/state',{headers})).status).toBe(200);
  expect((await fetch(env.POSTCARD_MAIL_ORIGIN+'/mark-read',{method:'POST',headers,body:JSON.stringify({tripId:'../../config'})})).status).toBe(400);expect(markRead).not.toHaveBeenCalled();
  expect((await fetch(env.POSTCARD_MAIL_ORIGIN+'/start',{method:'POST',headers,body:'{}'})).status).toBe(404);
  const report=async(x:number,y:number,width=260,height=260,areaWidth=1920,areaHeight=1040)=>fetch(env.POSTCARD_MAIL_ORIGIN+'/window',{method:'POST',headers,body:JSON.stringify({bounds:{x,y,width,height},workArea:{x:0,y:0,width:areaWidth,height:areaHeight}})});
  expect((await report(900,780)).ok).toBe(true);const before=window.placement()!.to;expect(pausePickup).not.toHaveBeenCalled();expect((await report(400,600)).ok).toBe(true);expect(window.placement()!.to).toBeLessThan(before);expect(pausePickup).toHaveBeenCalledTimes(1);await report(400,500);expect(pausePickup).toHaveBeenCalledTimes(2);
  for(const width of [263,263.2,265,268,270])expect((await report(400,500,width)).status).toBe(200);
  expect(pausePickup).toHaveBeenCalledTimes(2); // A DPI size change alone is not a drag.
  const placement=window.placement();
  for(const dimensions of [[0,260,1920,1040],[-1,260,1920,1040],[260,0,1920,1040],[260,260,0,1040],[260,260,1920,-1],[Infinity,260,1920,1040]])expect((await report(400,500,...dimensions as [number,number,number,number])).status).toBe(409);
  expect(window.placement()).toEqual(placement);
  const screenReport=async(displayId:string,supported:boolean)=>fetch(env.POSTCARD_MAIL_ORIGIN+'/window',{method:'POST',headers,body:JSON.stringify({displayId,primaryDisplayId:'1',pickupSupported:supported,bounds:{x:400,y:500,width:263,height:260},workArea:{x:0,y:0,width:1920,height:1040}})});
  await screenReport('2',true);expect(window.placement()).toBeNull(); // Never send primary-relative movement for a secondary display.
  const id='00000000-0000-0000-0000-000000000001';const click=()=>fetch(env.POSTCARD_MAIL_ORIGIN+'/pickup-request',{method:'POST',headers,body:JSON.stringify({tripId:id})}).then(r=>r.json());
  expect(await click()).toEqual({kind:'open_local',tripId:id});expect(pickupRequest).not.toHaveBeenCalled();expect(markRead).not.toHaveBeenCalled();
  await screenReport('1',false);expect(await click()).toEqual({kind:'open_local',tripId:id});expect(window.placement()).toBeNull();
  await screenReport('1',true);expect(window.placement()).not.toBeNull();expect(await click()).toEqual({kind:'requested'});expect(pickupRequest).toHaveBeenCalledOnce();
  await window.open();expect(spawn).toHaveBeenCalledTimes(1);
 }finally{await window.close();}expect(child.kill).toHaveBeenCalled();
});
