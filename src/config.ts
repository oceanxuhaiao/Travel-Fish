import type { ConfigGroup } from 'cortico/core/types.ts';
export interface PostcardConfigSection { enabled: boolean; proactiveEnabled:boolean; proactiveIntervalMinutes:number; minutes: number; cloudEnabled:boolean; characterReference:string; styleReference:string; imageProxyUrl:string; visionProxyUrl:string; }
export const POSTCARD_DEFAULTS: PostcardConfigSection = { enabled: false, proactiveEnabled:true, proactiveIntervalMinutes:360, minutes: 30, cloudEnabled:false, characterReference:'',styleReference:'',imageProxyUrl:'',visionProxyUrl:'' };
export const POSTCARD_CONFIG_GROUP: ConfigGroup = {
  id: 'world:postcard', owner: 'world:postcard',
  schema: { type: 'object', title: '旅行明信片', properties: {
    'worlds.postcard.proactiveEnabled': {type:'boolean',title:'允许宠物主动询问旅行',description:'到间隔后由宠物询问是否可以旅行；收到明确同意才出发，不会自动生图。', 'x-hot':true},
    'worlds.postcard.proactiveIntervalMinutes': {type:'number',title:'主动询问间隔（分钟）',description:'默认360分钟（6小时），可关闭主动询问。未结束旅行或生成服务未连接时暂停；重新可用后重新计时。关闭应用期间不补发积压询问。询问会触发宿主原有模型对话，可能产生少量文本用量。',minimum:1,maximum:43200,'x-hot':true},
    'worlds.postcard.minutes': { type: 'number', title: '旅行时长（分钟）', description:'默认30分钟，是出发后的现实等待时间；结束后还需云端生成时间。修改后对下一趟生效，保存立即应用，无需重启。', minimum: 1, maximum: 10080, 'x-hot': true },
    'worlds.postcard.cloudEnabled': { type:'boolean', title:'启用云端明信片生成',description:'参考图和成图将发送至火山方舟与DeepSeek，按服务计费；需先在“配置引导”保存两项密钥与参考图；默认关闭，开启后重启本World。仅开启不会自动开始旅行。', 'x-hot':false },
    'worlds.postcard.characterReference': { type:'string',title:'角色参考PNG路径',description:'决定宠物外形与配色。使用本机可读取的PNG文件，512至4096像素；出发时复制固定，后续修改不影响本趟。保存后重启本World。', 'x-hot':false },
    'worlds.postcard.styleReference': { type:'string',title:'画风参考PNG路径',description:'提供水彩笔触、色调与构图方向，不要求复制其中的地点。使用本机可读取的PNG文件，512至4096像素；保存后重启本World。','x-hot':false },
    'worlds.postcard.imageProxyUrl': { type:'string',title:'图片服务代理（留空直连）',description:'仅影响火山方舟请求。通常留空；需要代理时填http://127.0.0.1:7890等HTTP(S)代理地址，不能填模型接口或密钥。保存后重启本World。','x-hot':false },
    'worlds.postcard.visionProxyUrl': { type:'string',title:'视觉服务代理（留空直连）',description:'仅影响DeepSeek看图与写短笺请求。通常留空；需要时填写HTTP(S)代理地址。留空不继承宿主代理，保存后重启本World。','x-hot':false },
  } },
};
