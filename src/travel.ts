import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, openSync, closeSync, fsyncSync, unlinkSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type {Journey,SeriesRef} from './journey-types.ts';

import {SCENES,chooseScene,freezeScene,type Scene,type Destination,type SceneSnapshot,type VisualVariation} from './scenes.ts';
export {SCENES,type Scene} from './scenes.ts';
export type Status = 'traveling' | 'awaiting_service' | 'generating' | 'failed' | 'cancelled' | 'completed';
export interface Trip { id: string; scene: Scene; series?:SeriesRef;contentId?:string;prepareDuringTravel?:boolean; sceneSnapshot?: SceneSnapshot; startedAt: number; dueAt: number; status: Status; error?: string; completedAt?: number; phase?: string; generation?: Record<string,unknown>; }
export interface Card { tripId: string; scene: Scene; series?:SeriesRef;sceneLabel?: string; title: string; note: string; sha256: string; completedAt: number; generation?: Record<string,unknown>; }
interface Snapshot { schema: 1; trips: Trip[]; notified: string[]; journeys?:Journey[]; }
/** Adapter must return an approved complete artifact, never a temporary URL. */
export interface Artifact { image: Uint8Array; title: string; note: string; generation?: Record<string,unknown>; }
/** A legacy catalogue label on a series card is a plan, not the delivered scene. */
export function collectionSceneLabel(card:Card):string|undefined {
 const actual=card.generation?.storyLocation;
 return typeof actual==='string'&&actual.trim()?actual:card.series?undefined:card.sceneLabel;
}
export interface Generator {
  (trip: Readonly<Trip>, signal: AbortSignal, phase?: (value: string)=>void): Promise<Artifact>;
  prepare?(trip: Readonly<Trip>): Record<string,unknown>;
  confirmRetry?(trip: Readonly<Trip>, confirmUnknownOutcome: boolean): void;
}
const active = new Set<Status>(['traveling', 'awaiting_service', 'generating', 'failed']);
const validId = (id: string) => /^[a-f0-9-]{36}$/.test(id);
const png = Buffer.from('89504e470d0a1a0a', 'hex');

export function atomicJson(path: string, value: unknown): void {
  const temporary = path + '.' + randomUUID() + '.tmp';
  const fd = openSync(temporary, 'wx');
  try {
    try { writeFileSync(fd, JSON.stringify(value, null, 2)); fsyncSync(fd); }
    finally { closeSync(fd); }
    renameSync(temporary, path);
  }
  catch (error) { try { unlinkSync(temporary); } catch {} throw error; }
}

