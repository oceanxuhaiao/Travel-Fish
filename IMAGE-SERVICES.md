# 生图服务接入

默认保留 Seedream 5.0 Flash。协议由“生图服务”明确选择，不从模型名称猜测。角色参考为图1，画风参考为图2；要求保留图1身份、仅迁移图2笔触与色调、不复制图2场景。

| 服务选项 | 推荐预填模型 | 请求地址 | 尺寸 | 密钥 |
|---|---|---|---|---|
| 火山方舟 | doubao-seedream-5-0-flash-260915 | 内置官方地址，无需填写 | 固定2K | POSTCARD_ARK_API_KEY |
| 千问图像编辑 | qwen-image-2.0 | https://dashscope.aliyuncs.com/api/v1 | 1024*1536 | POSTCARD_QWEN_API_KEY |
| Gemini原生 | gemini-3-pro-image | https://generativelanguage.googleapis.com/v1beta | 2K（可1K，固定2:3） | POSTCARD_GEMINI_API_KEY |
| 其他云端/本地兼容 | 服务实际开通的模型ID | 原兼容接口根地址或/images/generations | 服务支持值 | POSTCARD_IMAGE_API_KEY |

千问目前官方文档推荐qwen-image-2.0，支持图像编辑；也可填写实际开通、使用相同多模态编辑协议的模型ID。旧Edit Plus/Max不能仅凭名称保证当前地域可调用。千问北京、新加坡密钥与请求地址须匹配；专属业务空间域名从控制台复制，保留/api/v1路径。参考图每张最大10MB、每边不超过3072像素。parameters.n固定1，prompt_extend关闭以保留角色/画风分工，成品从官方HTTPS aliyuncs.com存储地址下载并验证PNG后写入本地。临时URL与原始响应不存入收藏或日志；下载不携带API Key、不跟随重定向。第三方千问代理若返回其他域名暂不支持。

Gemini采用官方仍有文档的generateContent协议（Google当前主图像指南转向Interactions；本版没有同时接入Interactions）。请求使用x-goog-api-key头，contents.parts中的两个inlineData传角色/画风，候选数1。双参考PNG合计不超过14MB，给base64及提示词保留请求空间；仅允许1K/2K，4K竖图可能超过现有4096像素收藏上限。只接受最终单张PNG，忽略thought图像；JPEG或文本-only不能入藏。支持完整:generateContent地址，地址模型须与模型ID一致。第三方服务必须明确提供相同协议与鉴权，不能把OpenAI /v1地址直接套用。未来API移除或模型变更需重新适配。

推荐预填不会保存配置、调用API或产生费用。先确认模型开通，保存独立密钥及配置，应用设置并重启，再明确确认计费进行制作验证。每次最多两张候选，云端各模型费用按实际服务费率填写估价，宿主看图写信另计。除Flash既有估价外，不猜测新模型价格。

各服务共用成品检查、宿主看图写信、两候选上限、远端结果不确定时禁止自动重发和旅行2小时交付规则。请求协议、模型、地址、尺寸与参考副本在出发时固定；旧收藏不依赖临时云端链接，更新不改旧卡。密钥不进入浏览器缓存、规格文件或公开包。

## 验证范围
本候选完成不收费的模拟服务/HTTP协议测试。官方百炼千问在开发者日常实例已完成一次全流程制作验证；这不是批量质量统计。Gemini原生尚未进行真实付费成图与角色/画风对照验收。模型支持多图不等于中转服务正确转发，也不保证每次角色一致。

## 官方依据（2026-10-29核对）
- 方舟：https://docs.volcengine.com/docs/ark/image-generation-api?lang=zh
- 千问：https://help.aliyun.com/zh/model-studio/qwen-image-edit-api
- Gemini generateContent：https://ai.google.dev/gemini-api/docs/generate-content/image-generation
- Gemini现行主指南：https://ai.google.dev/gemini-api/docs/image-generation
