import {existsSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {atomicJson} from './travel.ts';
interface Schedule {schema:1;enabled:boolean;minutes:number;eligible:boolean;nextAt:number|null;lastInvitedAt:number|null;}
/** Owns only an external invitation schedule, never the pet's mood or permission. */
export class InvitationSchedule {
 private state?:Schedule;
 private retryAt=0;
 constructor(private root:string,private now:()=>number=Date.now){}
 open(){const file=join(this.root,'invitations.json');if(!existsSync(file))return;
  const value=JSON.parse(readFileSync(file,'utf8')) as Schedule;
  if(value.schema!==1||typeof value.enabled!=='boolean'||typeof value.eligible!=='boolean'||!Number.isFinite(value.minutes)||value.minutes<1||value.minutes>43200||![value.nextAt,value.lastInvitedAt].every(v=>v===null||Number.isFinite(v)))throw Error('旅行询问日程损坏，请从备份恢复');
  this.state=value;
 }
 private save(value:Schedule){atomicJson(join(this.root,'invitations.json'),value);this.state=value;}
 snapshot(){return this.state?structuredClone(this.state):null;}
 async tick(enabled:boolean,minutes:number,available:boolean,emit:()=>Promise<void>){
  if(!Number.isFinite(minutes)||minutes<1||minutes>43200)throw Error('旅行询问间隔无效');
  const now=this.now(),eligible=enabled&&available,old=this.state;
  if(!old||old.enabled!==enabled||old.minutes!==minutes||old.eligible!==eligible){
   this.save({schema:1,enabled,minutes,eligible,nextAt:eligible?now+minutes*60000:null,lastInvitedAt:old?.lastInvitedAt??null});return;
  }
  if(!eligible||old.nextAt===null||now<old.nextAt||now<this.retryAt)return;
  // Backoff applies even when event transport fails. Never replay every missed interval.
  this.retryAt=now+Math.min(minutes*60000,300000);
  await emit();
  this.save({...old,nextAt:now+minutes*60000,lastInvitedAt:now});
 }
}
