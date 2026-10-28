export const TRAVEL_MINUTES = 120;
import type { ConfigGroup } from 'cortico/core/types.ts';
export interface PostcardConfigSection { enabled: boolean; mailboxEnabled?:boolean; mailboxElectronFile?:string; characterPreset?:string; imageModel?:string; useHostModel?:boolean; proactiveEnabled:boolean; proactiveIntervalMinutes:number; minutes: number; cloudEnabled:boolean; characterReference:string; styleReference:string; imageProxyUrl:string; visionProxyUrl:string; }
export const POSTCARD_DEFAULTS: PostcardConfigSection = { enabled: false, mailboxEnabled:true, mailboxElectronFile:'', characterPreset:'auto', imageModel:'doubao-seedream-5-0-flash-260915', useHostModel:false, proactiveEnabled:true, proactiveIntervalMinutes:360, minutes: TRAVEL_MINUTES, cloudEnabled:false, characterReference:'',styleReference:'',imageProxyUrl:'',visionProxyUrl:'' };
export const POSTCARD_CONFIG_GROUP: ConfigGroup = {
  id: 'world:postcard', owner: 'world:postcard',
  schema: { type: 'object', title: '旅行明信片', properties: {
    'worlds.postcard.mailboxEnabled':{type:'boolean',title:'显示桌面旅行邮箱',description:'默认开启，只新增邮箱，不创建或替换桌宠。关闭邮箱不取消旅行；可在收藏册重新打开。需要独立Electron运行时，仅验证Windows，保存后重启World。','x-hot':false},
    'worlds.postcard.mailboxElectronFile':{type:'string',title:'邮箱Electron运行时路径（可选）',description:'通常留空，自动使用本机桌宠面板已安装的Electron运行时；找不到时收藏册仍可使用。不应填写Coopanion.exe、模型地址或密钥。保存后重启World。','x-hot':false},
    'worlds.postcard.proactiveEnabled': {type:'boolean',title:'允许宠物主动询问旅行',description:'到间隔后由宠物询问是否可以旅行；收到明确同意才出发，不会自动生图。', 'x-hot':true},
    'worlds.postcard.proactiveIntervalMinutes': {type:'number',title:'主动询问间隔（分钟）',description:'默认360分钟（6小时），可关闭主动询问。未结束旅行或生成服务未连接时暂停；重新可用后重新计时。关闭应用期间不补发积压询问。询问会触发宿主原有模型对话，可能产生少量文本用量。',minimum:1,maximum:43200,'x-hot':true},
    'worlds.postcard.imageModel':{type:'string',title:'生图模型ID',description:'默认doubao-seedream-5-0-flash-260915。可填写其他方舟模型ID或推理接入点ID；须支持两张参考图、2K和PNG/base64输出。此项不代表兼容任意厂商接口。模型需在方舟开通；保存后重启，仅新旅行使用。','x-hot':false},
    'worlds.postcard.useHostModel': {type:'boolean',title:'使用宿主模型看图与写信',description:'默认关闭以兼容已有独立API。开启后无需独立视觉Key；宿主必须支持PNG，任务进入主会话并消耗宿主用量。忙碌时等待，10分钟超时后手动继续；不静默回退收费API。保存后重启World，仅影响新旅行，旧旅行保留原通道。','x-hot':false},
    'worlds.postcard.cloudEnabled': { type:'boolean', title:'启用云端明信片生成',description:'参考图发送至方舟；成图由所选宿主模型或独立DeepSeek处理，分别消耗对应额度。先配置生图密钥与参考图，独立视觉模式另需视觉密钥；默认关闭，开启后重启本World。仅开启不会自动开始旅行。', 'x-hot':false },
    'worlds.postcard.characterPreset':{type:'string',title:'角色参考来源',enum:['auto','maid','winter','crew','custom'],description:'auto兼容旧配置：已填角色路径则使用该图，否则默认内置冬装。maid女仆装/winter冬装/crew店员装可在配置引导直观选择；custom使用导入图。仅影响新旅行，保存后重启World；不自动跟随宿主换装。','x-hot':false},
    'worlds.postcard.characterReference': { type:'string',title:'角色参考PNG路径',description:'决定宠物外形与配色。使用本机可读取的PNG文件，512至4096像素；出发时复制固定，后续修改不影响本趟。保存后重启本World。', 'x-hot':false },
    'worlds.postcard.styleReference': { type:'string',title:'画风参考PNG路径',description:'留空使用内置的开发水彩参考图。自选图提供笔触、色调与构图方向，不要求复制其中的地点。使用本机可读取的PNG文件，512至4096像素；保存后重启本World。','x-hot':false },
    'worlds.postcard.imageProxyUrl': { type:'string',title:'图片服务代理（留空直连）',description:'仅影响火山方舟请求。通常留空；需要代理时填http://127.0.0.1:7890等HTTP(S)代理地址，不能填模型接口或密钥。保存后重启本World。','x-hot':false },
    'worlds.postcard.visionProxyUrl': { type:'string',title:'视觉服务代理（留空直连）',description:'仅影响DeepSeek看图与写短笺请求。通常留空；需要时填写HTTP(S)代理地址。留空不继承宿主代理，保存后重启本World。','x-hot':false },
  } },
};
