const api=window.postcard,root=document.getElementById('root');
const el=(tag,text='')=>{const n=document.createElement(tag);n.textContent=text;return n;};
const button=(text,fn)=>{const n=el('button',text);n.type='button';n.onclick=()=>void fn();return n;};
const letterId=new URLSearchParams(location.hash.slice(1)).get('letter');
if(letterId){
 document.body.className='letter-mode';root.className='letter';
 void(async()=>{try{
  const card=await api.call('read',letterId);root.append(el('h1',card.title));const content=el('section'),image=el('img'),note=el('p',card.note);note.className='note';note.hidden=true;image.alt=card.title;let acknowledged=false;
  const ack=async()=>{if(acknowledged)return;try{await api.call('mark-read',letterId);acknowledged=true;}catch{status.textContent='已打开来信，但已读状态保存失败，可稍后再试';}};
  const status=el('p');status.className='muted';image.onload=()=>void ack();image.onerror=()=>{status.textContent='图片暂时无法显示，仍可翻面读信';};image.src='data:image/png;base64,'+card.imageBase64;
  content.append(image,note);const actions=el('div');actions.className='actions';let back=false;const flip=button('翻面读信',async()=>{back=!back;image.hidden=back;note.hidden=!back;flip.textContent=back?'看看风景':'翻面读信';if(back)await ack();});actions.append(flip,button('关闭',()=>api.call('close')));root.append(content,status,actions);
 }catch{const error=el('p','来信暂时无法打开，请在收藏册检查。');error.className='error';root.append(error);}})();
}else{
 root.className='mail-shell';const status=el('section');status.className='status';status.dataset.hit='';const title=el('strong','旅行邮箱'),label=el('p','正在连接'),progress=el('progress'),hint=el('p');hint.className='muted';progress.max=100;status.append(title,label,progress,hint);
 const controls=el('div');controls.className='buttons';controls.dataset.hit='';controls.append(button('收信',openLetter),button('关闭邮箱',()=>api.call('close')));
 const mail=button('',openLetter);mail.id='mail';mail.setAttribute('aria-label','打开旅行来信');const box=el('div');box.className='box';box.dataset.hit='';const slot=el('div');slot.className='slot';const flag=el('div');flag.className='flag';flag.dataset.hit='';const envelope=el('span','✉');envelope.className='envelope';box.append(slot,flag,envelope);const post=el('div');post.className='post';post.dataset.hit='';mail.append(box,post);root.append(status,controls,mail);
 let state=null,receivedAt=0,loading=false;
 function regions(){api.rects([...root.querySelectorAll('[data-hit]')].map(n=>{const r=n.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};}));}
 function paint(){if(!state)return;title.textContent='旅行邮箱'+(state.unreadCount?' · '+state.unreadCount+'封未读':'');const t=state.trip,remaining=t?Math.max(0,t.dueAt-Date.now()):0;const pct=t?Math.max(0,Math.min(100,Math.floor((Date.now()-t.startedAt)/(t.dueAt-t.startedAt)*100))):0;progress.hidden=!t;progress.value=pct;progress.setAttribute('aria-label','旅行等待进度');
  label.textContent=state.phase==='failed'?'来信暂未准备好':t?(remaining?'正在远方旅行':'旅行时间已到，来信待准备'):state.unreadCount?'有 '+state.unreadCount+' 封新来信':'等一封远方来信';
  hint.textContent=t&&remaining?'剩余约 '+Math.ceil(remaining/60000)+' 分钟 · '+pct+'%':t?'可在收藏册检查或继续准备':state.unreadCount?'点击邮箱，看看它带回的风景':'点击邮箱可重读最近一封';root.classList.toggle('has-mail',state.unreadCount>0);regions();}
 async function refresh(){if(loading)return;loading=true;try{state=await api.call('state');receivedAt=Date.now();paint();}catch{state=null;progress.hidden=true;label.textContent='暂时联系不上旅行册';hint.textContent='收藏仍保留，请稍后再打开';regions();}finally{loading=false;}}
 async function openLetter(){try{await refresh();if(!state||Date.now()-receivedAt>5000)return;const card=state.cards.find(c=>c.unread)??state.cards[0];if(!card){hint.textContent='还没有来信，请先在旅行收藏册出发';regions();return;}await api.call('open-letter',card.tripId);}catch{hint.textContent='来信暂时无法打开，请到收藏册查看';}}
 void refresh();setInterval(refresh,2000);setInterval(paint,1000);new ResizeObserver(regions).observe(status);
}
