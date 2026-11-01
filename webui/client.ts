import {mountSetup} from './setup.ts';
import type {WebUiPanelContext} from 'cortico/web/shared/client-panel.ts';

interface Card {tripId:string;scene:string;title:string;note:string;completedAt:number;unread?:boolean;series?:{id:string;mark:string;nodeIndex:number;total:3};}
interface Trip {id:string;scene:string;status:string;startedAt:number;dueAt:number;error?:string;}
interface Snapshot {journey?:{id:string;mark:string;phase:string;completed:number;nextNode:number|null;summary?:{status:string;error?:string;text?:string}}|null;cost?:{normalImageCost:number|null;maxImageCost:number|null;hostCost:string};readyForTravel?:boolean;trip:Trip|null;cards:Card[];minutes:number;generatorConnected:boolean;mailbox?:{unreadCount:number};mailboxWindow?:{phase:string;detail:string};}
const date=(n:number)=>new Intl.DateTimeFormat('zh-CN',{year:'numeric',month:'long',day:'numeric'}).format(new Date(n));
const active=(t:Trip|null)=>!!t&&['traveling','generating','awaiting_service','failed'].includes(t.status);
const SEAL_COLORS=['#2456a0','#1f5a9e','#1d4f8f','#2b5fa8','#1d5f96','#23549b','#2a5f8f','#2c4f8a'];
function sealTheme(id:string){let h=2166136261;for(let i=0;i<id.length;i++){h^=id.charCodeAt(i);h=Math.imul(h,16777619);}const n=h>>>0;return {color:SEAL_COLORS[n%SEAL_COLORS.length],rotate:(-9+(n>>>9)%6)+'deg',code:id.replace(/[^a-z0-9]/gi,'').slice(-4).toUpperCase(),seed:n%997};}

