import {existsSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {atomicJson} from './travel.ts';
/** A recap is only for the first invitation after a new node arrived, so the same line does not repeat. */
export function shouldRecap(lastInvitedAt:number|null, latestCompletedAt:number|undefined):boolean {
  return typeof latestCompletedAt === 'number' && (lastInvitedAt === null || lastInvitedAt < latestCompletedAt);
}

export interface InvitationRecap {delivered:number;cards:ReadonlyArray<{title:string;note:string}>}

const NOTE_EXCERPT_LIMIT = 120;

/** The host gets the title and a bounded note excerpt; it picks what, if anything, to mention. */
export function invitationText(minutes:number, recap?:InvitationRecap|null, continuing=false):string {
  const head = `用户设置的旅行主动询问间隔已到，本次等待间隔已满${minutes}分钟。`;
  if (!recap || !recap.cards.length) return head + (continuing?'当前系列尚未完成，目前没有进行中的一轮，明信片生成服务已连接。用户尚未同意继续旅行。':'目前没有未结束旅行，明信片生成服务已连接。用户尚未同意新的旅行。');
  const cards = recap.cards.map(card => {
    const title = card.title.replace(/[《》]/gu,'');
    const flat = card.note.replace(/\s+/gu,' ').trim();
    const note = flat.length > NOTE_EXCERPT_LIMIT ? flat.slice(0,NOTE_EXCERPT_LIMIT)+'…' : flat;
    return `《${title}》：${note}`;
  }).join('；');
  return head + `这段三段旅程已寄回${recap.delivered}/3：\n${cards}\n旅程还差${3-recap.delivered}段；目前没有进行中的一轮，明信片生成服务已连接。用户尚未同意再出发。`;
}

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
