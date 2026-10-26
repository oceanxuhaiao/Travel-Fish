# 旅行明信片 World · 核心预览

本包当前完成旅行状态与持久化核心，**尚未把云端生成适配迁入 World，也没有收藏面板，不是可交付的完整旅行扩展**。默认禁用；开启后可以通过工具开始/查看/取消旅行，到期会明确报告 awaiting_service，不伪装实际生图，不自动收费。

独立云端内容验证已在工作区 output/phase-a-cloud/ 完成森林与雪夜两张真实图→云端读图→写短笺→明确矛盾检查→自动收藏。下一阶段将这一内容适配迁入本包并接 ctx.secret，然后实现标准面板。

## 当前能力

- forest/coast/snow；默认30分钟；单趟旅行，固定tripId与dueAt，重启保留；停机到期启动后补推进。
- 开放 postcard_start/status/list/read/cancel/retry；不直接访问 Persona Memory 或桌宠 World。
- 独立命名空间 `<dataDir>/postcard`；state.json 保存旅行状态与通知确认，collection/<tripId> 保存图片、短笺、元数据和哈希。
- 同一目录单写入者锁；原子提交完整收藏；已存在收藏不可覆盖；状态提交失败优先从已落盘收藏恢复。
- 生成中取消阻止迟到结果入库；失败不自动重新收费，重启发现生成中断明确失败待确认，手动重试保留tripId。
- 收藏独立于通知；通知确认持久保存，失败可稍后补发，跨进程不承诺严格一次投递。
- 无云端凭据、无当前用户参考图、无私人配置进入包；生产服务尚未接入。

## 开发验证

```powershell
corepack pnpm install
corepack pnpm typecheck
corepack pnpm test
```

在工作区选定 Cortico checkout 内执行 describe:extension 与 check:extension；详细记录见 VALIDATION.md。

测试使用可控时钟和注入的测试生成器，不调用任何云端API，不消耗用户额度；测试产物不宣称真实模型生成。13项测试覆盖状态推进、重启、取消、并发、收费重试边界、收藏提交故障恢复、损坏文件、单写入锁、通知与World契约。

## 下一阶段

迁入Seedream/DeepSeek生产适配，参考图显式配置并存副本；密钥经ctx.secret取得；分离图片与文案检查点，限制图片/文案重试；补齐错误状态与可恢复阶段。随后接旅行/收藏面板与导出，最后在目标Coopanion实际安装验证。当前不修改或重启用户宿主，不发布npm。
