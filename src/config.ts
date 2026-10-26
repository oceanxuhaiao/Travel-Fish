import type { ConfigGroup } from 'cortico/core/types.ts';
export interface PostcardConfigSection { enabled: boolean; minutes: number; }
export const POSTCARD_DEFAULTS: PostcardConfigSection = { enabled: false, minutes: 30 };
export const POSTCARD_CONFIG_GROUP: ConfigGroup = {
  id: 'world:postcard', owner: 'world:postcard',
  schema: { type: 'object', title: '旅行明信片', properties: {
    'worlds.postcard.minutes': { type: 'number', title: '旅行时长（分钟）', minimum: 1, maximum: 10080, 'x-hot': true },
  } },
};
