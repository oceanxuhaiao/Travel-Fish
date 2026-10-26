# 旅行明信片 World · 云端流水线候选版

本包已迁入Seedream/DeepSeek云端流水线，包含旅行计时、固定输入、阶段检查点、图片/文案审核及永久收藏。**标准旅行/收藏面板已实现并通过隔离验收；E自动回归达到门槛，开发者人工抽检待完成；F目标Coopanion安装验收未完成，不是最终交付版。** 默认扩展与云端生成均关闭。仅在用户明确出发且云端生成已配置时到期调用API；未启用云端时报告awaiting_service。

独立Python验证见 output/phase-a-cloud；正式TypeScript World的隔离真实API验收留在 output/stage-c-world-validation。后者使用可控时钟缩短旅行等待，但实际生图、读图、文案和入库调用都是真实的；不等于运行中宿主的第三级验收。

## 当前能力

- forest/coast/snow；默认30分钟；单趟旅行，固定tripId与dueAt，重启保留；停机到期启动后补推进。
- 开放 postcard_start/status/list/read/cancel/retry；不直接访问 Persona Memory 或桌宠 World。
- 独立命名空间 `<dataDir>/postcard`；state.json 保存旅行状态与通知确认，collection/<tripId> 保存图片、短笺、元数据和哈希。
- 同一目录单写入者锁；原子提交完整收藏；已存在收藏不可覆盖；状态提交失败优先从已落盘收藏恢复。
- 生成中取消阻止迟到结果入库；失败不自动重新收费，重启发现生成中断明确失败待确认，手动重试保留tripId。
- 收藏独立于通知；通知确认持久保存，失败可稍后补发，跨进程不承诺严格一次投递。
- 无云端凭据、无用户参考图、无私人配置进入包；角色与画风参考由用户明确指定，在出发时复制到每趟输入目录并固定SHA256、提示词与策略版本。
- 图片最多两次候选，每张合格图最多两版文案；文案拒绝不会触发生图。微风、声音、感受和比喻等不确定内容不阻断，只有明确矛盾才拒绝。
- 图像请求断连或保存不完整保留pendingImage；必须确认远端结果后通过postcard_retry的confirmUnknownOutcome显式确认。确认也不能突破两次图片上限。网络文字阶段最多两次请求；格式错误保留原响应并允许恢复同一张图。

## 开发验证

```powershell
corepack pnpm install
corepack pnpm typecheck
corepack pnpm test
```

在工作区选定 Cortico checkout 内执行 describe:extension 与 check:extension；详细记录见 VALIDATION.md。

测试使用可控时钟和注入的测试生成器，不调用任何云端API，不消耗用户额度；测试产物不宣称真实模型生成。46项测试覆盖状态推进、重启、取消、并发、收费重试边界、收藏提交故障恢复、损坏文件、单写入锁、通知与World契约。

## 下一阶段

阶段C及D各自验收已通过。E完成30趟（27自动完成、3次HTTP403失败保留）、40组对照（0漏放/0误拒）、故障与依赖自动回归；完整证据见output/stage-e-regression。海岸构图重复、两处蹲/坐措辞风险及表达套路已记录，未改写旧收藏。计划要求的开发者人工抽检尚待完成，之后进入F目标宿主实际验收。不得把C的成功当作整个扩展完成。当前不修改或重启用户宿主，不发布npm。


## 云端配置

在部署环境中配置 `POSTCARD_ARK_API_KEY`（火山方舟）和 `POSTCARD_VISION_API_KEY`（DeepSeek）；代码只通过ctx.secret读取，不读开发机密钥文件。

World配置：cloudEnabled=true，characterReference与styleReference为明确选择的PNG路径；需要时设置imageProxyUrl/visionProxyUrl，不含用户名密码，留空直连。这些项标为重启生效；minutes热改。参考图片会发送至火山方舟；生成图片会发送至DeepSeek；两者均可能按量收费。

当前支持已实测的 doubao-seedream-5-0-pro-260628 与 deepseek-flash 及对应官方接口，不默认支持任意OpenAI兼容端点或本地模型。单趟提示词、模型、参考图哈希及策略在出发时固定；更换参考图或升级不改写旧收藏。

`postcard/trips/<tripId>/` 保存固定输入、阶段检查点、候选图与审核记录；完整成品提交到collection后才发完成事件。原始服务错误不包含在用户回执，记录仅保留安全HTTP状态、阶段与可能结果不确定的说明。

隔离验收脚本 `scripts/live-stage-c.ts` 仅是开发辅助：使用显式参数读取开发机凭据，再注入等价secret回调；不被生产入口调用，不随npm files打包，也不修改真实宿主。

阶段C实际验收：三类各一趟完成，每趟一次生图。雪夜正文超长先失败，自动保留完整原句到长度上限内后按原tripId恢复，继续同样的文图检查，原文与失败记录保留。不是30趟稳定性回归完成。


## 标准面板

World页的“远方来信”面板提供旅行与收藏：出发、等待、取消、失败恢复、目的地筛选、翻面、保存PNG原图和单趟ZIP。所有数据读写复用World服务；生成完成自动收藏，刷新不会重新出发。背面与筛选选择仅保留在本面板memo。

JS/CSS随包交付：`corepack pnpm build:webui` 生成dist/webui.js/css；`corepack pnpm typecheck:web`检查浏览器代码。面板不直接请求宿主私有API，不访问document.body，轮询和对象URL随卸载释放。旧收藏阅读/导出只需本机WebUI，不依赖图片或视觉云服务在线。

ZIP包含postcard.png、note.md、metadata.json，剔除密钥、内部路径、提示词和审核调试信息；PNG与存档保持相同SHA256。开发浏览器预览见scripts/preview-panel.ts，测试外层和模拟到期按钮不随包交付；本轮未修改真实Coopanion。
