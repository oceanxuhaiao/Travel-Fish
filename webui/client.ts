import type {WebUiPanelContext} from 'cortico/web/shared/client-panel.ts';

interface Card {tripId:string;scene:string;title:string;note:string;completedAt:number;}
interface Trip {id:string;scene:string;status:string;dueAt:number;error?:string;}
interface Snapshot {trip:Trip|null;cards:Card[];minutes:number;generatorConnected:boolean;}
const date=(n:number)=>new Intl.DateTimeFormat('zh-CN',{year:'numeric',month:'long',day:'numeric'}).format(new Date(n));
const active=(t:Trip|null)=>!!t&&['traveling','generating','awaiting_service','failed'].includes(t.status);

export async function mountAlbum(ctx:WebUiPanelContext):Promise<void>{
  const doc=ctx.root.ownerDocument;
  const el=<K extends keyof HTMLElementTagNameMap>(tag:K,cls='',text='')=>{const node=doc.createElement(tag);node.className=cls;if(text)node.textContent=text;return node;};
  const handlers=new WeakMap<HTMLButtonElement,()=>unknown>();
  const button=(text:string,fn:()=>unknown,cls='pc-button')=>{const b=el('button',cls,text);b.type='button';handlers.set(b,fn);return b;};
  let data:Snapshot|null=null,busy=false,loading=false,selected=ctx.memo.get<string|null>('selected',null),flipped=ctx.memo.get('flipped',false),imageEpoch=0,detailUrl:string|undefined;
  const thumbnailUrls=new Map<string,string>();let lastCards='';
  let revision=0;
  const shell=el('section','pc-app');shell.addEventListener('click',event=>{const target=event.target as Element;const b=target.closest('button');if(b&&shell.contains(b)&&!b.disabled){const handler=handlers.get(b);if(handler)void handler();}},{signal:ctx.signal});shell.setAttribute('aria-label','远方来信旅行与收藏');
  const hero=el('header','pc-hero');hero.append(el('p','pc-eyebrow','A LITTLE WAY FROM HOME'),el('h1','','远方来信'),el('p','pc-intro','让它去远方走走，把想念装进一张明信片。'));
  const stamp=el('span','pc-hero-stamp','✦\n小小旅人');stamp.setAttribute('aria-hidden','true');hero.append(stamp);
  const message=el('p','pc-message');message.setAttribute('role','status');message.setAttribute('aria-live','polite');
  const journey=el('section','pc-journey');journey.setAttribute('aria-label','当前旅行');
  const collection=el('section','pc-collection');
  const heading=el('div','pc-collection-heading');heading.append(el('h2','','旅行收藏册'));const count=el('span','pc-count');heading.append(count);
  const grid=el('div','pc-grid');const detail=el('section','pc-detail');detail.hidden=true;detail.setAttribute('aria-label','明信片详情');
  collection.append(heading,grid,detail);shell.append(hero,message,journey,collection);ctx.root.replaceChildren(shell);
  function tell(text:string,error=false){message.textContent=text;message.classList.toggle('pc-error',error);}
  function releaseDetail(){if(detailUrl){URL.revokeObjectURL(detailUrl);detailUrl=undefined;}}
  ctx.own({dispose(){imageEpoch++;releaseDetail();for(const url of thumbnailUrls.values())URL.revokeObjectURL(url);thumbnailUrls.clear();}});
  function remember(){ctx.memo.set('selected',selected);ctx.memo.set('flipped',flipped);}
  async function action(method:string,args:unknown[]=[]){
    if(busy||ctx.signal.aborted)return;revision++;busy=true;renderJourney();
    try {data=await ctx.invoke<Snapshot>(method,args);tell(method==='start'?'已经出发了，等它带一封来信回来。':method==='cancel'?'这次先回家，下一段风景还在等它。':'已继续准备这封来信。');render();}
    catch(error){if(!ctx.signal.aborted)tell(error instanceof Error?error.message:'操作暂时没有完成，请稍后再试。',true);}
    finally {busy=false;if(!ctx.signal.aborted)renderJourney();}
  }
  async function cancel(){if(!data?.trip)return;if(await ctx.ui.confirm({title:'让它先回家吗？',body:'这趟旅行将结束。已经发出的云端生成请求可能仍会计费。'}))await action('cancel',[data.trip.id]);}
  async function retry(){if(!data?.trip)return;let confirmed=false;if(data.trip.error?.includes('不确定')){confirmed=await ctx.ui.confirm({title:'确认后继续准备',body:'上次图片请求的结果不确定。请先核对服务记录；确认继续可能再次产生图片费用，且仍受本趟次数限制。'});if(!confirmed)return;}await action('retry',[data.trip.id,confirmed]);}
  function renderJourney(){
    if(!data)return;journey.replaceChildren();const t=data.trip;
    const text=el('div','pc-journey-copy');const title=el('h2');const sub=el('p','pc-muted');const controls=el('div','pc-journey-actions');
    if(active(t)){
      title.textContent=t!.status==='traveling'?'正在远方旅行':t!.status==='failed'?'这封来信还没准备好':t!.status==='awaiting_service'?'旅途到了，等来信启程':'正在把旅途装进信里';
      sub.textContent=t!.status==='traveling'?'预计 '+new Date(t!.dueAt).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})+' 结束旅行，之后还要准备明信片。':t!.status==='failed'?'已经保存这趟旅程，可以稍后继续准备。':t!.status==='awaiting_service'?'请先在扩展配置中连接云端生成服务。':'明信片和短笺准备好后，会自动收进下面的收藏册。';
      if(t!.status==='failed')controls.append(button('继续准备',retry,'pc-button pc-primary'));
      controls.append(button('先回家',cancel));
      if(t!.error){const info=el('details','pc-error-details');info.append(el('summary','','查看原因'),el('p','',t!.error));text.append(info);}
    }else{
      title.textContent='让它去远方走走';
      sub.textContent=data.generatorConnected?'旅行约 '+data.minutes+' 分钟。归来后准备明信片；云端生成按服务计费。':'先在扩展配置中连接图片与视觉服务，再让它出发。已收到的来信随时可以翻看。';
      const start=button('带一封来信回来',()=>action('start'),'pc-button pc-primary');start.disabled=!data.generatorConnected||busy;controls.append(start);
    }
    text.prepend(title,sub);for(const b of controls.querySelectorAll('button'))if(busy)b.disabled=true;journey.append(text,controls);
  }
  async function thumbnail(card:Card,img:HTMLImageElement){
    const known=thumbnailUrls.get(card.tripId);if(known){img.src=known;return;}
    try {const blob=await ctx.invokeBinary('thumbnail',[card.tripId]);if(ctx.signal.aborted)return;const previous=thumbnailUrls.get(card.tripId);if(previous){img.src=previous;return;}const url=URL.createObjectURL(blob);thumbnailUrls.set(card.tripId,url);if(img.isConnected)img.src=url;}
    catch{if(!ctx.signal.aborted&&img.isConnected)img.alt='暂时无法载入图片，可点击查看短笺';}
  }
  function renderCollection(){
    if(!data)return;count.textContent=data.cards.length+' 封旅途来信';grid.replaceChildren();
    const cards=[...data.cards].sort((a,b)=>b.completedAt-a.completedAt);
    if(!cards.length){const empty=el('div','pc-empty');empty.append(el('span','pc-empty-symbol','✉'),el('h3','','第一封来信，还在路上'),el('p','','让它去远方走走，等一封属于这趟旅程的来信。'));grid.append(empty);}
    for(const card of cards){const open=button('',()=>{selected=card.tripId;flipped=false;remember();void renderDetail(true);},'pc-postcard');open.setAttribute('aria-label','打开来信：'+card.title);
      const image=el('img');image.alt=card.title+'旅行明信片';image.loading='lazy';image.width=360;image.height=540;
      const footer=el('div','pc-card-footer');footer.append(el('h3','',card.title),el('time','',date(card.completedAt)));open.append(image,footer);grid.append(open);void thumbnail(card,image);
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
    const bar=el('div','pc-detail-bar');bar.append(el('h2','','旅途寄来的信'),button('收起来',()=>{selected=null;remember();void renderDetail(false);}));
    const content=el('div','pc-letter');
    if(flipped){content.classList.add('pc-letter-back');content.append(el('span','pc-postmark','旅途留念 · '+date(card.completedAt)),el('h3','',card.title),el('p','pc-note',card.note),el('span','pc-signature','把这一刻，寄给你。'));}
    else {const image=el('img','pc-full-image');image.alt=card.title;content.append(image);try{const blob=await ctx.invokeBinary('image',[card.tripId]);if(ctx.signal.aborted||epoch!==imageEpoch)return;detailUrl=URL.createObjectURL(blob);image.src=detailUrl;}catch{if(epoch===imageEpoch)content.append(el('p','pc-error','图片暂时无法载入，仍可翻到背面读信。'));}}
    if(ctx.signal.aborted||epoch!==imageEpoch)return;
    const actions=el('div','pc-detail-actions');const flip=button(flipped?'看看风景':'翻到背面读信',()=>{flipped=!flipped;remember();void renderDetail(false);},'pc-button pc-primary');flip.setAttribute('aria-pressed',String(flipped));actions.append(flip,button('保存图片',()=>download(card,'png')),button('打包带走',()=>download(card,'zip')));
    detail.append(bar,content,actions);if(scroll)detail.scrollIntoView({behavior:'smooth',block:'start'});
  }
  function render(){renderJourney();const key=JSON.stringify(data?.cards);if(key!==lastCards){lastCards=key;renderCollection();}}
  async function refresh(){if(loading||busy||ctx.signal.aborted)return;loading=true;const version=revision;try{const next=await ctx.invoke<Snapshot>('snapshot');if(!ctx.signal.aborted&&version===revision){data=next;render();}}catch{if(!ctx.signal.aborted)tell('暂时联系不上旅行册，已打开的来信仍留在这里。',true);}finally{loading=false;}}
  await refresh();ctx.interval(()=>{void refresh();},5000);
}
export default {panels:{album:{mount:mountAlbum}}};
