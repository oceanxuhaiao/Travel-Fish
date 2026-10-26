import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, openSync, closeSync, fsyncSync, unlinkSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export const SCENES = ['forest', 'coast', 'snow'] as const;
export type Scene = typeof SCENES[number];
export type Status = 'traveling' | 'awaiting_service' | 'generating' | 'failed' | 'cancelled' | 'completed';
export interface Trip { id: string; scene: Scene; startedAt: number; dueAt: number; status: Status; error?: string; completedAt?: number; phase?: string; generation?: Record<string,unknown>; }
export interface Card { tripId: string; scene: Scene; title: string; note: string; sha256: string; completedAt: number; generation?: Record<string,unknown>; }
interface Snapshot { schema: 1; trips: Trip[]; notified: string[]; }
/** Adapter must return an approved complete artifact, never a temporary URL. */
export interface Artifact { image: Uint8Array; title: string; note: string; generation?: Record<string,unknown>; }
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
  try { writeFileSync(fd, JSON.stringify(value, null, 2)); fsyncSync(fd); }
  finally { closeSync(fd); }
  try { renameSync(temporary, path); }
  catch (error) { try { unlinkSync(temporary); } catch {} throw error; }
}

export class TravelStore {
  readonly collection: string;
  private state: Snapshot = { schema: 1, trips: [], notified: [] };
  private lock = false;
  constructor(readonly root: string) { this.collection = join(root, 'collection'); }
  open(): void {
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
        else if (trip.status === 'generating') { trip.status = 'failed'; trip.error = '应用在生成过程中关闭，远端结果未知；请确认后手动重试'; }
        else if (trip.status === 'completed') throw new Error('收藏文件缺失或损坏，禁止自动重新收费生成');
      }
      if (this.state.trips.filter(t => active.has(t.status)).length > 1) throw new Error('存档包含多趟未结束旅行');
      this.persist();
    } catch (error) { this.close(); throw error; }
  }
  close(): void { if (this.lock) { unlinkSync(join(this.root, 'writer.lock')); this.lock = false; } }
  snapshot(): Snapshot { return structuredClone(this.state); }
  save(next: Snapshot): void {
    if (!this.lock) throw new Error('旅行存档未打开');
    atomicJson(join(this.root, 'state.json'), next); this.state = structuredClone(next);
  }
  persist(): void { this.save(this.state); }
  card(id: string): Card | null {
    if (!validId(id)) throw new Error('无效旅行编号');
    const folder = join(this.collection, id), file = join(folder, 'record.json');
    if (!existsSync(file)) return null;
    const record = JSON.parse(readFileSync(file, 'utf8')) as Card;
    const bytes = readFileSync(join(folder, 'postcard.png'));
    if (record.tripId !== id || !SCENES.includes(record.scene) || typeof record.title !== 'string' || typeof record.note !== 'string' || !Number.isFinite(record.completedAt) || record.sha256 !== createHash('sha256').update(bytes).digest('hex')) throw new Error('收藏文件校验失败');
    return record;
  }
  cards(): Card[] { return readdirSync(this.collection).filter(validId).map(id => this.card(id)!).filter(Boolean).sort((a,b) => b.completedAt-a.completedAt); }
  commit(trip: Trip, artifact: Artifact, now: number): Card {
    const existing = this.card(trip.id); if (existing) return existing;
    const bytes = Buffer.from(artifact.image);
    if (!bytes.subarray(0,8).equals(png) || !artifact.title || !artifact.note) throw new Error('生成产物不完整');
    const record: Card = { tripId: trip.id, scene: trip.scene, title: artifact.title, note: artifact.note, sha256: createHash('sha256').update(bytes).digest('hex'), completedAt: now, ...(artifact.generation ? { generation:artifact.generation } : {}) };
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
  constructor(readonly store: TravelStore, private generator: Generator | undefined, private now: () => number = Date.now) {}
  open(): void { this.store.open(); this.stopped = false; }
  async close(): Promise<void> { this.stopped = true; this.controller?.abort(); try {await this.flight;} finally {this.store.close();} }
  status(): Trip | null { const trips = this.store.snapshot().trips; return trips.find(t => active.has(t.status)) ?? trips.at(-1) ?? null; }
  start(scene: Scene, minutes: number): Trip {
    if (this.stopped) throw new Error('旅行服务未启动');
    if (!SCENES.includes(scene) || !Number.isFinite(minutes) || minutes <= 0 || minutes > 10080) throw new Error('目的地或旅行时长无效');
    const state = this.store.snapshot();
    if (state.trips.some(t => active.has(t.status))) throw new Error('已有未结束旅行，请先完成或取消');
    const trip: Trip = { id: randomUUID(), scene, startedAt: this.now(), dueAt: this.now()+minutes*60000, status: 'traveling' };
    if (this.generator?.prepare) trip.generation = this.generator.prepare(trip);
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
    const trip = state.trips.find(t => (t.status === 'traveling' || t.status === 'awaiting_service') && t.dueAt <= this.now());
    if (!trip) return;
    if (!this.generator) { trip.status = 'awaiting_service'; this.store.save(state); return; }
    trip.status = 'generating'; this.store.save(state); this.controller = new AbortController();
    try {
      const artifact = await this.generator(structuredClone(trip), this.controller.signal, phase=>{
        const snapshot = this.store.snapshot(), current = snapshot.trips.find(t=>t.id===trip.id)!;
        if (current.status === 'generating') { current.phase = phase; this.store.save(snapshot); }
      });
      const latest = this.store.snapshot(), current = latest.trips.find(t => t.id === trip.id)!;
      if (current.status === 'cancelled') return;
      if (this.stopped) { current.status = 'failed'; current.error = '生成被停止，确认服务状态后可手动重试'; this.store.save(latest); return; }
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
