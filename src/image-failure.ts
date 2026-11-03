/** Safe, stable failures: never include provider bodies, URLs or arbitrary exception messages. */
export const IMAGE_FAILURE_REASONS = {
 IMAGE_JSON:'生图服务响应不是有效JSON', IMAGE_STRUCTURE:'生图服务响应结构不符合所选协议',
 IMAGE_NO_OUTPUT:'生图服务未返回最终图片', IMAGE_BLOCKED:'生图服务拦截了本次输出',
 IMAGE_INCOMPLETE:'生图服务输出未正常完成', IMAGE_FORMAT:'收到的图片格式不受支持，仅接受PNG、JPEG或WebP',
 IMAGE_DECODE:'图片解码或转换失败', IMAGE_CONVERTER:'本地图片转换组件未能加载',
 IMAGE_ANIMATED:'不支持动画或多帧图片，请使用单帧图片', IMAGE_DIMENSIONS:'图片尺寸须每边512至4096像素，不会自动缩放或裁切',
 IMAGE_BASE64:'生图服务返回的图片base64无效', IMAGE_LIMIT:'生图服务响应或图片超过本地大小上限',
 IMAGE_SAVE:'本地保存生图响应或图片失败', TIMEOUT:'等待生图服务响应超时',
 NETWORK:'连接生图服务或读取响应失败', INTERRUPTED:'生图请求被取消或中断',
 IMAGE_RESULT_UNKNOWN:'图片请求结果尚未确认',
} as const;
export type ImageFailureCode=keyof typeof IMAGE_FAILURE_REASONS;
export type ImageOutcome='received'|'unknown';
export interface ImageFailureInfo {code:ImageFailureCode;outcome:ImageOutcome;diagnosticId?:string;}
export function validImageFailureInfo(value:unknown):value is ImageFailureInfo {
 const v=value as ImageFailureInfo;
 return !!v&&typeof v==='object'&&Object.hasOwn(IMAGE_FAILURE_REASONS,v.code)&&['received','unknown'].includes(v.outcome)&&(v.diagnosticId===undefined||/^gemini-[a-f0-9-]{36}$/.test(v.diagnosticId));
}
export class ImageFailure extends Error {
 constructor(readonly code:ImageFailureCode,readonly outcome:ImageOutcome='received',readonly diagnosticId?:string){
  super(IMAGE_FAILURE_REASONS[code]+'；未自动重发，请先核对服务调用与账单记录');this.name='PostcardImageFailure';
 }
 info():ImageFailureInfo{return {code:this.code,outcome:this.outcome,...(this.diagnosticId?{diagnosticId:this.diagnosticId}:{})};}
}
export function imageCauseCode(error:unknown):string {
 const allowed=new Set(['TimeoutError','AbortError','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT','UND_ERR_SOCKET','ENOTFOUND','ECONNRESET','ECONNREFUSED','ETIMEDOUT','CERT_HAS_EXPIRED','UNABLE_TO_VERIFY_LEAF_SIGNATURE']);
 let item:any=error;
 for(let i=0;i<5&&item;i++,item=item.cause){for(const value of [item.code,item.name])if(typeof value==='string'&&allowed.has(value))return value;}
 return 'unknown';
}
export function imageNetworkFailure(error:unknown,signal:AbortSignal,diagnosticId?:string):ImageFailure {
 if(error instanceof ImageFailure)return new ImageFailure(error.code,error.outcome,diagnosticId??error.diagnosticId);
 const codes:string[]=[];let item:any=error;
 // Inspect only known system codes/names; no arbitrary messages enter diagnostics.
 for(let i=0;i<5&&item;i++,item=item.cause)codes.push(String(item.code??''),String(item.name??''));
 const timed=codes.some(c=>['TimeoutError','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT','ETIMEDOUT'].includes(c))||(signal.aborted&&signal.reason?.name==='TimeoutError');
 return new ImageFailure(timed?'TIMEOUT':signal.aborted||codes.includes('AbortError')?'INTERRUPTED':'NETWORK','unknown',diagnosticId);
}
