/** Image protocols are selected explicitly; model names never select a protocol. */
export type ImageBackend = 'ark'|'compatible'|'qwen'|'gemini';
export type Json = Record<string, any>;
export const IMAGE_BACKENDS = ['ark','compatible','qwen','gemini'] as const;
export const IMAGE_PRESETS = {
 ark:{model:'doubao-seedream-5-0-flash-260915',baseUrl:'',size:'2K'},
 qwen:{model:'qwen-image-2.0',baseUrl:'https://dashscope.aliyuncs.com/api/v1',size:'1024*1536'},
 gemini:{model:'gemini-3-pro-image',baseUrl:'https://generativelanguage.googleapis.com/v1beta',size:'2K'},
};
export const imageKeyName=(backend:ImageBackend)=>({ark:'POSTCARD_ARK_API_KEY',compatible:'POSTCARD_IMAGE_API_KEY',qwen:'POSTCARD_QWEN_API_KEY',gemini:'POSTCARD_GEMINI_API_KEY'})[backend];
function baseUrl(base:string){let u:URL;try{u=new URL(base);}catch{throw Error('生图API请求地址无效');}if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.search||u.hash)throw Error('生图接口只支持不含凭据或查询参数的HTTP(S)地址');return u;}
export function protocolEndpoint(backend:ImageBackend,base:string,model:string){
 if(backend==='ark')return 'https://ark.cn-beijing.volces.com/api/v3/images/generations';
 const u=baseUrl(base),root=u.href.replace(/\/$/,'');
 if(backend==='compatible')return root+(u.pathname.replace(/\/$/,'').endsWith('/images/generations')?'':'/images/generations');
 if(backend==='qwen'){const suffix='/services/aigc/multimodal-generation/generation';if(u.pathname.replace(/\/$/,'').endsWith(suffix))return root;if(!u.pathname.replace(/\/$/,'').endsWith('/api/v1'))throw Error('千问接口地址应以/api/v1或完整multimodal-generation/generation结尾');return root+suffix;}
 if(!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,159}$/.test(model))throw Error('Gemini模型ID无效，请只填写模型名称');
 const full=u.pathname.match(/\/models\/([^/]+):generateContent$/);if(full){if(full[1]!==model)throw Error('Gemini请求地址中的模型与模型ID不一致');return root;}
 if(!/\/v1(?:beta)?$/.test(u.pathname.replace(/\/$/,'')))throw Error('Gemini原生接口地址应以/v1beta或/v1结尾，不是OpenAI兼容接口');
 return root+'/models/'+model+':generateContent';
}
export function validateImageSettings(backend:ImageBackend,base:string,model:string,size:string){
 if(!IMAGE_BACKENDS.includes(backend))throw Error('生图通道版本不支持');
 protocolEndpoint(backend,base,model);
 if(!model.trim())throw Error('请填写生图模型ID');
 if(backend==='qwen'&&!/^\d{3,4}\*\d{3,4}$/.test(size))throw Error('千问尺寸请填写宽*高，例如1024*1536');
 if(backend==='qwen'&&size.split('*').some(n=>+n<512||+n>2048||+n%16!==0))throw Error('千问尺寸每边应为512至2048且为16的倍数');
 if(backend==='gemini'&&!['1K','2K'].includes(size))throw Error('Gemini分辨率请填写1K或2K；4K竖图超过收藏尺寸上限');
}
export function imageWireRequest(backend:ImageBackend,base:string,p:Json,key:string){
 const model=String(p.model),size=String(p.size),images=p.image as string[];
 validateImageSettings(backend,base,model,size);
 if(!Array.isArray(images)||images.length!==2||images.some(s=>typeof s!=='string'||!s.startsWith('data:image/png;base64,')))throw Error('必须提供角色和画风两张PNG参考图');
 let body:Json=p;
 if(backend==='qwen')body={model,input:{messages:[{role:'user',content:[...images.map(image=>({image})),{text:p.prompt}]}]},parameters:{n:1,size,prompt_extend:false,watermark:false}};
 if(backend==='gemini')body={contents:[{role:'user',parts:[{text:p.prompt},...images.map(s=>({inlineData:{mimeType:'image/png',data:s.slice('data:image/png;base64,'.length)}}))]}],generationConfig:{candidateCount:1,responseModalities:['TEXT','IMAGE'],imageConfig:{aspectRatio:'2:3',imageSize:size}}};
 return {url:protocolEndpoint(backend,base,model),headers:backend==='gemini'?{'x-goog-api-key':key}:key?{Authorization:'Bearer '+key}:{},body};
}
/** No API key is sent to result URLs; only the documented Alibaba OSS output host is allowed. */
export function qwenResultUrl(value:string){const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||u.port||!u.hostname.endsWith('.aliyuncs.com'))throw Error('千问图片链接不是受支持的官方HTTPS存储地址');return u.href;}
export async function normalizeImageResponse(backend:ImageBackend,value:Json,download:(url:string)=>Promise<Buffer>):Promise<Json>{
 if(backend==='gemini'){
  const candidates=value.candidates;if(!Array.isArray(candidates)||candidates.length!==1||candidates[0].finishReason!=='STOP')throw Error('Gemini未返回完整图片，可能被拦截或输出中断');
  const images=(candidates[0].content?.parts??[]).filter((p:Json)=>!p.thought&&(p.inlineData||p.inline_data));
  if(images.length!==1)throw Error('Gemini未返回单张PNG图片');const image=images[0].inlineData??images[0].inline_data;
  if((image.mimeType??image.mime_type)!=='image/png'||typeof image.data!=='string'||image.data.length>56*1024*1024)throw Error('Gemini图片不是受支持的PNG格式');
  return {model:value.modelVersion,usage:value.usageMetadata,data:[{b64_json:image.data}]};
 }
 if(backend==='qwen'){
  const choices=value.output?.choices;if(!Array.isArray(choices)||choices.length!==1||choices[0].finish_reason!=='stop')throw Error('千问未返回完整图片');
  const images=(choices[0].message?.content??[]).filter((p:Json)=>typeof p.image==='string');if(images.length!==1)throw Error('千问未返回单张PNG图片');
  const bytes=await download(qwenResultUrl(images[0].image));return {usage:value.usage,data:[{b64_json:bytes.toString('base64')}]};
 }
 return value;
}