export async function mountAlbum(ctx:WebUiPanelContext):Promise<void>{
  const doc=ctx.root.ownerDocument;
  const el=<K extends keyof HTMLElementTagNameMap>(tag:K,cls='',text='')=>{const node=doc.createElement(tag);node.className=cls;if(text)node.textContent=text;return node;};
  const handlers=new WeakMap<HTMLButtonElement,()=>unknown>();
  const button=(text:string,fn:()=>unknown,cls='pc-button')=>{const b=el('button',cls,text);b.type='button';handlers.set(b,fn);return b;};
  let data:Snapshot|null=null,busy=false,loading=false,selected=ctx.memo.get<string|null>('selected',null),flipped=ctx.memo.get('flipped',false),imageEpoch=0,detailUrl:string|undefined,summaryFocus=false;
  const thumbnailUrls=new Map<string,string>();let lastCards='';
  let travelMode:'long'|'short'|null=null;
  let revision=0;
  const shell=el('section','pc-app');shell.addEventListener('click',event=>{const target=event.target as Element;const b=target.closest('button');if(b&&shell.contains(b)&&!b.disabled){const handler=handlers.get(b);if(handler)void handler();}},{signal:ctx.signal});shell.setAttribute('aria-label','远方来信旅行与收藏');
  const hero=el('header','pc-hero');hero.append(el('p','pc-eyebrow','A LITTLE WAY FROM HOME'),el('h1','','远方来信'),el('p','pc-intro','让它去远方走走，把想念装进一张明信片。'));
  const stamp=el('span','pc-hero-stamp','✦\n小小旅人');stamp.setAttribute('aria-hidden','true');hero.append(stamp);
  const message=el('p','pc-message');message.setAttribute('role','status');message.setAttribute('aria-live','polite');
  const journey=el('section','pc-journey');journey.setAttribute('aria-label','当前旅行');
  const collection=el('section','pc-collection');
  const heading=el('div','pc-collection-heading');heading.append(el('h2','','旅行收藏册'));const count=el('span','pc-count');heading.append(count);
  const summaryBar=el('section','pc-journey-summary');summaryBar.hidden=true;summaryBar.setAttribute('aria-label','这趟长途的总结');
  const grid=el('div','pc-grid');const detail=el('section','pc-detail');detail.hidden=true;detail.setAttribute('aria-label','明信片详情');
  collection.append(heading,summaryBar,grid,detail);shell.append(hero,message,journey,collection);ctx.root.replaceChildren(shell);
  function tell(text:string,error=false){message.textContent=text;message.classList.toggle('pc-error',error);}
  let sealSeq=0;
  const SVGNS='http://www.w3.org/2000/svg';
  function sealFor(card:Card,large=false){
    const series=card.series!;const theme=sealTheme(series.id);
    const wrap=el('span',large?'pc-seal pc-seal-large':'pc-seal');
    wrap.setAttribute('aria-hidden','true');wrap.title=series.mark+' · 第'+series.nodeIndex+'/'+series.total+'张';
    wrap.style.setProperty('--pc-seal-color',theme.color);wrap.style.setProperty('--pc-seal-rotate',theme.rotate);
    const svg=doc.createElementNS(SVGNS,'svg');svg.setAttribute('viewBox','0 0 100 100');svg.setAttribute('focusable','false');
    const make=(tag:string,attrs:Record<string,string|number>)=>{const n=doc.createElementNS(SVGNS,tag);for(const [k,v] of Object.entries(attrs))n.setAttribute(k,String(v));return n;};
    const uid=++sealSeq,arcId='pc-seal-arc-'+uid,filterId='pc-seal-rough-'+uid;
    const defs=make('defs',{});
    const rough=make('filter',{id:filterId,x:'-8%',y:'-8%',width:'116%',height:'116%'});
    rough.append(make('feTurbulence',{type:'fractalNoise',baseFrequency:'0.9',numOctaves:2,seed:theme.seed,result:'noise'}));
    rough.append(make('feDisplacementMap',{in:'SourceGraphic',in2:'noise',scale:0.6,xChannelSelector:'R',yChannelSelector:'G'}));
    defs.append(rough,make('path',{id:arcId,d:'M 10.5 50 A 39.5 39.5 0 0 1 89.5 50'}));
    svg.append(defs,make('circle',{cx:50,cy:50,r:47,fill:'#fffdf7','fill-opacity':.45,stroke:'none'}));
    const rings=make('g',{fill:'none',stroke:'currentColor',filter:'url(#'+filterId+')'});
    rings.append(make('circle',{cx:50,cy:50,r:47,'stroke-width':2.4}));
    rings.append(make('circle',{cx:50,cy:50,r:42.5,'stroke-width':.9,opacity:.9}));
    rings.append(make('circle',{cx:50,cy:50,r:37.5,'stroke-width':.55,opacity:.45}));
    svg.append(rings);
    const arc=make('text',{fill:'currentColor','font-size':9.8,'letter-spacing':1.5,'font-family':'ui-serif, "Noto Serif SC", "SimSun", serif','font-weight':600});
    const pathText=make('textPath',{href:'#'+arcId,startOffset:'50%','text-anchor':'middle'});pathText.textContent='POST MARK';arc.append(pathText);svg.append(arc);
    const whale=make('g',{fill:'currentColor',filter:'url(#'+filterId+')',transform:'translate(50 53) scale(.94) translate(-50 -50)'});
    whale.append(make('path',{d:'M20 54 C20 45 29 38 43 37 C57 36 67 42 71 49 C73 53 71 57 66 58 L36 61 C27 62 20 60 20 54 Z'}));
    whale.append(make('path',{d:'M70 50 C74 47 78 44 82 41 C82 46 80 50 77 53 C80 55 83 58 84 62 C79 61 74 58 71 55 Z'}));
    whale.append(make('path',{d:'M55 38 C57 34 61 34 63 38 Z'}));
    whale.append(make('path',{d:'M46 57 C47 61 50 63 54 63 C52 60 51 58 50 56 Z'}));
    whale.append(make('path',{d:'M23 56 C30 61 42 63 54 60 L52 64 C38 66 26 63 23 56 Z',fill:'#fffdf7',opacity:.92}));
    for(const d of ['M37 37 C33 31 34 26 38 22','M40 36 C39 30 41 26 45 23','M43 37 C46 32 49 29 53 28'])whale.append(make('path',{d,fill:'none',stroke:'currentColor','stroke-width':1.5,'stroke-linecap':'round'}));
    for(const [cx,cy] of [[37,21],[45,22],[53,27]])whale.append(make('circle',{cx,cy,r:1.25}));
    svg.append(whale);
    const light='#fffdf7';
    svg.append(make('circle',{cx:30.5,cy:48.5,r:1.35,fill:light}));
    svg.append(make('path',{d:'M24 55 q5 2 9 1',fill:'none',stroke:light,'stroke-width':1.1,'stroke-linecap':'round'}));
    for(const d of ['M27 59 C34 62 42 62 49 60','M31 62 C37 64 44 63 49 61'])svg.append(make('path',{d,fill:'none',stroke:light,'stroke-width':.9,'stroke-linecap':'round',opacity:.85}));
    for(const [d,w] of [['M17 66 q6 -3 12 0 t12 0 t12 0 t12 0 t12 0',1.5],['M23 70.5 q6 -3 12 0 t12 0 t12 0 t12 0',1]])svg.append(make('path',{d,fill:'none',stroke:'currentColor','stroke-width':w,'stroke-linecap':'round',opacity:.9}));
    const star=(cx:number,cy:number,r:number)=>{let d='';for(let i=0;i<10;i++){const a=-Math.PI/2+i*Math.PI/5,rr=i%2?r*.45:r;d+=(i?'L':'M')+(cx+rr*Math.cos(a)).toFixed(2)+' '+(cy+rr*Math.sin(a)).toFixed(2);}return d+'Z';};
    for(const [cx,cy] of [[16.5,60],[83.5,60]])svg.append(make('path',{d:star(cx,cy,2.6),fill:'currentColor'}));
    svg.append(make('circle',{cx:50,cy:80.5,r:11,fill:'currentColor'}));
    const num=make('text',{x:50,y:83.8,'text-anchor':'middle','font-size':13,'font-weight':700,fill:light,'font-family':'ui-serif, "Noto Serif SC", "SimSun", serif'});num.textContent=series.nodeIndex+'/'+series.total;svg.append(num);
    const code=make('text',{x:50,y:89.4,'text-anchor':'middle','font-size':3.8,'letter-spacing':.7,fill:light,opacity:.9});code.textContent=theme.code;svg.append(code);
    wrap.append(svg);return wrap;
  }
  function releaseDetail(){if(detailUrl){URL.revokeObjectURL(detailUrl);detailUrl=undefined;}}
  ctx.own({dispose(){imageEpoch++;releaseDetail();for(const url of thumbnailUrls.values())URL.revokeObjectURL(url);thumbnailUrls.clear();}});
  function remember(){ctx.memo.set('selected',selected);ctx.memo.set('flipped',flipped);}
  async function action(method:string,args:unknown[]=[]){
    if(busy||ctx.signal.aborted)return;revision++;busy=true;renderJourney();
    try {data=await ctx.invoke<Snapshot>(method,args);if(method==='start'||method==='startShort')travelMode=null;tell(method==='start'?'已经出发了，等它带一封来信回来。':method==='startShort'?'短途出发了，两小时后会带回一张明信片。':method==='cancel'?'这次先回家，下一段风景还在等它。':(method==='openMailbox'||method==='closeMailbox')?(data.mailboxWindow?.detail??'已请求打开桌面邮箱'):'已继续准备这封来信。');render();}
    catch(error){if(!ctx.signal.aborted)tell(error instanceof Error?error.message:'操作暂时没有完成，请稍后再试。',true);}
    finally {busy=false;if(!ctx.signal.aborted)renderJourney();}
  }
  async function cancel(){if(!data?.trip)return;if(await ctx.ui.confirm({title:'让它先回家吗？',body:'这趟旅行将结束。已经发出的云端生成请求可能仍会计费。'}))await action('cancel',[data.trip.id]);}
  async function retry(){if(!data?.trip)return;let confirmed=false;if(data.trip.error?.includes('不确定')){confirmed=await ctx.ui.confirm({title:'确认后继续准备',body:'上次图片请求的结果不确定。请先核对服务记录；确认继续可能再次产生图片费用，且仍受本趟次数限制。'});if(!confirmed)return;}await action('retry',[data.trip.id,confirmed]);}
  function renderJourney(){
    if(!data)return;journey.replaceChildren();const t=data.trip;
    const text=el('div','pc-journey-copy');const title=el('h2');const sub=el('p','pc-muted');const controls=el('div','pc-journey-actions');
    const inTravel=!!t&&Date.now()<t.dueAt;
    if(active(t)){
      title.textContent=inTravel&&t!.status!=='failed'?'正在远方旅行':t!.status==='failed'?'这封来信还在整理中':t!.status==='awaiting_service'?'旅途到了，等来信启程':'正在把旅途装进信里';
      sub.textContent=inTravel&&t!.status!=='failed'?'预计 '+new Date(t!.dueAt).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})+' 归来，明信片将在旅途中准备。':t!.status==='failed'?'已有成果与旅程进度已保留；会优先复用已有成果，问题未解决时暂缓交付。':t!.status==='awaiting_service'?'请先在扩展配置中连接云端生成服务。':'明信片和短笺准备好后，会自动收进下面的收藏册。';
      if(t!.status==='failed')controls.append(button('继续准备',retry,'pc-button pc-primary'));
      controls.append(button('先回家',cancel));
      if(t!.error){const info=el('details','pc-error-details');info.append(el('summary','','查看原因'),el('p','',t!.error));text.append(info);}
    }else{
      const continuation=data.journey?.phase==='waiting_continue';
      title.textContent=continuation?'继续这段小旅程':'让它去远方走走';
      sub.textContent=data.generatorConnected?'每趟'+(data.minutes===5?'开发测试等待5分钟':'旅行固定2小时')+'。明信片在旅途中制作，到时交付；云端生成按服务计费。':'先在扩展配置中连接图片与视觉服务，再让它出发。已收到的来信随时可以翻看。';
      const duration=data.minutes===5?'5分钟（开发测试）':'2小时';
      if(data.cost)text.append(el('p','pc-cost',data.cost.normalImageCost===null?'下一趟图片费用按所选模型费率，另加宿主模型用量。':'下一趟图片通常约 ¥'+data.cost.normalImageCost.toFixed(2)+'，两张候选约 ¥'+data.cost.maxImageCost!.toFixed(2)+'；另加宿主模型用量。'));
      if(continuation){sub.textContent=data.journey!.mark+' · 已收到 '+data.journey!.completed+'/3 张。下次出发仍等'+(data.minutes===5?'5分钟（开发测试）':'2小时')+'；隔几天再来、没读上一张都不影响进度。';controls.append(button('结束这段旅程',async()=>{if(await ctx.ui.confirm({title:'结束这段旅程？',body:'已收到的明信片保留，不再补齐剩余节点，也不额外制作总结。'}))await action('endJourney',[data!.journey!.id]);}));if(data.journey!.nextNode===3)text.append(el('p','pc-muted pc-final-hint','下一张是三张里的最后一张，收齐后会附上这趟的总结笔记。'));}
      const choose=(mode:'long'|'short')=>{travelMode=mode;renderJourney();};
      const long=button(continuation?'继续长途 · 第'+data.journey!.nextNode+'/3张'+(data.minutes===5?' · 5分钟':''):'长途 · 3×'+(data.minutes===5?'5分钟':'2小时'),()=>choose('long'),'pc-button pc-mode');
      const short=button('短途 · '+(data.minutes===5?'5分钟':'2小时')+' · 一张卡',()=>choose('short'),'pc-button pc-mode');
      long.setAttribute('aria-pressed',String(travelMode==='long'));short.setAttribute('aria-pressed',String(travelMode==='short'));
      const start=button('开始旅行',()=>{if(travelMode)void action(travelMode==='short'?'startShort':'start');},'pc-button pc-primary');
      long.disabled=short.disabled=!data.generatorConnected||data.readyForTravel===false||busy;start.disabled=long.disabled||travelMode===null;
      text.append(el('p','pc-muted',travelMode===null?'先选择短途或长途，再点击「开始旅行」。选择类型不会开始制作。':travelMode==='short'?'已选短途：点击「开始旅行」后出发，收到一张明信片。':continuation?'已选继续长途：点击「开始旅行」后续行下一段。':'已选长途：点击「开始旅行」后开启第一段，后续每段另行出发。'));
      const explain=(b:HTMLButtonElement,id:string,description:string)=>{const wrap=el('span','pc-mode-help'),tip=el('span','pc-mode-tooltip',description);tip.id=id;tip.setAttribute('role','tooltip');b.setAttribute('aria-describedby',id);if(b.disabled)wrap.tabIndex=0;wrap.append(b,tip);return wrap;};
      controls.append(explain(long,'pc-long-tip','一段连续故事，分三次出发。每次'+duration+'、一张明信片，集齐三张后附旅程总结。每段需再次确认，可随时停留，也可穿插短途。'),explain(short,'pc-short-tip','出发一次，等待'+duration+'，收到一张独立故事的明信片；不含系列或总结，不影响未完成的长途。'),start);
      if(!data.generatorConnected||data.readyForTravel===false){
        const notice=el('div','pc-start-blocked'),reason=el('p','',data.generatorConnected?'配置已更改，请先验证明信片制作':'请先完成生图配置，并验证明信片制作');reason.id='pc-start-disabled-reason';for(const b of [long,short,start]){b.setAttribute('aria-describedby',[b.getAttribute('aria-describedby'),reason.id].filter(Boolean).join(' '));b.title=reason.textContent??'';}
        const link=el('a','pc-button','前往验证');link.href='#/provider/world%3Apostcard/setup';link.addEventListener('click',()=>{try{doc.defaultView?.sessionStorage.setItem('postcard:focus-verification','1');}catch{}});notice.append(reason,link);controls.append(notice);
      }

    }
    if(data.journey?.summary?.status==='failed'){text.append(el('p','pc-muted','三张已收好，总结尚未完成：'+(data.journey.summary.error??'可稍后恢复文字。')));controls.append(button('仅重试总结',async()=>{if(await ctx.ui.confirm({title:'恢复总结文字？',body:'只处理总结，不重新生图；仍可能产生宿主模型用量。'}))await action('retrySummary',[data!.journey!.id]);}));}
    if(data.mailboxWindow){const shown=data.mailboxWindow.phase==='running';const mailbox=button(shown?'关闭桌面邮箱':'显示桌面邮箱',()=>action(shown?'closeMailbox':'openMailbox'));mailbox.disabled=busy;controls.append(mailbox);}
    if(active(t)){
      const meter=el('div','pc-travel-progress');
      const total=t!.dueAt-t!.startedAt;
      const fraction=Number.isFinite(total)&&total>0?Math.max(0,Math.min(1,(Date.now()-t!.startedAt)/total)):0;
      const traveling=inTravel;const percent=traveling?Math.floor(fraction*100):100;
      const label=el('p','pc-progress-label',traveling?'旅行进度 · '+percent+'%':'预计归来时间已到 · 来信仍在整理');
      const bar=el('progress','pc-progress');bar.max=100;bar.value=percent;bar.setAttribute('aria-label','旅行等待进度');bar.setAttribute('aria-valuetext',traveling?percent+'%，明信片在旅途中准备':'旅行等待已结束，明信片尚未完成');
      const left=Math.max(0,Math.ceil((t!.dueAt-Date.now())/60000));
      const hint=el('p','pc-muted',traveling?(left>0?'约 '+left+' 分钟后结束旅行':'旅行等待已结束，正在同步归来状态'):'这条进度仅表示旅行等待，明信片保存后才算收到来信。');
      meter.append(label,bar,hint);text.append(meter);
    }
    text.prepend(title,sub);for(const b of controls.querySelectorAll('button'))if(busy)b.disabled=true;journey.append(text,controls);
  }
  async function thumbnail(card:Card,img:HTMLImageElement){
    const known=thumbnailUrls.get(card.tripId);if(known){img.src=known;return;}
    try {const blob=await ctx.invokeBinary('thumbnail',[card.tripId]);if(ctx.signal.aborted)return;const previous=thumbnailUrls.get(card.tripId);if(previous){img.src=previous;return;}const url=URL.createObjectURL(blob);thumbnailUrls.set(card.tripId,url);if(img.isConnected)img.src=url;}
    catch{if(!ctx.signal.aborted&&img.isConnected)img.alt='暂时无法载入图片，可点击查看短笺';}
  }
  function openSummary(id:string){
    const card=data?.cards.find(c=>c.series?.id===id&&c.series.nodeIndex===3&&c.series.total===3);
    if(!card){tell('第三张明信片还没入藏，总结暂时读不到。',true);return;}
    selected=card.tripId;flipped=false;summaryFocus=true;remember();void renderDetail(true);
  }
  function renderSummaryBar(){
    summaryBar.replaceChildren();summaryBar.hidden=true;
    const j=data?.journey,sm=j?.summary;
    if(!j||j.completed<3||!sm||sm.status==='failed')return;
    summaryBar.hidden=false;
    const theme=sealTheme(j.id),emblem=el('span','pc-summary-emblem','✦');emblem.style.setProperty('--pc-seal-color',theme.color);emblem.setAttribute('aria-hidden','true');
    const copy=el('div','pc-summary-copy');
    copy.append(el('p','pc-eyebrow',j.mark+' · 三张已收齐'),el('h3','','这趟的总结笔记'));
    const excerpt=(sm.text??'').replace(/\s+/g,' ').trim();
    copy.append(el('p','pc-muted',sm.status==='ready'?(excerpt?(excerpt.length>62?excerpt.slice(0,62)+'…':excerpt):'三张明信片串起来的一段回顾。'):'三张已收齐，正在整理这段旅程。'));
    summaryBar.append(emblem,copy);
    if(sm.status==='ready')summaryBar.append(button('读这趟的总结',()=>openSummary(j.id),'pc-button pc-primary'));
  }
  function renderCollection(){
    if(!data)return;count.textContent=data.cards.length+' 封旅途来信'+(data.mailbox?.unreadCount?' · '+data.mailbox.unreadCount+' 封未读':'');grid.replaceChildren();renderSummaryBar();
    const cards=[...data.cards].sort((a,b)=>b.completedAt-a.completedAt);
    if(!cards.length){const empty=el('div','pc-empty');empty.append(el('span','pc-empty-symbol','✉'),el('h3','','第一封来信，还在路上'),el('p','','让它去远方走走，等一封属于这趟旅程的来信。'));grid.append(empty);}
    for(const card of cards){const open=button('',()=>{selected=card.tripId;flipped=false;remember();void renderDetail(true);},'pc-postcard');open.setAttribute('aria-label','打开来信：'+card.title);
      const image=el('img');image.alt=card.title+'旅行明信片';image.loading='lazy';image.width=360;image.height=540;
      const art=el('span','pc-postcard-art');art.append(image);if(card.series?.total===3)art.append(sealFor(card));
      const footer=el('div','pc-card-footer');footer.append(el('h3','',card.title+(card.unread?' · 新来信':'')),el('time','',date(card.completedAt)));if(card.series?.nodeIndex===3&&card.series.total===3)footer.append(el('span','pc-summary-tag','含这趟总结'));
      open.append(art,footer);grid.append(open);void thumbnail(card,image);
    }
    if(selected&&!data.cards.some(c=>c.tripId===selected)){selected=null;remember();}
    void renderDetail(false);
  }
  async function download(card:Card,kind:'png'|'zip'){
    try {const blob=await ctx.invokeBinary(kind,[card.tripId]);if(ctx.signal.aborted)return;const url=URL.createObjectURL(blob),a=el('a');a.href=url;a.download='postcard-'+card.scene+'-'+card.tripId.slice(0,8)+'.'+kind;shell.append(a);a.click();a.remove();ctx.timeout(()=>URL.revokeObjectURL(url),1000);ctx.own({dispose:()=>URL.revokeObjectURL(url)});tell(kind==='png'?'明信片图片已准备下载。':'图片、短笺和旅行记录已打包下载。');}
    catch(error){if(!ctx.signal.aborted)tell(error instanceof Error?error.message:'下载暂时失败，请稍后再试。',true);}
  }
  async function renderDetail(scroll:boolean){
    const epoch=++imageEpoch;releaseDetail();detail.replaceChildren();const card=data?.cards.find(c=>c.tripId===selected);detail.hidden=!card;if(!card)return;
    let readInFlight=false;
    async function acknowledgeRead(){if(!card?.unread||readInFlight||ctx.signal.aborted||epoch!==imageEpoch)return;readInFlight=true;try{const next=await ctx.invoke<Snapshot>('markRead',[card.tripId]);if(!ctx.signal.aborted&&epoch===imageEpoch){data=next;render();}}catch{if(!ctx.signal.aborted)tell('来信已打开，已读状态保存失败，稍后可重试。',true);}}
    const bar=el('div','pc-detail-bar');bar.append(el('h2','','旅途寄来的信'),button('收起来',()=>{selected=null;remember();void renderDetail(false);}));
    const content=el('div','pc-letter');
    if(flipped){content.classList.add('pc-letter-back');content.append(el('span','pc-postmark','旅途留念 · '+date(card.completedAt)),el('h3','',card.title),el('p','pc-note',card.note),el('span','pc-signature','把这一刻，寄给你。'));}
    else {const art=el('span','pc-detail-art'),image=el('img','pc-full-image');image.width=1664;image.height=2496;image.onload=()=>{void acknowledgeRead();};image.alt=card.title;art.append(image);if(card.series?.total===3)art.append(sealFor(card,true));content.append(art);try{const blob=await ctx.invokeBinary('image',[card.tripId]);if(ctx.signal.aborted||epoch!==imageEpoch)return;detailUrl=URL.createObjectURL(blob);image.src=detailUrl;}catch{if(epoch===imageEpoch)content.append(el('p','pc-error','图片暂时无法载入，仍可翻到背面读信。'));}}
    if(ctx.signal.aborted||epoch!==imageEpoch)return;
    const actions=el('div','pc-detail-actions');const flip=button(flipped?'看看风景':'翻到背面读信',()=>{flipped=!flipped;remember();void renderDetail(false);},'pc-button pc-primary');flip.setAttribute('aria-pressed',String(flipped));actions.append(flip,button('保存图片',()=>download(card,'png')),button('打包带走',()=>download(card,'zip')));
    detail.append(bar,content,actions);
    if(card.series?.nodeIndex===3&&card.series.total===3){
      const summary=data?.journey?.summary;
      const section=el('section','pc-summary');section.tabIndex=-1;
      const head=el('div','pc-summary-head');head.append(el('span','pc-summary-kicker','三张已收齐'),el('h3','','这趟的总结笔记'));section.append(head);
      if(summary?.status==='ready'&&summary.text){section.append(el('p','pc-note',summary.text));detail.append(section);}
      else if(summary?.status==='running'){section.append(el('p','pc-muted','三张已收齐，正在整理这段旅程。'));detail.append(section);}
      else if(summary?.status==='failed'){section.append(el('p','pc-muted','总结尚未完成：'+(summary.error??'可稍后恢复文字。')));const retrySummary=button('恢复总结文字',async()=>{if(await ctx.ui.confirm({title:'恢复总结文字？',body:'只处理总结，不重新生图；仍可能产生宿主模型用量。'}))await action('retrySummary',[card.series!.id]);},'pc-button pc-primary');section.append(retrySummary);detail.append(section);}
      else {actions.append(button('这趟的总结笔记',async()=>{try{const j=await ctx.invoke<{summary?:{status:string;text?:string;error?:string}}>('journey',[card.series!.id]);if(ctx.signal.aborted||epoch!==imageEpoch)return;section.replaceChildren(head,el('p','pc-note',j.summary?.status==='ready'?j.summary.text??'':j.summary?.status==='failed'?'总结尚未完成：'+(j.summary.error??'可恢复文字。'):'三张已收好，正在整理总结。'));if(!section.isConnected)detail.append(section);section.scrollIntoView({behavior:'smooth',block:'start'});}catch(error){tell(error instanceof Error?error.message:'总结暂时无法读取',true);}},'pc-button pc-primary'));}
    }
    if(flipped)await acknowledgeRead();
    if(summaryFocus){summaryFocus=false;const section=detail.querySelector<HTMLElement>('.pc-summary');if(section){const jump=()=>{if(!section.isConnected)return;section.scrollIntoView({block:'start'});section.focus({preventScroll:true});};jump();ctx.timeout(jump,120);}else if(scroll)detail.scrollIntoView({behavior:'smooth',block:'start'});}
    else if(scroll)detail.scrollIntoView({behavior:'smooth',block:'start'});
  }
  function render(){renderJourney();const key=JSON.stringify(data?.cards);if(key!==lastCards){lastCards=key;renderCollection();}}
  async function refresh(){if(loading||busy||ctx.signal.aborted)return;loading=true;const version=revision;try{const next=await ctx.invoke<Snapshot>('snapshot');if(!ctx.signal.aborted&&version===revision){data=next;render();}}catch{if(!ctx.signal.aborted)tell('暂时联系不上旅行册，已打开的来信仍留在这里。',true);}finally{loading=false;}}
  await refresh();ctx.interval(()=>{void refresh();},5000);ctx.interval(()=>{if(!ctx.signal.aborted&&data?.trip&&active(data.trip))renderJourney();},1000);
}
export default {panels:{album:{mount:mountAlbum},setup:{mount:mountSetup}}};



