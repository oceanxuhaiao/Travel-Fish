import type {PostcardConfigSection} from './config.ts';
export const PRICE_SOURCE='https://docs.volcengine.com/docs/ark/model-pricing?lang=zh';
export const PRICE_DATE='2026-10-28';
export function costEstimate(cfg:PostcardConfigSection){
 const explicit=cfg.imageUnitPrice;const unit=typeof explicit==='number'&&Number.isFinite(explicit)&&explicit>=0?explicit:((cfg.imageBackend??'ark')==='ark'&&(cfg.imageModel??'').includes('seedream-5-0-flash')?.12:null);
 return {unit,maxImages:2,normalImageCost:unit,maxImageCost:unit===null?null:Math.round(unit*200)/100,source:PRICE_SOURCE,checkedAt:PRICE_DATE,custom:typeof explicit==='number'&&explicit>=0,hostCost:'另加宿主模型故事规划、后续核对、看图、写信、评审及第三张总结用量；每轮单独授权，按宿主服务费率结算。',quality:'可以选择更便宜的兼容模型，但角色一致性、画面细节与稳定性可能降低；仍须支持双参考图和PNG。'};
}