export class TravelStore {
  readonly collection: string;
  private state: Snapshot = { schema: 1, trips: [], notified: [] };
  private lock = false;
  private cardCache = new Map<string,{fingerprint:string;record:Card}>();
  constructor(readonly root: string) { this.collection = join(root, 'collection'); }
  open(): void {
    this.cardCache.clear();
    mkdirSync(this.collection, { recursive: true });
    const lockPath = join(this.root, 'writer.lock');
    try {
      const fd = openSync(lockPath, 'wx');
      writeFileSync(fd, String(process.pid)); closeSync(fd); this.lock = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const pid = Number(readFileSync(lockPath, 'utf8'));
      if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('旅行存档锁损坏，请检查后恢复');
      let alive = true;
      try { process.kill(pid, 0); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ESRCH') alive = false; }
      if (alive) throw new Error('旅行存档正在被另一个实例使用');
      unlinkSync(lockPath); return this.open();
    }
    try {
      const file = join(this.root, 'state.json');
      if (existsSync(file)) {
        const value = JSON.parse(readFileSync(file, 'utf8')) as Snapshot;
        if (value.schema !== 1 || !Array.isArray(value.trips) || !Array.isArray(value.notified)
          || value.notified.some(id => typeof id !== 'string' || !validId(id))
          || value.trips.some(t => !t || !validId(t.id) || !SCENES.includes(t.scene) || !Number.isFinite(t.dueAt) || !Number.isFinite(t.startedAt) || !['traveling','awaiting_service','generating','failed','cancelled','completed'].includes(t.status))
          || new Set(value.trips.map(t => t.id)).size !== value.trips.length) throw new Error('旅行存档损坏或版本不支持');
        this.state = value;
      }
      for (const trip of this.state.trips) {
        const card = this.card(trip.id);
        if (card) { trip.status = 'completed'; trip.completedAt = card.completedAt; delete trip.error; }
        else if (trip.status === 'generating'&&trip.prepareDuringTravel) {try{if(this.stagedArtifact(trip.id)){trip.status='traveling';trip.phase='ready_for_return';}else{trip.status='failed';trip.error='应用在生成过程中关闭，请检查服务状态后手动继续';}}catch{trip.status='failed';trip.error='待交付成品损坏，请恢复备份，禁止重新收费生成';}}
        else if (trip.status === 'generating') { trip.status = 'failed'; trip.error = '应用在生成过程中关闭，远端结果未知；请确认后手动重试'; }
        else if (trip.status === 'completed') throw new Error('收藏文件缺失或损坏，禁止自动重新收费生成');
      }
      if (this.state.trips.filter(t => active.has(t.status)).length > 1) throw new Error('存档包含多趟未结束旅行');
      this.validateJourneys();
      this.persist();
    } catch (error) { this.close(); throw error; }
  }
  stageArtifact(trip:Trip,artifact:Artifact):void {
    if(!validId(trip.id))throw new Error('旅行编号无效');
    const folder=join(this.root,'prepared',trip.id);mkdirSync(folder,{recursive:true});const image=Buffer.from(artifact.image);
    if(!image.subarray(0,8).equals(png))throw new Error('候选成品不是PNG');
    const target=join(folder,'postcard.png'),temp=target+'.'+randomUUID()+'.tmp';const fd=openSync(temp,'wx');try{writeFileSync(fd,image);fsyncSync(fd);}finally{closeSync(fd);}renameSync(temp,target);
    atomicJson(join(folder,'artifact.json'),{title:artifact.title,note:artifact.note,generation:artifact.generation,sha256:createHash('sha256').update(image).digest('hex')});
  }
  stagedArtifact(id:string):Artifact|null {
    if(!validId(id))throw new Error('旅行编号无效');const folder=join(this.root,'prepared',id),meta=join(folder,'artifact.json');if(!existsSync(meta))return null;
    const record=JSON.parse(readFileSync(meta,'utf8')),image=readFileSync(join(folder,'postcard.png'));
    if(typeof record.title!=='string'||typeof record.note!=='string'||createHash('sha256').update(image).digest('hex')!==record.sha256)throw new Error('待交付成品损坏，禁止重新收费生成');
    return {image,title:record.title,note:record.note,generation:record.generation};
  }
  close(): void { if (this.lock) { unlinkSync(join(this.root, 'writer.lock')); this.lock = false; } }
  snapshot(): Snapshot { return structuredClone(this.state); }
  private validateJourneys():void {
    const journeys=this.state.journeys??[];
    if(!Array.isArray(journeys)||new Set(journeys.map(j=>j.id)).size!==journeys.length||journeys.some(j=>!validId(j.id)||typeof j.mark!=='string'||!SCENES.includes(j.scene as Scene)||!Number.isFinite(j.createdAt)||(j.endedAt!==undefined&&!Number.isFinite(j.endedAt))))throw Error('系列存档损坏');
    for(const t of this.state.trips){
      if(t.contentId&&(!validId(t.contentId)||!this.state.trips.some(p=>p.id===t.contentId&&p.series?.id===t.series?.id&&p.series?.nodeIndex===t.series?.nodeIndex)))throw Error('系列内容归属损坏');
      if(t.series){const s=t.series,j=journeys.find(j=>j.id===s.id);if(!j||s.total!==3||!Number.isInteger(s.nodeIndex)||s.nodeIndex<1||s.nodeIndex>3||s.mark!==j.mark)throw Error('系列节点归属损坏');}
    }
    for(const j of journeys)if(j.summary&&(!['running','failed','ready'].includes(j.summary.status)||!Number.isInteger(j.summary.attempts)||j.summary.attempts<1||j.summary.attempts>2||!/^[a-f0-9]{64}$/.test(j.summary.sourceHash)))throw Error('系列总结检查点损坏');
    for(const j of journeys){const indices=this.cards().filter(c=>c.series?.id===j.id).map(c=>c.series!.nodeIndex).sort();if(indices.some((v,i)=>v!==i+1)||indices.length>3)throw Error('系列已交付节点不连续');}
  }
  updateJourney(id:string,change:(journey:Journey)=>void):void {const state=this.snapshot(),j=state.journeys?.find(j=>j.id===id);if(!j)throw Error('没有这个系列');change(j);this.save(state);}
  save(next: Snapshot): void {
    if (!this.lock) throw new Error('旅行存档未打开');
    atomicJson(join(this.root, 'state.json'), next); this.state = structuredClone(next);
  }
  persist(): void { this.save(this.state); }
  /** Explicit reads/exports always hash; list polling reuses only unchanged files. */
  card(id: string, verify = true): Card | null {
    if (!validId(id)) throw new Error('无效旅行编号');
    const folder = join(this.collection, id), file = join(folder, 'record.json');
    if (!existsSync(file)) { this.cardCache.delete(id); return null; }
    const fingerprint=[file,join(folder,'postcard.png')].map(path=>{
      const s=statSync(path,{bigint:true});return [s.dev,s.ino,s.size,s.mtimeNs,s.ctimeNs].join(':');
    }).join('|');
    const cached=this.cardCache.get(id);
    if(!verify&&cached?.fingerprint===fingerprint)return structuredClone(cached.record);
    const record = JSON.parse(readFileSync(file, 'utf8')) as Card;
    if(record.series){const owner=this.state.trips.find(t=>t.id===id);if(!owner?.series||JSON.stringify(record.series)!==JSON.stringify(owner.series))throw Error('收藏系列归属校验失败');}
    const bytes = readFileSync(join(folder, 'postcard.png'));
    if (record.tripId !== id || !SCENES.includes(record.scene) || typeof record.title !== 'string' || typeof record.note !== 'string' || !Number.isFinite(record.completedAt) || record.sha256 !== createHash('sha256').update(bytes).digest('hex')) throw new Error('收藏文件校验失败');
    this.cardCache.set(id,{fingerprint,record:structuredClone(record)});
    if(this.cardCache.size>512)this.cardCache.delete(this.cardCache.keys().next().value!);
    return record;
  }
  cards(): Card[] { return readdirSync(this.collection).filter(validId).map(id => this.card(id,false)!).filter(Boolean).sort((a,b) => b.completedAt-a.completedAt); }
  commit(trip: Trip, artifact: Artifact, now: number): Card {
    const existing = this.card(trip.id); if (existing) return existing;
    const bytes = Buffer.from(artifact.image);
    if (!bytes.subarray(0,8).equals(png) || !artifact.title || !artifact.note) throw new Error('生成产物不完整');
    const record: Card = { tripId: trip.id, scene: trip.scene, ...(trip.series?{series:trip.series}:{}),...(typeof artifact.generation?.storyLocation==='string'?{sceneLabel:artifact.generation.storyLocation}:trip.sceneSnapshot?{sceneLabel:trip.sceneSnapshot.label}:{}), title: artifact.title, note: artifact.note, sha256: createHash('sha256').update(bytes).digest('hex'), completedAt: now, ...(artifact.generation ? { generation:artifact.generation } : {}) };
    const pending = join(this.collection, trip.id+'.'+randomUUID()+'.pending');
    mkdirSync(pending);
    writeFileSync(join(pending,'postcard.png'), bytes, { flag: 'wx' });
    writeFileSync(join(pending,'note.md'), '# '+artifact.title+'\n\n'+artifact.note+'\n', { flag: 'wx' });
    atomicJson(join(pending,'record.json'), record);
    renameSync(pending, join(this.collection,trip.id));
    return record;
  }
}

export class TravelService {
  private flight?: Promise<void>;
  private controller?: AbortController;
  private stopped = true;
  constructor(readonly store: TravelStore, private generator: Generator | undefined, private now: () => number = Date.now,private earlyPreparation=false,readonly roundMinutes=120) {if(roundMinutes!==120&&roundMinutes!==5)throw Error('仅支持正式2小时或开发5分钟');}
  open(): void { this.store.open(); this.stopped = false; }
  async close(): Promise<void> { this.stopped = true; this.controller?.abort(); try {await this.flight;} finally {this.store.close();} }
  status(): Trip | null { const trips = this.store.snapshot().trips; return trips.find(t => active.has(t.status)) ?? trips.at(-1) ?? null; }
  journeyCards(id:string):Card[] {return this.store.cards().filter(c=>c.series?.id===id).sort((a,b)=>a.series!.nodeIndex-b.series!.nodeIndex);}
  journeyStatus(id?:string){
    const state=this.store.snapshot(),list=state.journeys??[],j=id?list.find(j=>j.id===id):[...list].reverse().find(j=>!j.endedAt&&this.journeyCards(j.id).length<3)??list.at(-1);
    if(!j)return null;
    const cards=this.journeyCards(j.id),running=state.trips.find(t=>t.series?.id===j.id&&active.has(t.status));
    let summary=j.summary?structuredClone(j.summary):null;
    if(summary?.status==='ready'){
      const sources=cards.map(c=>({tripId:c.tripId,nodeIndex:c.series!.nodeIndex,title:c.title,note:c.note,noteHash:createHash('sha256').update(c.note).digest('hex'),imageHash:c.sha256}));
      if(summary.sourceHash!==createHash('sha256').update(JSON.stringify(sources)).digest('hex')||typeof summary.text!=='string'||summary.textHash!==createHash('sha256').update(summary.text).digest('hex'))summary={...summary,status:'failed',text:undefined,error:'总结或来源校验失败，请恢复记录；不会自动重新收费'};
    }
    return {id:j.id,mark:j.mark,completed:cards.length,total:3,phase:j.endedAt?'ended':running?'traveling':cards.length===3?'completed':'waiting_continue',nextNode:cards.length<3?cards.length+1:null,summary};
  }
  startSeries():Trip {return this.start('surprise',this.roundMinutes,true);}
  endJourney(id:string){
    const j=this.store.snapshot().journeys?.find(j=>j.id===id);if(!j)throw Error('没有这个系列');
    if(this.store.snapshot().trips.some(t=>t.series?.id===id&&active.has(t.status)))throw Error('请先完成或取消当前这一轮，再结束系列');
    if(this.journeyCards(id).length===3)throw Error('系列已经完成');
    this.store.updateJourney(id,j=>{j.endedAt??=this.now();});return this.journeyStatus(id);
  }
  start(destination: Destination, minutes: number, seriesMode=false): Trip {
    if (this.stopped) throw new Error('旅行服务未启动');
    if (!(destination==='surprise'||SCENES.includes(destination)) || !Number.isFinite(minutes) || minutes <= 0 || minutes > 10080) throw new Error('目的地或旅行时长无效');
    const state = this.store.snapshot();
    if (state.trips.some(t => active.has(t.status))) throw new Error('已有未结束旅行，请先完成或取消');
    const id=randomUUID();
    let journey:Journey|undefined,previous:Trip|undefined,series:SeriesRef|undefined;
    if(seriesMode){
      state.journeys??=[];
      journey=[...state.journeys].reverse().find(j=>!j.endedAt&&this.journeyCards(j.id).length<3);
      if(!journey){const jid=randomUUID();journey={id:jid,mark:'旅迹·'+jid.slice(0,8),scene:chooseScene(jid,state.trips.map(t=>t.scene)),createdAt:this.now()};state.journeys.push(journey);}
      const nodeIndex=this.journeyCards(journey.id).length+1;
      series={id:journey.id,mark:journey.mark,nodeIndex,total:3};
      previous=[...state.trips].reverse().find(t=>t.series?.id===journey!.id&&t.series.nodeIndex===nodeIndex&&t.status==='cancelled');
      if(previous)this.generator?.confirmRetry?.(previous,false);
      minutes=this.roundMinutes;
    }
    const recent=state.trips.slice().reverse();
    const recentScenes=recent.map(t=>t.scene);
    const scene=journey?journey.scene as Scene:destination==='surprise'?chooseScene(id,recentScenes):destination;
    const recentVariants=recent.filter(t=>t.scene===scene).map(t=>t.sceneSnapshot?.id??t.generation?.sceneVariant).filter((v):v is string=>typeof v==='string');
    const trip: Trip = { id, scene,...(this.earlyPreparation?{prepareDuringTravel:true}:{}), sceneSnapshot:freezeScene(id,scene,recentScenes,recentVariants,recent.filter(t=>t.status==='completed').map(t=>t.sceneSnapshot?.visualVariation).filter((v):v is VisualVariation=>!!v).slice(0,6)), startedAt: this.now(), dueAt: this.now()+minutes*60000, status: 'traveling' };
    if(series){trip.series=series;if(previous){trip.contentId=previous.contentId??previous.id;trip.sceneSnapshot=previous.sceneSnapshot;trip.generation=previous.generation;}}
    if (this.generator?.prepare&&!previous) trip.generation = this.generator.prepare(trip);
    if(previous){const cached=this.store.stagedArtifact(previous.id);if(cached)this.store.stageArtifact(trip,cached);}
    state.trips.push(trip); this.store.save(state); return structuredClone(trip);
  }
  cancel(id: string): Trip {
    const state = this.store.snapshot(), trip = state.trips.find(t => t.id === id);
    if (!trip || !active.has(trip.status)) throw new Error('这趟旅行不能取消');
    trip.status = 'cancelled'; this.store.save(state); this.controller?.abort(); return structuredClone(trip);
  }
  retry(id: string, confirmUnknownOutcome = false): Trip {
    const state = this.store.snapshot(), trip = state.trips.find(t => t.id === id);
    if (!trip || trip.status !== 'failed') throw new Error('仅失败旅行可以重试');
    if (this.flight) throw new Error('上次生成尚未退出');
    if (this.store.card(id)) throw new Error('已有收藏，无需重新生成');
    this.generator?.confirmRetry?.(trip, confirmUnknownOutcome);
    trip.status = 'traveling'; delete trip.error; this.store.save(state); return structuredClone(trip);
  }
  tick(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    if (this.flight) return this.flight;
    this.flight = this.advance().finally(() => { this.flight = undefined; this.controller = undefined; });
    return this.flight;
  }
  private async advance(): Promise<void> {
    const state = this.store.snapshot();
    const trip = state.trips.find(t => (t.status === 'traveling' || t.status === 'awaiting_service') && (t.dueAt <= this.now()||t.prepareDuringTravel));
    if (!trip) return;
    let prepared:Artifact|null;try{prepared=trip.prepareDuringTravel?this.store.stagedArtifact(trip.id):null;}catch{trip.status='failed';trip.error='待交付成品损坏，请恢复备份，禁止重新收费生成';this.store.save(state);return;}
    if(prepared){if(this.now()<trip.dueAt)return;try{const card=this.store.commit(trip,prepared,this.now());trip.status='completed';trip.completedAt=card.completedAt;delete trip.error;}catch{trip.status='failed';trip.error='成品交付保存失败，已保留待交付文件；请检查磁盘后手动继续';}this.store.save(state);return;}
    if (!this.generator) { if(this.now()<trip.dueAt)return;trip.status = 'awaiting_service'; this.store.save(state); return; }
    trip.status = 'generating'; this.store.save(state); this.controller = new AbortController();
    try {
      const artifact = await this.generator(structuredClone(trip), this.controller.signal, phase=>{
        const snapshot = this.store.snapshot(), current = snapshot.trips.find(t=>t.id===trip.id)!;
        if (current.status === 'generating') { current.phase = phase; this.store.save(snapshot); }
      });
      const latest = this.store.snapshot(), current = latest.trips.find(t => t.id === trip.id)!;
      if (current.status === 'cancelled') return;
      if (this.stopped) { current.status = 'failed'; current.error = '生成被停止，确认服务状态后可手动重试'; this.store.save(latest); return; }
      if(current.prepareDuringTravel){this.store.stageArtifact(current,artifact);if(this.now()<current.dueAt){current.status='traveling';current.phase='ready_for_return';delete current.error;this.store.save(latest);return;}}
      const card = this.store.commit(current, artifact, this.now());
      current.status = 'completed'; current.completedAt = card.completedAt; delete current.error; this.store.save(latest);
    } catch (error) {
      const latest = this.store.snapshot(), current = latest.trips.find(t => t.id === trip.id)!;
      if (current.status !== 'cancelled') {
        const card = this.store.card(current.id);
        if (card) { current.status = 'completed'; current.completedAt = card.completedAt; }
        else { current.status = 'failed'; current.error = error instanceof Error && error.name === 'PostcardPipelineError' ? error.message : '来信未准备好；可能涉及远端请求或保存失败，请检查后手动重试'; }
        this.store.save(latest);
      }
    }
  }
  pendingNotifications(): Card[] { const state = this.store.snapshot(); return this.store.cards().filter(c => !state.notified.includes(c.tripId)); }
  acknowledge(id: string): void { const state = this.store.snapshot(); if (!state.notified.includes(id)) { state.notified.push(id); this.store.save(state); } }
}
