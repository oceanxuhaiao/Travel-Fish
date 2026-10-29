import {ReadinessCheck} from './readiness.ts';
import {costEstimate} from './cost.ts';
import {PickupQueue} from './pickup.ts';
import {readFileSync} from 'node:fs';
import {MailboxStore} from './mailbox.ts';
import {MailboxWindow} from './mailbox-window.ts';
import type {HostModelBridge} from './host-model.ts';
import {SetupPanel,type SetupSecrets} from './setup.ts';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import type { World, WorldHost, ToolDef, WorldWebUiDecl, RunPhase } from 'cortico/core/types.ts';
import type { PostcardConfigSection } from './config.ts';
import { TRAVEL_MINUTES, POSTCARD_CONFIG_GROUP } from './config.ts';
import { TravelService, TravelStore, type Generator, type Scene } from './travel.ts';
import {InvitationSchedule} from './invitations.ts';
import { PostcardPanel } from './panel.ts';
import { PostcardRecords, type RecordsQuery } from './records.ts';

const ENV_PROMPT_FILE = fileURLToPath(new URL('./ENV_PROMPT.md', import.meta.url));
const pickupParam={type:'object',additionalProperties:false,properties:{requestId:{type:'string'},step:{type:'string',enum:['approach','arrived','defer']}},required:['requestId','step']};
const idParam = { type: 'object', additionalProperties: false, properties: { tripId: { type: 'string', description: 'Trip id from postcard_status.' } }, required: ['tripId'] };
export const POSTCARD_TOOL_DECLS: ReadonlyArray<Omit<ToolDef, 'handler'>> = [
  {name:'postcard_pickup',description:'Manage a saved postcard pickup performance only for postcard.pickup_due requestId. First approach obtains target, then use pet_move_to on the primary display ONLY when idle and await its real arrival receipt; then arrived starts the mailbox animation. Defer on busy, missing tool, interrupted/failed movement, wrong screen or user interaction. Never infer arrival from chat. Expired requests fail. This does not save cards, prove physical position, or mark a letter read.',tags:['write'],parameters:pickupParam},
  { name: 'postcard_start', description: 'Start one surprise virtual pet trip when the user asks. The pet chooses the scenery internally; do not ask the user to choose a destination. Duration is fixed at two hours of real waiting time and cannot be changed by user configuration; the postcard is prepared during this wait and delivered at return if ready; service failures may delay delivery. Only one unfinished trip is allowed. Start only for an explicit user request or affirmative reply to a travel invitation. An invitation event, silence or a refusal is never consent.', tags: ['write'], parameters: { type: 'object', additionalProperties: false, properties: {} } },
  { name: 'postcard_status', description: 'Read the current trip and availability. awaiting_service means a generator is not connected; do not claim a postcard exists.', tags: ['read'], parameters: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'postcard_list', description: 'List permanently saved postcards.', tags: ['read'], parameters: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'postcard_records', description: 'Find saved travel records by literal words in their title or note, newest first. Optional query: at most 120 characters; whitespace-separated terms must all match. Omit query for recent records. Returns bounded original excerpts and source hashes; no semantic matching or image interpretation. Development-labelled records are excluded unless requested. Does not mark read, open windows, generate images or change a trip. Use postcard_read for the full original note.', tags:['read'], parameters:{type:'object',additionalProperties:false,properties:{query:{type:'string',maxLength:120},limit:{type:'integer',minimum:1,maximum:10},offset:{type:'integer',minimum:0},includeDevelopment:{type:'boolean'}}} },
  { name: 'postcard_read', description: 'Read your own travel postcard, written by you to the user, by trip id. Retell it in first person as your travel keepsake, not as an incoming letter from someone else. Respect explicitly labelled development fixtures.', tags: ['read'], parameters: idParam },
  { name: 'postcard_cancel', description: 'Cancel a trip on user request. A remote request already sent may still incur a charge.', tags: ['write'], parameters: idParam },
  { name: 'postcard_retry', description: 'Manually retry a failed trip only after the user requests it. For an uncertain image outcome, set confirmUnknownOutcome only after the user has explicitly confirmed checking the previous result and possible charge.', tags: ['write'], parameters: { ...idParam,properties:{...idParam.properties,confirmUnknownOutcome:{type:'boolean',description:'True only after the user explicitly confirms the uncertain previous request and possible charge.'}} } },
];

