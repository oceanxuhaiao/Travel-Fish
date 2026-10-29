const api=window.postcard,root=document.getElementById('root');
const el=(tag,text='')=>{const n=document.createElement(tag);n.textContent=text;return n;};
const button=(text,fn)=>{const n=el('button',text);n.type='button';n.onclick=()=>void fn();return n;};
const letterParams=new URLSearchParams(location.hash.slice(1)),letterId=letterParams.get('letter'),automatic=letterParams.get('preview')==='1';
if(letterId){
 document.body.className='letter-mode';root.className='letter';
 void(async()=>{try{
  const card=await api.call('read',letterId);root.append(el('h1',card.title));const content=el('section'),image=el('img'),note=el('p',card.note);note.className='note';note.hidden=true;image.alt=card.title;let acknowledged=false;
  const ack=async()=>{if(acknowledged)return;try{await api.call('mark-read',letterId);acknowledged=true;}catch{status.textContent='已打开来信，但已读状态保存失败，可稍后再试';}};
  const status=el('p',automatic?'取信预览：点击收下或翻面阅读后标为已读':'');status.className='muted';image.onload=()=>{if(!automatic)void ack();};image.onerror=()=>{status.textContent='图片暂时无法显示，仍可翻面读信';};image.src='data:image/png;base64,'+card.imageBase64;
  content.append(image,note);const actions=el('div');actions.className='actions';let back=false;const flip=button('翻面读信',async()=>{back=!back;image.hidden=back;note.hidden=!back;flip.textContent=back?'看看风景':'翻面读信';if(back)await ack();});if(automatic){const receive=button('收下这封信',async()=>{await ack();if(acknowledged){receive.hidden=true;status.textContent='已收下这封来信';}});actions.append(receive);}
  actions.append(flip,button('关闭',()=>api.call('close')));root.append(content,status,actions);
 }catch{const error=el('p','来信暂时无法打开，请在收藏册检查。');error.className='error';root.append(error);}})();
}else{
 root.className='mail-shell';const status=el('section');status.className='status';status.dataset.hit='';const title=el('strong','旅行邮箱'),label=el('p','正在连接'),progress=el('progress'),hint=el('p');hint.className='muted';progress.max=100;status.append(title,label,progress,hint);
 const debugUi=letterParams.get('debug')==='1';
 const controls=el('div');controls.className='buttons';controls.dataset.hit='';const pickup=button('请它取信',requestPickup);controls.append(pickup,button('直接读信',openLetter),button('看开盖',previewAnimation),button('关闭',()=>api.call('close')));
 let dragPointer=null,suppressClick=false,hovering=false,revealUntil=0;
 const reveal=()=>{revealUntil=Date.now()+5000;updateVisibility();};
 const updateVisibility=()=>{status.hidden=!debugUi&&!hovering&&Date.now()>=revealUntil;regions();};
 const mail=button('',()=>{if(suppressClick){suppressClick=false;return;}return requestPickup();});mail.id='mail';mail.setAttribute('aria-label','请桌宠来取旅行来信');
 const closed=el('img');closed.className='mail-art closed';closed.src='art/mailbox-closed.png';closed.alt='水彩木质邮箱';closed.draggable=false;
 const opened=el('img');opened.className='mail-art opened';opened.src='art/mailbox-open.png';opened.alt='';opened.draggable=false;
 const floating=el('img');floating.className='floating-card';floating.alt='本次旅行明信片';
 const hit=el('span');hit.className='hit-art';hit.dataset.hit='';mail.append(hit);
 mail.title='左右拖动邮箱可移动，轻点请它取信';
 mail.addEventListener('pointerenter',()=>{hovering=true;updateVisibility();});mail.addEventListener('pointerleave',()=>{hovering=false;updateVisibility();});
 mail.addEventListener('pointerdown',event=>{if(event.button!==0)return;dragPointer={id:event.pointerId,x:event.screenX??event.clientX,y:event.screenY??event.clientY};suppressClick=false;reveal();try{mail.setPointerCapture?.(event.pointerId);}catch{}void api.call('drag-start').catch(()=>{dragPointer=null;});});
 mail.addEventListener('pointermove',event=>{if(!dragPointer||event.pointerId!==dragPointer.id)return;if(Math.hypot((event.screenX??event.clientX)-dragPointer.x,(event.screenY??event.clientY)-dragPointer.y)>=5)suppressClick=true;if(suppressClick)void api.call('drag-move');});
 const endDrag=event=>{if(!dragPointer||event.pointerId!==dragPointer.id)return;dragPointer=null;void api.call('drag-end');};
 mail.addEventListener('pointerup',endDrag);mail.addEventListener('pointercancel',endDrag);mail.addEventListener('lostpointercapture',endDrag);
 mail.append(closed,opened,floating);root.append(status,controls,mail);
 let animation=null,starting=null,previewSequence=0;const played=new Set();
 function resetAnimation(){if(animation){clearTimeout(animation.timer);animation=null;}root.classList.remove('opening');floating.removeAttribute('src');regions();}
 async function animate(req,preview=false){
   if(animation||starting||played.has(req.requestId))return;starting=req.requestId;
   try{
     const card=await api.call('read',req.tripId);const latest=await api.call('state');if(!preview&&(latest.pickup?.active?.requestId!==req.requestId||latest.pickup.active.phase!=='presenting'))return;
     floating.src='data:image/png;base64,'+card.imageBase64;
     if(floating.decode)await floating.decode();
     const current=await api.call('state');if((!preview&&(current.pickup?.active?.requestId!==req.requestId||current.pickup.active.phase!=='presenting'))||Date.now()>=req.expiresAt)return;played.add(req.requestId);
     root.classList.add('opening');const timer=setTimeout(async()=>{try{
       if(preview){resetAnimation();return;}
       const result=await api.call('presentation-done',{requestId:req.requestId,tripId:req.tripId});if(!result.accepted)return;
       played.add(req.requestId);resetAnimation();await api.call('open-letter',{tripId:req.tripId,automatic:true});
     }catch{resetAnimation();hint.textContent='取信暂停，来信仍在，可直接阅读';}},3200);
     animation={requestId:req.requestId,timer,preview};regions();
   }catch{hint.textContent='演出暂未完成，来信仍可直接阅读';}finally{starting=null;}
 }
 async function previewAnimation(){try{await refresh();if(animation||starting)return;const card=state?.cards.find(c=>c.unread)??state?.cards[0];if(!card){hint.textContent='收到第一封来信后可预览开盖';return;}if(state.pickup?.active){hint.textContent='正在安排取信，请等本次完成';return;}await animate({requestId:'preview-'+Date.now()+'-'+(++previewSequence),tripId:card.tripId,expiresAt:Date.now()+15000},true);}catch{hint.textContent='预览暂时无法打开';}}
 let requestingPickup=false;
 async function requestPickup(){reveal();if(requestingPickup||animation||starting)return;requestingPickup=true;try{await refresh();const card=state?.cards.find(c=>c.unread)??state?.cards[0];if(!card){hint.textContent='还没有来信';return;}const request=await api.call('pickup-request',card.tripId);if(!request||request.kind==='unavailable'){hint.textContent='邮箱尚未就绪，请稍后再点一次';return;}if(request.kind==='open_local'){await api.call('open-letter',card.tripId);return;}if(request.kind==='cooldown'){hint.textContent='已收到请求，请稍等片刻；也可直接读信';return;}hint.textContent='已请求，等它空闲时来取信';await refresh();}catch{hint.textContent='暂时无法安排，来信仍可直接阅读';}finally{requestingPickup=false;}}
 let state=null,receivedAt=0,loading=false;
 function regions(){api.rects([...root.querySelectorAll('[data-hit]')].filter(n=>!n.hidden&&!n.closest('[hidden]')).map(n=>{const r=n.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};}));}
 function paint(){if(!state)return;root.style.setProperty('--mail-h',(state.height||120)+'px');root.style.height=Math.max(260,(state.height||120)+140)+'px';title.textContent='旅行邮箱'+(state.unreadCount?' · '+state.unreadCount+'封未读':'');const t=state.trip,remaining=t?Math.max(0,t.dueAt-Date.now()):0;const pct=t?Math.max(0,Math.min(100,Math.floor((Date.now()-t.startedAt)/(t.dueAt-t.startedAt)*100))):0;progress.hidden=!t;progress.value=pct;progress.setAttribute('aria-label','旅行等待进度');
  label.textContent=state.phase==='failed'?'来信暂未准备好':t?(remaining?'正在远方旅行':'旅行时间已到，来信待准备'):state.unreadCount?'有 '+state.unreadCount+' 封新来信':'等一封远方来信';
  hint.textContent=t&&remaining?'剩余约 '+Math.ceil(remaining/60000)+' 分钟 · '+pct+'%':t?'可在收藏册检查或继续准备':state.unreadCount?'点击邮箱，请它来取信':'点击邮箱，请它取出最近一封';root.classList.toggle('has-mail',state.unreadCount>0);
  updateVisibility();controls.hidden=!debugUi;
  const req=state.pickup?.active;pickup.hidden=!state.cards.length;pickup.disabled=!!req;
  if(req)label.textContent=req.phase==='presenting'?'正在取出这封来信':req.phase==='approaching'?'等它来到邮箱旁':'等它空闲时来取信';
  if(animation&&!animation.preview&&req?.requestId!==animation.requestId)resetAnimation();if(req?.phase==='presenting')void animate(req);regions();}
 async function refresh(){if(loading)return;loading=true;try{state=await api.call('state');receivedAt=Date.now();paint();}catch{state=null;progress.hidden=true;label.textContent='暂时联系不上旅行册';hint.textContent='收藏仍保留，请稍后再打开';regions();}finally{loading=false;}}
 async function openLetter(){try{resetAnimation();await refresh();if(!state||Date.now()-receivedAt>5000)return;const card=state.cards.find(c=>c.unread)??state.cards[0];if(!card){hint.textContent='还没有来信，请先在旅行收藏册出发';regions();return;}await api.call('open-letter',card.tripId);}catch{hint.textContent='来信暂时无法打开，请到收藏册查看';}}
 void refresh();setInterval(refresh,2000);setInterval(()=>{paint();updateVisibility();},1000);new ResizeObserver(regions).observe(status);
}
