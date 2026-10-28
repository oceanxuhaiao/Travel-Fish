import {randomUUID} from 'node:crypto';
import {existsSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {atomicJson} from './travel.ts';
import type {MailboxSnapshot} from './mailbox.ts';

export interface PickupRequest {requestId:string;tripId:string;to:number;phase:'offered'|'approaching'|'presenting';expiresAt:number;startedAt?:number;replay?:boolean;}
interface State {schema:1;records:Array<{tripId:string;done:boolean;attempted:boolean;requestedAt?:number}>;active?:PickupRequest;}
const uuid=/^[a-f0-9-]{36}$/;
/** A delivery performance is never the collection commit or the user's read receipt. */
export class PickupQueue {
  private state:State={schema:1,records:[]};private opened=false;
  private file:string;
  constructor(root:string,private mail:()=>MailboxSnapshot,private placement:()=>{to:number}|null,private now:()=>number=Date.now){this.file=join(root,'pickup.json');}
  open(){
    if(existsSync(this.file)){
      const value=JSON.parse(readFileSync(this.file,'utf8')) as State;
      if(value.schema!==1||!Array.isArray(value.records)||value.records.some(r=>!r||!uuid.test(r.tripId)||typeof r.done!=='boolean'||typeof r.attempted!=='boolean'||(r.requestedAt!==undefined&&(!Number.isFinite(r.requestedAt)||r.requestedAt<0)))||new Set(value.records.map(r=>r.tripId)).size!==value.records.length)throw Error('取信展示记录损坏，已暂停演出，收藏仍保留');
      this.state={schema:1,records:value.records}; // A previous process's lease must never resume.
    }else this.state={schema:1,records:this.mail().cards.map(c=>({tripId:c.tripId,done:true,attempted:true}))};
    this.save(this.state);this.opened=true;
  }
  private save(next:State){atomicJson(this.file,next);this.state=structuredClone(next);}
  private sync(){
    if(!this.opened)throw Error('取信展示尚未打开');
    const cards=this.mail().cards,known=new Set(this.state.records.map(r=>r.tripId));const added=cards.filter(c=>!known.has(c.tripId));
    const next=structuredClone(this.state);let changed=false;
    for(const card of added){next.records.push({tripId:card.tripId,done:!card.unread,attempted:!card.unread});changed=true;}
    if(next.active&&(next.active.expiresAt<=this.now()||!cards.some(c=>c.tripId===next.active!.tripId&&(c.unread||next.active!.replay)))){delete next.active;changed=true;}
    if(changed)this.save(next);
  }
  snapshot(){this.sync();return {active:this.state.active?structuredClone(this.state.active):null,pending:this.state.records.filter(r=>!r.done&&this.mail().cards.some(c=>c.tripId===r.tripId&&c.unread)).map(r=>r.tripId)};}
  offer(manual=false,tripId?:string):PickupRequest|null {
    this.sync();if(this.state.active)return structuredClone(this.state.active);
    const where=this.placement();if(!where)return null;
    const cards=this.mail().cards;const record=this.state.records.find(r=>(manual||!r.done)&&(manual||!r.attempted)&&(!tripId||r.tripId===tripId)&&cards.some(c=>c.tripId===r.tripId&&(manual||c.unread)));
    if(!record)return null;
    const next=structuredClone(this.state);next.records.find(r=>r.tripId===record.tripId)!.attempted=true;
    next.active={requestId:randomUUID(),tripId:record.tripId,to:where.to,phase:'offered',expiresAt:this.now()+120000,...(!cards.find(c=>c.tripId===record.tripId)!.unread?{replay:true}:{})};this.save(next);return structuredClone(next.active);
  }
  /** Native click entry: coalesce active work and persist per-letter rate limiting. */
  request(tripId:string){
    this.sync();const record=this.state.records.find(r=>r.tripId===tripId);
    if(!record||!this.mail().cards.some(c=>c.tripId===tripId))throw Error('没有这封已入藏的来信');
    if(this.state.active)return {kind:'in_progress',tripId:this.state.active.tripId,request:structuredClone(this.state.active)};
    if(record.done)return {kind:'open_local',tripId};
    const elapsed=record.requestedAt===undefined?Infinity:this.now()-record.requestedAt;
    if(elapsed<60000)return {kind:record.done?'open_local':'cooldown',tripId,retryAfterMs:Math.max(0,60000-elapsed)};
    const request=this.offer(true,tripId);if(!request)return {kind:'unavailable',tripId};
    const next=structuredClone(this.state);next.records.find(r=>r.tripId===tripId)!.requestedAt=this.now();this.save(next);
    return {kind:'requested',tripId,request};
  }
  step(requestId:string,action:'approach'|'arrived'|'defer'){
    this.sync();const req=this.state.active;if(!req||req.requestId!==requestId)throw Error('取信请求已过期、中断或被阅读操作替代，不再移动或展示');
    const where=this.placement();if(!where||Math.abs(where.to-req.to)>.005){this.pause();throw Error('邮箱已关闭或位置已变，请稍后重新取信');}
    const next=structuredClone(this.state);
    if(action==='defer'){delete next.active;this.save(next);return {deferred:true,cardSaved:true};}
    if(action==='approach'){
      if(req.phase==='presenting')return {accepted:true,presenting:true};
      next.active!.phase='approaching';this.save(next);return {requestId,tripId:req.tripId,to:req.to,expiresAt:req.expiresAt,instructions:'只在空闲且角色在主屏时调用pet_move_to；等待真实到达回执。停止/拖拽/失败时defer，禁止声称到达。到达后再arrived。'};
    }
    if(action!=='arrived'||req.phase==='offered')throw Error('请先取得靠近指令并等待移动回执');
    if(req.phase==='presenting')return {accepted:true,duplicate:true};
    next.active!.phase='presenting';next.active!.startedAt=this.now();next.active!.expiresAt=this.now()+15000;this.save(next);return {accepted:true,cardSaved:true,spatiallyVerified:false};
  }
  finish(requestId:string,tripId:string){
    this.sync();const req=this.state.active;if(!req||req.requestId!==requestId||req.tripId!==tripId||req.phase!=='presenting')throw Error('这次展示已失效，不能领取另一封信');
    const next=structuredClone(this.state);next.records.find(r=>r.tripId===tripId)!.done=true;delete next.active;this.save(next);return {accepted:true,tripId};
  }
  pause(tripId?:string){if(!this.opened||!this.state.active||(tripId&&this.state.active.tripId!==tripId))return;const next=structuredClone(this.state);delete next.active;this.save(next);}
}
