import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import type { World, WorldHost, ToolDef, WorldWebUiDecl } from 'cortico/core/types.ts';
import type { PostcardConfigSection } from './config.ts';
import { POSTCARD_CONFIG_GROUP } from './config.ts';
import { TravelService, TravelStore, type Generator, type Scene } from './travel.ts';
import {SCENES,type Destination} from './scenes.ts';
import { PostcardPanel } from './panel.ts';

const ENV_PROMPT_FILE = fileURLToPath(new URL('./ENV_PROMPT.md', import.meta.url));
const idParam = { type: 'object', additionalProperties: false, properties: { tripId: { type: 'string', description: 'Trip id from postcard_status.' } }, required: ['tripId'] };
export const POSTCARD_TOOL_DECLS: ReadonlyArray<Omit<ToolDef, 'handler'>> = [
  { name: 'postcard_start', description: 'Start one virtual pet trip when the user asks. Duration is real waiting time; generation may take additional time. Only one unfinished trip is allowed.', tags: ['write'], parameters: { type: 'object', additionalProperties: false, properties: { scene: { type: 'string', enum: ['surprise',...SCENES], description:'Fictional environment, or surprise for a balanced random trip. No real geography.' } }, required: ['scene'] } },
  { name: 'postcard_status', description: 'Read the current trip and availability. awaiting_service means a generator is not connected; do not claim a postcard exists.', tags: ['read'], parameters: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'postcard_list', description: 'List permanently saved postcards.', tags: ['read'], parameters: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'postcard_read', description: 'Read a completed postcard title and note by trip id.', tags: ['read'], parameters: idParam },
  { name: 'postcard_cancel', description: 'Cancel a trip on user request. A remote request already sent may still incur a charge.', tags: ['write'], parameters: idParam },
  { name: 'postcard_retry', description: 'Manually retry a failed trip only after the user requests it. For an uncertain image outcome, set confirmUnknownOutcome only after the user has explicitly confirmed checking the previous result and possible charge.', tags: ['write'], parameters: { ...idParam,properties:{...idParam.properties,confirmUnknownOutcome:{type:'boolean',description:'True only after the user explicitly confirms the uncertain previous request and possible charge.'}} } },
];

export class PostcardWorld implements World {
  readonly id = 'postcard';
  readonly service: TravelService;
  private timer?: ReturnType<typeof setInterval>;
  private host?: WorldHost;
  private pulseFlight?: Promise<void>;
  readonly panel:PostcardPanel;
  constructor(private opts: { cfg: PostcardConfigSection; dataDir: string; generator?: Generator; now?:()=>number }) {
    this.service = new TravelService(new TravelStore(join(opts.dataDir,'postcard')), opts.generator, opts.now);
    this.panel=new PostcardPanel(this.service,()=>({minutes:this.opts.cfg.minutes,generatorConnected:!!this.opts.generator}));
  }
  envPromptVars(): Record<string,string> { return { 'postcard.availability': this.opts.generator ? '已接入生成服务' : '旅行核心预览，生成服务尚未接入，不会实际生图' }; }
  tools(): ToolDef[] {
    return POSTCARD_TOOL_DECLS.map(decl => ({ ...decl, handler: async (args) => {
      let result: unknown;
      switch (decl.name) {
        case 'postcard_start': result = this.service.start(args.scene as Destination, this.opts.cfg.minutes); break;
        case 'postcard_status': result = { trip: this.service.status(), generatorConnected: !!this.opts.generator }; break;
        case 'postcard_list': result = this.service.store.cards(); break;
        case 'postcard_read': result = this.service.store.card(String(args.tripId)); if (!result) throw new Error('没有这份已完成收藏'); break;
        case 'postcard_cancel': result = this.service.cancel(String(args.tripId)); break;
        case 'postcard_retry': result = this.service.retry(String(args.tripId),args.confirmUnknownOutcome===true); break;
      }
      return JSON.stringify(result);
    } }));
  }
  webUi(): WorldWebUiDecl {
    return { label: '旅行明信片', panels:[{id:'album',title:'远方来信',description:'旅行、翻看明信片与保存收藏。'}],invoke:(panel,method,args)=>this.panel.invoke(panel,method,args),config: [POSTCARD_CONFIG_GROUP], promptDocs: [{ key:'worlds.postcard.envPrompt', title:'旅行环境说明', description:'旅行状态、费用与生成服务边界。', path:ENV_PROMPT_FILE, role:'envPrompt', vars:[{name:'postcard.availability',description:'当前生成服务接入情况'}] }] };
  }
  async start(host: WorldHost): Promise<void> {
    this.host = host; this.service.open();
    this.timer = setInterval(() => { void this.pulse().catch(() => host.log.error('旅行状态推进失败，请检查存档')); }, 1000);
    this.timer.unref?.();
    try {
      await host.pushEvent({ type:'postcard.started', ts:new Date().toISOString(), source:this.id, origin:'internal', senderKey:this.id, text:'旅行核心已加载。'+this.envPromptVars()['postcard.availability'] }, { trigger:'piggyback' });
      await this.pulse();
    } catch (error) { await this.stop(); throw error; }
  }
  pulse(): Promise<void> {
    if (this.pulseFlight) return this.pulseFlight;
    this.pulseFlight = this.advanceAndNotify().finally(()=>{this.pulseFlight=undefined;});
    return this.pulseFlight;
  }
  private async advanceAndNotify(): Promise<void> {
    await this.service.tick();
    if (!this.host) return;
    for (const card of this.service.pendingNotifications()) {
      await this.host.pushEvent({ type:'postcard.completed', ts:new Date(card.completedAt).toISOString(), source:this.id, origin:'internal', senderKey:this.id, text:'一趟旅行的明信片已保存，可以用 postcard_read 查看。', meta:{ tripId:card.tripId, scene:card.scene } }, { trigger:'debounce' });
      if (!this.host) return;
      this.service.acknowledge(card.tripId);
    }
  }
  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined; this.host = undefined; await this.service.close();
  }
}