export class PostcardWorld implements World {
  readonly id = 'postcard';
  readonly service: TravelService;
  readonly records: PostcardRecords;
  private verification:ReadinessCheck;
  private timer?: ReturnType<typeof setInterval>;
  private host?: WorldHost;
  private pulseFlight?: Promise<void>;
  readonly panel:PostcardPanel;
  readonly setup:SetupPanel;
  readonly invitations:InvitationSchedule;
  readonly mailbox:MailboxStore;
  readonly pickup:PickupQueue;private pickupHealthy=true;private coreIdle=false;private pickupFlight?:Promise<void>;private pickupSent=new Set<string>();
  readonly mailboxHeight:number;
  readonly mailboxWindow:MailboxWindow;
  private mailboxHealthy=true;
  private invitationsHealthy=true;
  constructor(private opts: { cfg: PostcardConfigSection; dataDir: string; generator?: Generator; now?:()=>number; setup?:SetupSecrets; bridge?:HostModelBridge; mailboxRuntime?:()=>string|null;restart?:()=>Promise<void> }) {
    const signature=()=>JSON.stringify([opts.cfg.cloudEnabled,opts.cfg.useHostModel,opts.cfg.imageBackend,opts.cfg.imageModel,opts.cfg.imageBaseUrl,opts.cfg.imageSize,opts.cfg.characterPreset,opts.cfg.characterReference,opts.cfg.styleReference,opts.cfg.imageProxyUrl,opts.cfg.visionProxyUrl]);const applied=signature(),appliedModel=opts.cfg.imageModel??'';
    this.verification=new ReadinessCheck(join(opts.dataDir,'postcard'),opts.cfg,n=>opts.setup?.secret(n)??'',()=>this.host?.modelFacts.model()??'',opts.generator,opts.now);
    this.setup=new SetupPanel(opts.cfg,opts.setup,join(opts.dataDir,'postcard/character-imports'),()=>!!this.host?.modelFacts.accepts('image/png'),opts.setup?{state:()=>this.verification.state(),start:()=>{if(this.service.status()&&['traveling','generating','failed','awaiting_service'].includes(this.service.status()!.status))throw Error('请先结束已有旅行，再验证配置');return this.verification.start();}}:undefined,opts.restart?{required:()=>signature()!==applied,appliedModel:()=>appliedModel,restart:async()=>{if(this.verification.state().phase==='checking'||this.service.status()&&['traveling','generating','awaiting_service','failed'].includes(this.service.status()!.status))throw Error('旅行或制作验证尚未结束，暂不能重启；请先完成或处理当前任务');await opts.restart!();}}:undefined);
    this.service = new TravelService(new TravelStore(join(opts.dataDir,'postcard')), opts.generator, opts.now,true);
    this.records = new PostcardRecords(this.service.store);
    this.invitations=new InvitationSchedule(join(opts.dataDir,'postcard'),opts.now);
    this.mailbox=new MailboxStore(this.service,opts.now);
    this.mailboxHeight=Math.max(80,Math.min(180,Number(opts.cfg.mailboxHeight)||120));
    this.pickup=new PickupQueue(join(opts.dataDir,'postcard'),()=>this.mailbox.snapshot(),()=>this.mailboxWindow.placement(),opts.now);
    this.mailboxWindow=new MailboxWindow({profile:join(opts.dataDir,'postcard/mailbox-profile'),runtime:()=>opts.mailboxRuntime?.()??null,snapshot:()=>this.mailboxView(),pickupRequest:id=>this.pickup.request(id),presentationDone:(requestId,id)=>this.pickup.finish(requestId,id),pausePickup:id=>{if(this.pickupHealthy)this.pickup.pause(id);},markRead:id=>this.mailbox.markRead(id),read:id=>{const card=this.service.store.card(id);if(!card)throw Error('没有这封已入藏的来信');return {tripId:id,title:card.title,note:card.note,imageBase64:readFileSync(join(this.service.store.collection,id,'postcard.png')).toString('base64')};}});
    this.panel=new PostcardPanel(this.service,()=>({minutes:TRAVEL_MINUTES,generatorConnected:!!this.opts.generator,cost:costEstimate(this.opts.cfg),readyForTravel:this.opts.setup?(this.setup.invoke('check') as {readyForTravel:boolean}).readyForTravel:!!this.opts.generator}),{snapshot:()=>this.mailboxHealthy?this.mailboxView():undefined,markRead:id=>this.mailbox.markRead(id),open:()=>this.openMailbox(),close:()=>this.mailboxWindow.close(),windowState:()=>this.mailboxWindow.status()},()=>this.assertReady());
  }
  envPromptVars(): Record<string,string> {const ready=!this.opts.setup||(this.setup.invoke('check') as {readyForTravel:boolean}).readyForTravel;return { 'postcard.availability': this.opts.generator ? ready?'已配置生成能力；真实连通性以调用为准':'生成能力已启用，但配置尚未就绪，请先完成引导' : '旅行核心预览，生成能力已关闭，不会实际生图' }; }
  tools(): ToolDef[] {
    return [...(this.opts.bridge?.tools()??[]),...POSTCARD_TOOL_DECLS.map(decl => ({ ...decl, handler: async (args:Record<string,unknown>) => {
      let result: unknown;
      switch (decl.name) {
        case 'postcard_pickup': if(!this.pickupHealthy)throw Error('取信展示记录损坏，仍可在收藏册读信');result=this.pickup.step(String(args.requestId),args.step as 'approach'|'arrived'|'defer');break;
        case 'postcard_start': this.assertReady();result = this.service.start('surprise', TRAVEL_MINUTES); break;
        case 'postcard_status': result = {readyForTravel:!this.opts.setup?!!this.opts.generator:(this.setup.invoke('check') as {readyForTravel:boolean}).readyForTravel,cost:costEstimate(this.opts.cfg), trip: this.service.status(), generatorConnected: !!this.opts.generator, invitation:{enabled:this.opts.cfg.proactiveEnabled??true,intervalMinutes:this.opts.cfg.proactiveIntervalMinutes??360,nextAt:this.invitations.snapshot()?.nextAt??null,...(!this.invitationsHealthy?{error:'主动询问日程损坏，已暂停'}:{})} }; break;
        case 'postcard_list': result = this.service.store.cards(); break;
        case 'postcard_records': result = this.records.search(args as RecordsQuery); break;
        case 'postcard_read': { result={...this.records.read(String(args.tripId)),narrativeContext:'这是你（当前桌宠）旅行时写给用户、寄回家的明信片。你是旅行者和寄信人，用户是收信人。以第一人称陪用户重温自己的旅途，不称为别人寄给你的信，不猜测陌生寄信人。只依据这封信的内容，不编造用户同行或真实地名；明确标注为开发验证的卡片仍须如实称为演示，不能伪称真实旅行。'}; break; }
        case 'postcard_cancel': result = this.service.cancel(String(args.tripId)); break;
        case 'postcard_retry': result = this.service.retry(String(args.tripId),args.confirmUnknownOutcome===true); break;
      }
      return JSON.stringify(result);
    } }))];
  }
  webUi(): WorldWebUiDecl {
    return { label: '旅行大肥鱼',lamps:this.lamps(), panels:[{id:'album',title:'远方来信',description:'旅行、翻看明信片与保存收藏。'},{id:'setup',title:'配置引导',description:'配置云端 API、参考图及旅行选项。'}],invoke:async(panel,method,args)=>panel==='setup'?this.setup.invoke(method,args):this.panel.invoke(panel,method,args),config: [POSTCARD_CONFIG_GROUP], promptDocs: [{ key:'worlds.postcard.envPrompt', title:'旅行环境说明', description:'旅行状态、费用与生成服务边界。', path:ENV_PROMPT_FILE, role:'envPrompt', vars:[{name:'postcard.availability',description:'当前生成服务接入情况'}] }] };
  }
  private assertReady(){if(!this.opts.cfg.cloudEnabled||!this.opts.generator)throw Error('明信片生成能力未启用，尚未开始旅行');if(!this.opts.setup)return;const c=this.setup.invoke('check') as {readyForTravel:boolean};if(!c.readyForTravel)throw Error('请先完成配置引导并通过“验证明信片制作”；尚未开始旅行或发起图片请求');}
  private lamps():NonNullable<WorldWebUiDecl['lamps']>{
    if(!this.host)return [{label:'旅行',state:'offline',hint:'尚未启动'}];
    const s=this.setup.snapshot(),trip=this.service.status();let unread=0;try{unread=this.mailbox.snapshot().unreadCount;}catch{}
    const check=this.setup.invoke('check') as {imageReady:boolean;readyForTravel:boolean};const imageReady=check.imageReady;
    return [{label:'生图服务',state:!this.opts.cfg.cloudEnabled||!imageReady?'offline':trip?.status==='failed'?'error':trip?.status==='generating'?'loading':'online',hint:!imageReady?'请先配置生图服务':trip?.status==='failed'?'本次来信未完成，请查看收藏册':check.readyForTravel?'制作验证已通过；外部服务后续仍可能故障':'配置已填写，但尚未通过明信片制作验证，不能出发'},
      {label:'宿主模型',state:s.useHostModel?(s.hostVisionReady?'online':'offline'):'offline',hint:s.hostVisionReady?'宿主支持PNG看图与写信':'请为宿主选择支持PNG的模型'},
      {label:'旅行与来信',state:trip?.status==='failed'?'error':trip&&['traveling','generating','awaiting_service'].includes(trip.status)?'loading':'online',hint:trip?.status==='failed'?'本次旅行未完成，已有收藏仍可阅读':unread?unread+'封未读来信':trip?.status==='traveling'&&trip?.phase==='ready_for_return'?'明信片已备妥，等待旅行结束':trip&&['traveling','generating'].includes(trip.status)?'正在旅行':'等待下一次出发'}];
  }
  mailboxView(){return {...this.mailbox.snapshot(),height:this.mailboxHeight,...(this.pickupHealthy?{pickup:this.pickup.snapshot()}:{})};}
  onRunPhase(phase:RunPhase):void{this.coreIdle=phase.state==='idle';}
  pickupPulse():Promise<void>{if(this.pickupFlight)return this.pickupFlight;this.pickupFlight=this.advancePickup().finally(()=>{this.pickupFlight=undefined;});return this.pickupFlight;}
  private async advancePickup(){
    const host=this.host;if(!host||!this.pickupHealthy||!this.mailboxHealthy||!this.coreIdle)return;
    const request=this.pickup.snapshot().active;for(const id of this.pickupSent)if(id!==request?.requestId)this.pickupSent.delete(id);if(!request||request.phase!=='offered'||this.pickupSent.has(request.requestId))return;this.pickupSent.add(request.requestId);
    try{await host.pushEvent({type:'postcard.pickup_due',source:this.id,origin:'internal',senderKey:this.id,ts:new Date().toISOString(),text:'用户已点击邮箱，请你取出自己旅行时写给用户、寄回家的明信片，陪用户一起重看自己的旅途；你是寄信人，用户是收信人，不是别人寄给你的信。先用postcard_read核对内容，明确的开发验证卡应如实称演示，不伪称真实旅行。明信片已永久入藏。空闲且桌宠在主屏时，先用postcard_pickup的approach取得位置，使用pet_move_to(to,run=true)跑到邮箱旁，等待真实到达回执后才提交arrived。忙碌、操作电脑、被拖拽、移动失败或无移动工具则defer；不要抢占用户活动。requestId='+request.requestId+'，tripId='+request.tripId+'。取信只是表现，不再生图、不开始旅行，不把演出完成说成用户已读。',meta:{requestId:request.requestId,tripId:request.tripId}},{trigger:'debounce'});}catch{this.pickup.pause();throw Error('取信事件未送达，已保留来信，可点击重试');}
  }
  async openMailbox(){if(!this.mailboxHealthy)throw Error('邮箱已读记录损坏，请恢复备份，收藏未改动');if(this.opts.cfg.mailboxEnabled===false)throw Error('桌面邮箱已在配置中关闭');return this.mailboxWindow.open();}
  async start(host: WorldHost): Promise<void> {
    this.host = host; this.opts.bridge?.attach(host); this.service.open();
    try{this.mailbox.open();}catch{this.mailboxHealthy=false;host.log.error('邮箱已读记录损坏，请恢复备份；旅行收藏未改动');}
    if(this.mailboxHealthy){try{this.pickup.open();}catch{this.pickupHealthy=false;host.log.error('取信展示记录损坏，演出暂停，收藏仍可阅读');}}else this.pickupHealthy=false;
    if(this.mailboxHealthy&&this.opts.cfg.mailboxEnabled!==false)await this.mailboxWindow.open();
    try {this.invitations.open();} catch {this.invitationsHealthy=false;host.log.error('主动旅行询问日程损坏，已暂停询问；旅行和收藏仍可使用，请恢复日程备份');}
    this.timer = setInterval(() => { void this.pickupPulse().catch(()=>host.log.error('取信展示未推进，收藏仍保留'));void this.pulse().catch(() => host.log.error('旅行状态推进失败，请检查存档')); }, 1000);
    this.timer.unref?.();
    try {
      await host.pushEvent({ type:'postcard.started', ts:new Date().toISOString(), source:this.id, origin:'internal', senderKey:this.id, text:'旅行核心已加载。'+this.envPromptVars()['postcard.availability'] }, { trigger:'piggyback' });
      if(this.opts.bridge)void this.pulse().catch(()=>host.log.error('旅行状态推进失败，请检查存档'));else await this.pulse();
    } catch (error) { await this.stop(); throw error; }
  }
  pulse(): Promise<void> {
    if (this.pulseFlight) return this.pulseFlight;
    this.pulseFlight = this.advanceAndNotify().finally(()=>{this.pulseFlight=undefined;});
    return this.pulseFlight;
  }
  private async advanceAndNotify(): Promise<void> {
    await this.service.tick(); // A failed trip does not revoke an unchanged, successful configuration proof.
    if (!this.host) return;
    for (const card of this.service.pendingNotifications()) {
      await this.host.pushEvent({ type:'postcard.completed', ts:new Date(card.completedAt).toISOString(), source:this.id, origin:'internal', senderKey:this.id, text:'你这趟旅行时写给用户、寄回家的明信片已保存，可以用 postcard_read 查看。你是旅行者和寄信人，用户是收信人；只提醒有信，等用户点击邮箱后取信，不主动开盖或朗读。明确开发验证卡须如实说明是演示。', meta:{ tripId:card.tripId, scene:card.scene } }, { trigger:'debounce' });
      if (!this.host) return;
      this.service.acknowledge(card.tripId);
    }
    const trip=this.service.status(),busy=!!trip&&['traveling','generating','awaiting_service','failed'].includes(trip.status);
    if(!this.invitationsHealthy)return;
    await this.invitations.tick(this.opts.cfg.proactiveEnabled??true,this.opts.cfg.proactiveIntervalMinutes??360,!!this.opts.generator&&!busy&&(!this.opts.setup||(this.setup.invoke('check') as {readyForTravel:boolean}).readyForTravel),async()=>{
      const host=this.host;if(!host)return;
      await host.pushEvent({type:'postcard.invitation_due',ts:new Date((this.opts.now??Date.now)()).toISOString(),source:this.id,origin:'internal',senderKey:this.id,text:'用户设置的旅行主动询问间隔已到，本次等待间隔已满'+(this.opts.cfg.proactiveIntervalMinutes??360)+'分钟。目前没有未结束旅行，明信片生成服务已连接。用户尚未同意新的旅行。',meta:{intervalMinutes:this.opts.cfg.proactiveIntervalMinutes??360,userApproved:false}},{trigger:'debounce'});
    });
  }
  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;this.verification.stop(); this.opts.bridge?.detach(); this.host = undefined; await this.mailboxWindow.close(); await this.service.close();
  }
}

