import type {WebUiPanelContext} from 'cortico/web/shared/client-panel.ts';
interface State {keys:{ark:boolean;vision:boolean};secureSaveAvailable:boolean;cloudEnabled:boolean;characterReference:string;styleReference:string;}
export async function mountSetup(ctx:WebUiPanelContext){
 const d=ctx.root.ownerDocument;
 const el=(tag:string,text='')=>{const n=d.createElement(tag);n.textContent=text;return n;};
 const root=el('section');root.className='pc-setup';ctx.root.append(root);
 const status=el('p');status.setAttribute('role','status');
 const say=(s:string)=>{if(!ctx.signal.aborted)status.textContent=s;};
 const link=(text:string,url:string)=>{const a=d.createElement('a');a.textContent=text;a.href=url;a.target='_blank';a.rel='noopener noreferrer';return a;};
 const button=(text:string,action:()=>Promise<void>)=>{const b=d.createElement('button');b.type='button';b.className='pc-button';b.textContent=text;b.onclick=()=>{b.disabled=true;void action().catch(()=>say('操作未完成，请检查配置或部署目录权限后重试。')).finally(()=>{if(!ctx.signal.aborted)b.disabled=false;});};return b;};
 root.append(el('h1','让第一封旅行来信顺利抵达'),el('p','准备两个云端服务的 API Key 和两张 PNG 参考图。无需 OpenAI 账号，也不需要在本机安装模型。这里的检查不会调用云端 API 或产生生图费用。'),status);
 const state=await ctx.invoke<State>('snapshot');if(ctx.signal.aborted)return;
 root.append(el('h2','1 · 配置两个云端服务'));
 for(const [id,title,description,url] of [
  ['ark','火山方舟 · 画明信片','使用 Doubao-Seedream-5.0-pro，根据角色与画风参考图生成完整明信片。在方舟控制台开通对应模型的调用权限、检查账户余额，再创建 API Key。','https://ark.volcengine.com/region:cn-beijing/apikey'],
  ['vision','DeepSeek · 看图写信与检查','使用 deepseek-flash 读取成图、生成短笺并检查明确的图文矛盾。需在 DeepSeek 开放平台创建 API Key 并确保账户可调用；聊天应用登录或会员不能代替 API Key。','https://platform.deepseek.com/api_keys']
 ] as const){
  const block=el('article');block.append(el('h3',title),el('p',description),link('打开官方 API Key 控制台',url));
  const configured=el('p',state.keys[id]?'已配置密钥（不回显内容）':'尚未配置密钥');
  const input=d.createElement('input');input.type='password';input.autocomplete='off';input.placeholder='粘贴此服务的 API Key';input.setAttribute('aria-label',title+' API Key');
  ctx.own({dispose:()=>{input.value='';}});
  const save=button('保存此服务密钥',async()=>{try{const next=await ctx.invoke<State>('setKey',[id,input.value]);if(ctx.signal.aborted)return;configured.textContent=next.keys[id]?'已配置密钥（不回显内容）':'尚未配置';say('密钥已交由宿主保存。请勿截图或分享部署目录中的 .env 文件。');}finally{input.value='';}});save.disabled=!state.secureSaveAvailable;
  block.append(configured,input,save);root.append(block);
 }
 root.append(el('p','密钥由宿主写入扩展部署目录的 .env；该文件包含明文凭据，请保管好。界面不回显、不存入浏览器缓存。模型与接口由本版本固定，无需填写模型名或接口地址。高级用户也可自行配置 POSTCARD_ARK_API_KEY 与 POSTCARD_VISION_API_KEY 环境变量。'));
 root.append(el('h2','2 · 选择两张参考图'));
 for(const [key,title,desc] of [
  ['characterReference','角色参考 PNG','决定宠物的外形、配色和身份，建议主体清楚、没有复杂遮挡。'],
  ['styleReference','画风参考 PNG','决定水彩笔触、色调与画面气质，不保证复制参考图中的地点。']
 ] as const){
  const label=el('p',state[key]||'尚未选择');root.append(el('h3',title),el('p',desc+' 图片需为可解码的PNG，宽高各512至4096像素，文件不超过40MB。'),label,button('选择'+title,async()=>{const path=await ctx.pickPath({kind:'file',title,extensions:['.png']});if(!path||ctx.signal.aborted)return;await ctx.setConfig('world:postcard',{['worlds.postcard.'+key]:path});label.textContent=path;say('路径已保存。请重启旅行明信片 World，再做本地检查。');}));
 }
 root.append(el('h2','3 · 理解配置选项，再开启生成'),el('p','每次新旅行固定为2小时，无法修改。旅行进度按真实经过时间计算；到达后还需制作明信片，生成耗时另计。旧旅程保留出发时的归来时间。'));
 const items=[
 ['允许宠物主动询问旅行','默认开启。到时给宠物一个询问机会，由宠物自然表达；用户明确同意才出发，沉默与拒绝都不会生图。保存后立即生效。'],
 ['主动询问间隔（分钟）','默认360分钟（6小时），范围1至43200。旅行未结束或服务未接入时暂停，恢复后重新计时；关机期间不会补发。询问可能消耗少量宿主对话模型用量，间隔不保证每次都说话。保存后立即生效。'],
 ['启用云端明信片生成','默认关闭。两项密钥、参考图准备好后开启，并重启本World。角色图、画风图发送给方舟，成图发送给DeepSeek；云服务按各自用量计费。开关本身不发起旅行。'],
 ['角色参考PNG路径','本机角色图的绝对路径。出发时复制固定，本趟不会随原图修改而变化。修改后重启本World。'],
 ['画风参考PNG路径','本机画风图的绝对路径。用于保持画面风格；修改后重启本World。'],
 ['图片服务代理（留空直连）','只影响方舟生图。通常留空；确需代理时填写HTTP(S)代理，例如http://127.0.0.1:7890，不能填API接口地址或密钥。修改后重启本World。'],
 ['视觉服务代理（留空直连）','只影响DeepSeek看图与文案。通常留空，留空不会继承宿主代理；需要时填HTTP(S)代理地址。修改后重启本World。']
 ];const dl=el('dl');for(const [title,text] of items)dl.append(el('dt',title),el('dd',text));root.append(dl);
 const config=d.createElement('a');config.href='#/provider/world%3Apostcard/~config';config.textContent='前往配置页调整上述选项';root.append(config,el('p','在宿主总览确认旅行明信片 World 已启用；修改需要重启的选项后，只重启这个 World，再回到本页检查。'));
 root.append(el('h2','4 · 做一次不收费的本地检查'));
 const checks=el('div');checks.setAttribute('aria-live','polite');root.append(button('检查本地配置（不调用 API）',async()=>{const r=await ctx.invoke<Record<string,unknown>>('check');if(ctx.signal.aborted)return;checks.replaceChildren();const keys=r.keys as State['keys'];for(const [name,ok] of [['方舟密钥已填写',keys.ark],['DeepSeek密钥已填写',keys.vision],['角色PNG可读取且尺寸合规',r.characterReference],['画风PNG可读取且尺寸合规',r.styleReference],['图片代理格式',r.imageProxy],['视觉代理格式',r.visionProxy],['云生成已开启',r.cloudEnabled]])checks.append(el('p',(ok?'✓ ':'待处理 · ')+name));say('仅核对本机配置：不能验证密钥有效性、余额、模型权限或网络可达性。刚修改路径或云开关时，请先重启本World。');}),checks,el('p','准备好后回到“远方来信”，同意宠物旅行或手动让它出发。真实生成会收费；不确定上次生图是否已成功时，先检查服务记录再重试。'));
 root.append(el('h2','遇到问题时'),el('p','401：检查密钥是否属于对应服务、是否有效。403：检查模型开通权限、账户状态与限额，不能只看余额。429：检查速率或额度限制。连接超时：检查网络与代理。参考图检查不通过：核对PNG格式、尺寸、路径和读取权限。'));
 root.append(link('方舟官方入门','https://docs.volcengine.com/docs/ark/quick-start?lang=zh'),el('span',' · '),link('方舟计费说明','https://docs.volcengine.com/docs/ark/model-pricing?lang=zh'),el('span',' · '),link('DeepSeek API 文档与计费','https://api-docs.deepseek.com/zh-cn/'));
}
