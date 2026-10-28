export const TRAVEL_MINUTES = 120;
import type { ConfigGroup } from 'cortico/core/types.ts';
export interface PostcardConfigSection { enabled: boolean; mailboxEnabled?:boolean; mailboxHeight?:number; mailboxElectronFile?:string; characterPreset?:string; imageModel?:string;imageBackend?:'ark'|'compatible';imageBaseUrl?:string;imageSize?:string;imageUnitPrice?:number; useHostModel?:boolean; proactiveEnabled:boolean; proactiveIntervalMinutes:number; minutes: number; cloudEnabled:boolean; characterReference:string; styleReference:string; imageProxyUrl:string; visionProxyUrl:string; }
export const POSTCARD_DEFAULTS: PostcardConfigSection = { enabled: false, mailboxEnabled:true, mailboxHeight:120, mailboxElectronFile:'', characterPreset:'auto', imageBackend:'ark',imageBaseUrl:'http://127.0.0.1:8000/v1',imageSize:'1024x1536',imageUnitPrice:-1, imageModel:'doubao-seedream-5-0-flash-260915', useHostModel:true, proactiveEnabled:true, proactiveIntervalMinutes:360, minutes: TRAVEL_MINUTES, cloudEnabled:true, characterReference:'',styleReference:'',imageProxyUrl:'',visionProxyUrl:'' };
export const POSTCARD_CONFIG_GROUP: ConfigGroup = {
  id: 'world:postcard', owner: 'world:postcard',
  schema: { type: 'object', title: '旅行大肥鱼', properties: {
    'worlds.postcard.mailboxHeight':{type:'number',title:'邮箱本体高度（逻辑像素）',description:'默认120，不包含进度条；建议接近桌宠可见身高。仅调整邮箱，不缩放桌宠，保存后重启World。',minimum:80,maximum:180,'x-hot':false},
    'worlds.postcard.mailboxEnabled':{type:'boolean',title:'显示桌面旅行邮箱',description:'默认开启，只新增邮箱，不创建或替换桌宠。关闭邮箱不取消旅行；可在收藏册重新打开。需要独立Electron运行时，仅验证Windows，保存后重启World。','x-hot':false},
    'worlds.postcard.mailboxElectronFile':{type:'string',title:'邮箱Electron运行时路径（可选）',description:'通常留空，自动使用本机桌宠面板已安装的Electron运行时；找不到时收藏册仍可使用。不应填写Coopanion.exe、模型地址或密钥。保存后重启World。','x-hot':false},
    'worlds.postcard.proactiveEnabled': {type:'boolean',title:'允许宠物主动询问旅行',description:'到间隔后由宠物询问是否可以旅行；收到明确同意才出发，不会自动生图。', 'x-hot':true},
    'worlds.postcard.proactiveIntervalMinutes': {type:'number',title:'主动询问间隔（分钟）',description:'默认360分钟（6小时），可关闭主动询问。未结束旅行或生成服务未连接时暂停；重新可用后重新计时。关闭应用期间不补发积压询问。询问会触发宿主原有模型对话，可能产生少量文本用量。',minimum:1,maximum:43200,'x-hot':true},
    'worlds.postcard.imageBackend':{type:'string',title:'生图服务',enum:['ark','compatible'],description:'ark为火山方舟；compatible为本地或自定义兼容HTTP生图接口，须接受两张参考图并返回单张PNG/base64。原生ComfyUI工作流需另接适配器，不能直接填写其原生地址。保存后重启，仅新旅行生效。','x-hot':false},
    'worlds.postcard.imageBaseUrl':{type:'string',title:'本地/兼容生图接口地址',description:'仅compatible使用，如http://127.0.0.1:8000/v1，程序追加/images/generations。不含密钥、查询参数或账号密码。保存后重启，仅新旅行生效。','x-hot':false},
    'worlds.postcard.imageSize':{type:'string',title:'本地/兼容出图尺寸',description:'仅compatible使用，按你的服务支持值填写，例如1024x1536；成品必须PNG、每边512—4096像素。方舟固定2K。','x-hot':false},
    'worlds.postcard.imageUnitPrice':{type:'number',title:'自定义每张图片估价（元，-1为自动）',minimum:-1,description:'费用提示用，不控制服务账单。自定义模型或兼容服务可按自己的费率填写；本地自托管无API账单可填0，但仍有电力/硬件和宿主模型用量。默认Flash未填写时按2026-10-28官方0.12元/张估算。','x-hot':false},
    'worlds.postcard.imageModel':{type:'string',title:'生图模型ID',description:'方舟默认doubao-seedream-5-0-flash-260915，也可填写其他已开通的方舟模型/接入点；本地模式填写本地服务中的模型名。必须真正使用双参考图并返回PNG/base64；是否兼容由服务协议决定。保存后重启，仅新旅行使用。','x-hot':false},
    'worlds.postcard.useHostModel': {type:'boolean',title:'使用宿主模型看图与写信',description:'默认开启，复用宿主API，无需再配置看图写信密钥；宿主必须支持PNG，任务进入主会话并消耗宿主用量。忙碌时等待，10分钟超时后手动继续；不静默回退收费API。保存后重启World，仅影响新旅行，旧旅行保留出发时的通道。','x-hot':false},
    'worlds.postcard.cloudEnabled': { type:'boolean', title:'启用云端明信片生成',description:'参考图发送至所选生图接口，成图交由宿主模型看图写信，分别消耗对应额度。先准备生图服务与参考图；默认开启，密钥与参考图准备好后才可出发；开关本身不自动旅行，修改后重启本World。', 'x-hot':false },
    'worlds.postcard.characterPreset':{type:'string',title:'角色参考来源',enum:['auto','maid','winter','crew','custom'],description:'auto兼容旧配置：已填角色路径则使用该图，否则默认内置冬装。maid女仆装/winter冬装/crew店员装可在配置引导直观选择；custom使用导入图。仅影响新旅行，保存后重启World；不自动跟随宿主换装。','x-hot':false},
    'worlds.postcard.characterReference': { type:'string',title:'角色参考PNG路径',description:'决定宠物外形与配色。使用本机可读取的PNG文件，512至4096像素；出发时复制固定，后续修改不影响本趟。保存后重启本World。', 'x-hot':false },
    'worlds.postcard.styleReference': { type:'string',title:'画风参考PNG路径',description:'留空使用内置的开发水彩参考图。自选图提供笔触、色调与构图方向，不要求复制其中的地点。使用本机可读取的PNG文件，512至4096像素；保存后重启本World。','x-hot':false },
    'worlds.postcard.imageProxyUrl': { type:'string',title:'图片服务代理（留空直连）',description:'仅影响所选生图接口请求。通常留空；需要代理时填http://127.0.0.1:7890等HTTP(S)代理地址，不能填模型接口或密钥。保存后重启本World。','x-hot':false },
  } },
};
