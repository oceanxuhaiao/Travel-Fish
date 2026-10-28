import type {PickupRequest} from './pickup.ts';
import {existsSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {atomicJson,type TravelService} from './travel.ts';

interface MailState {schema:1;entries:Array<{tripId:string;readAt:number|null}>;}
export interface MailboxSnapshot {
  height?:number;pickup?:{active:PickupRequest|null;pending:string[]};
  phase:'idle'|'traveling'|'waiting'|'mail_waiting'|'failed';
  trip:{id:string;startedAt:number;dueAt:number;status:string}|null;
  progress:number;remainingMs:number;unreadCount:number;
  cards:Array<{tripId:string;title:string;completedAt:number;unread:boolean}>;
}
const idPattern=/^[a-f0-9-]{36}$/;
/** Presentation state is independent of collection and notification acknowledgement. */
export class MailboxStore {
  private state:MailState={schema:1,entries:[]};
  private opened=false;
  private get file(){return join(this.service.store.root,'mailbox.json');}
  constructor(private service:TravelService,private now:()=>number=Date.now){}
  open():void {
    const cards=this.service.store.cards();
    if(existsSync(this.file)){
      const raw=JSON.parse(readFileSync(this.file,'utf8')) as MailState;
      if(raw.schema!==1||!Array.isArray(raw.entries)||raw.entries.some(e=>!e||!idPattern.test(e.tripId)||(e.readAt!==null&&(!Number.isFinite(e.readAt)||e.readAt<0)))||new Set(raw.entries.map(e=>e.tripId)).size!==raw.entries.length)throw Error('邮箱已读记录损坏，请恢复备份；旅行收藏未改动');
      this.state=raw;
    }else{
      // Existing collections are a migration baseline, not a flood of new letters.
      this.state={schema:1,entries:cards.map(c=>({tripId:c.tripId,readAt:this.now()}))};
      atomicJson(this.file,this.state);
    }
    this.opened=true;this.sync();
  }
  private sync():void {
    if(!this.opened)throw Error('邮箱尚未打开');
    const known=new Set(this.state.entries.map(e=>e.tripId));
    const added=this.service.store.cards().filter(c=>!known.has(c.tripId));
    if(added.length){const next:MailState={schema:1,entries:[...this.state.entries,...added.map(c=>({tripId:c.tripId,readAt:null}))]};atomicJson(this.file,next);this.state=next;}
  }
  snapshot():MailboxSnapshot {
    this.sync();const trip=this.service.status(),now=this.now();
    const cards=this.service.store.cards().map(c=>({tripId:c.tripId,title:c.title,completedAt:c.completedAt,unread:this.state.entries.find(e=>e.tripId===c.tripId)?.readAt===null}));
    const unfinished=!!trip&&['traveling','generating','awaiting_service','failed'].includes(trip.status);
    const remainingMs=unfinished?Math.max(0,trip!.dueAt-now):0;
    const progress=trip?Math.max(0,Math.min(1,(now-trip.startedAt)/Math.max(1,trip.dueAt-trip.startedAt))):0;
    const unreadCount=cards.filter(c=>c.unread).length;
    const phase=unfinished?(trip!.status==='failed'?'failed':remainingMs>0?'traveling':'waiting'):unreadCount?'mail_waiting':'idle';
    return {phase,trip:unfinished?{id:trip!.id,startedAt:trip!.startedAt,dueAt:trip!.dueAt,status:trip!.status}:null,progress,remainingMs,unreadCount,cards};
  }
  markRead(id:string):MailboxSnapshot {
    this.sync();if(!this.service.store.card(id))throw Error('只能标记已入藏的明信片');
    const entry=this.state.entries.find(e=>e.tripId===id);if(!entry)throw Error('邮箱中没有这封信');
    if(entry.readAt===null){const next=structuredClone(this.state);next.entries.find(e=>e.tripId===id)!.readAt=this.now();atomicJson(this.file,next);this.state=next;}
    return this.snapshot();
  }
}
