import type { ConfigGroup } from 'cortico/core/types.ts';
export interface PostcardConfigSection { enabled: boolean; minutes: number; cloudEnabled:boolean; characterReference:string; styleReference:string; imageProxyUrl:string; visionProxyUrl:string; }
export const POSTCARD_DEFAULTS: PostcardConfigSection = { enabled: false, minutes: 30, cloudEnabled:false, characterReference:'',styleReference:'',imageProxyUrl:'',visionProxyUrl:'' };
export const POSTCARD_CONFIG_GROUP: ConfigGroup = {
  id: 'world:postcard', owner: 'world:postcard',
  schema: { type: 'object', title: '旅行明信片', properties: {
    'worlds.postcard.minutes': { type: 'number', title: '旅行时长（分钟）', minimum: 1, maximum: 10080, 'x-hot': true },
    'worlds.postcard.cloudEnabled': { type:'boolean', title:'启用云端明信片生成',description:'参考图和成图将发送至火山方舟与DeepSeek，按服务计费；需配置POSTCARD_ARK_API_KEY和POSTCARD_VISION_API_KEY。', 'x-hot':false },
    'worlds.postcard.characterReference': { type:'string',title:'角色参考PNG路径',description:'明确选择的角色图；出发时复制固定，后续修改不影响本趟。', 'x-hot':false },
    'worlds.postcard.styleReference': { type:'string',title:'画风参考PNG路径','x-hot':false },
    'worlds.postcard.imageProxyUrl': { type:'string',title:'图片服务代理（留空直连）','x-hot':false },
    'worlds.postcard.visionProxyUrl': { type:'string',title:'视觉服务代理（留空直连）','x-hot':false },
  } },
};
