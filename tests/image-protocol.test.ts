import {it,expect,vi} from 'vitest';
import {createServer} from 'node:http';
import {imageWireRequest,protocolEndpoint,normalizeImageResponse,qwenResultUrl,IMAGE_PRESETS} from '../src/image-protocol.ts';
import {cloudTransport,HttpError} from '../src/generation.ts';
import {verificationFailure} from '../src/readiness.ts';
const p={model:'gemini-3-pro-image',prompt:'图1角色，图2水彩',image:['data:image/png;base64,YQ==','data:image/png;base64,Yg=='],size:'2K'};
it('默认仍为Flash；千问多模态消息按角色、画风顺序，强制只出一张',()=>{
 expect(IMAGE_PRESETS.ark.model).toContain('seedream-5-0-flash');
 const r=imageWireRequest('qwen','https://dashscope.aliyuncs.com/api/v1',{...p,model:'qwen-image-2.0',size:'1024*1536'},'test-only');
 expect(r.url).toBe('https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation');
 expect(r.body.input.messages[0].content).toEqual([{image:p.image[0]},{image:p.image[1]},{text:p.prompt}]);expect(r.body.parameters).toMatchObject({n:1,prompt_extend:false,size:'1024*1536'});expect(r.headers.Authorization).toBe('Bearer test-only');
});
it('Gemini使用原生inlineData双图、独立鉴权、固定2:3',()=>{
 const r=imageWireRequest('gemini','https://generativelanguage.googleapis.com/v1beta',p,'test-only');
 expect(r.url.endsWith('/models/gemini-3-pro-image:generateContent')).toBe(true);expect(r.headers).toEqual({'x-goog-api-key':'test-only'});
 expect(r.body.contents[0].parts).toEqual([{text:p.prompt},{inlineData:{mimeType:'image/png',data:'YQ=='}},{inlineData:{mimeType:'image/png',data:'Yg=='}}]);expect(r.body.generationConfig.imageConfig).toEqual({aspectRatio:'2:3',imageSize:'2K'});
});
it('完整地址不重复拼接；拒绝模型冲突、聊天地址、查询密钥与不支持尺寸',()=>{
 const full='https://example.com/v1beta/models/gemini-3-pro-image:generateContent';expect(protocolEndpoint('gemini',full,p.model)).toBe(full);expect(()=>protocolEndpoint('gemini',full,'another')).toThrow('不一致');
 for(const url of ['https://example.com/v1/chat/completions','https://example.com/v1?key=private','https://u:p@example.com/v1'])expect(()=>protocolEndpoint('gemini',url,p.model)).toThrow();
 expect(()=>imageWireRequest('gemini','https://example.com/v1', {...p,size:'1024x1536'},'test')).toThrow('分辨率');expect(()=>imageWireRequest('qwen','https://example.com/api/v1',p,'test')).toThrow('尺寸');
});
it('Gemini只保留最终单张PNG，不把思考图或文本误当成品',async()=>{
 const response={candidates:[{finishReason:'STOP',content:{parts:[{thought:true,inlineData:{mimeType:'image/png',data:'thought'}},{text:'描述'},{inlineData:{mimeType:'image/png',data:'actual'}}]}}],usageMetadata:{totalTokenCount:12}};
 expect(await normalizeImageResponse('gemini',response,vi.fn())).toMatchObject({data:[{b64_json:'actual'}]});
 await expect(normalizeImageResponse('gemini',{candidates:[]},vi.fn())).rejects.toThrow();response.candidates[0].content.parts[2].inlineData!.mimeType='image/jpeg';await expect(normalizeImageResponse('gemini',response,vi.fn())).rejects.toThrow('PNG');
});
it('千问仅下载官方HTTPS存储图片，URL与鉴权不进入归一化结果',async()=>{
 const url='https://dashscope-result-sz.oss-cn-shenzhen.aliyuncs.com/result.png?Expires=123',download=vi.fn(async()=>Buffer.from('png'));
 const result=await normalizeImageResponse('qwen',{output:{choices:[{finish_reason:'stop',message:{content:[{image:url}]}}]},usage:{image_count:1}},download);
 expect(download).toHaveBeenCalledOnce();expect(download).toHaveBeenCalledWith(url);expect(result.data).toEqual([{b64_json:Buffer.from('png').toString('base64')}]);expect(JSON.stringify(result)).not.toContain('Expires');
 for(const u of ['http://127.0.0.1/a','https://localhost/a','https://aliyuncs.com.evil.test/a','https://u:p@a.aliyuncs.com/a'])expect(()=>qwenResultUrl(u)).toThrow();
});
it('原生Gemini实际HTTP请求不经过OpenAI路径且不使用方舟Key；HTTP错误保留状态码',async()=>{
 let body:any,headers:any,url='';const server=createServer((req,res)=>{url=req.url!;headers=req.headers;let raw='';req.on('data',b=>raw+=b);req.on('end',()=>{body=JSON.parse(raw);res.writeHead(403,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'private provider body'}));});});await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 try{const base='http://127.0.0.1:'+String((server.address() as any).port)+'/v1beta';const transport=cloudTransport({root:'',characterReference:'',styleReference:'',imageBackend:'gemini',imageBaseUrl:base,secret:n=>n==='POSTCARD_GEMINI_API_KEY'?'gemini-test-only':'WRONG-KEY'});let error:any;try{await transport('image',p,new AbortController().signal);}catch(e){error=e;}expect(error).toBeInstanceOf(HttpError);expect(verificationFailure(error,'generating_image').code).toBe('HTTP_403');expect(String(error)).not.toContain('private');expect(headers['x-goog-api-key']).toBe('gemini-test-only');expect(headers.authorization).toBeUndefined();expect(url.endsWith(':generateContent')).toBe(true);expect(body.contents[0].parts).toHaveLength(3);
 }finally{await new Promise<void>(r=>server.close(()=>r()));}
});
