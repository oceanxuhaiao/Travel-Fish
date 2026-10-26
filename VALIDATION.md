# 验证记录

2026-10-26，Windows，Node24.14.1，pnpm11.28.6。

选定Cortico checkout cb9ddbd685bcccba1f29905098648f46a79b3862，依赖及源码契约0.2.7/World API6；目标已安装Coopanion0.2.10，内置四份契约源码匹配。未宣称GitHub当前main已更新。

| 命令 | 结果 |
|---|---|
| 包内 corepack pnpm typecheck | 退出0 |
| 包内 corepack pnpm test | 退出0，32/32通过 |
| Cortico checkout内 corepack pnpm describe:extension ../packages/cortico-world-postcard | 退出0，6工具/2事件/1提示文档 |
| Cortico checkout内 corepack pnpm check:extension ../packages/cortico-world-postcard | 退出0，Extension check passed |

完整官方check输出见extension-check.txt。依赖仅安装到工作区的包和Cortico checkout，未安装到运行中的Coopanion。Cortico checkout安装使用--ignore-scripts；官方校验工具仍实际执行成功，不代表未使用的原生依赖已验证可运行。

第一级和第二级完成；第三级目标Coopanion实际安装/加载/事件/工具目击未执行。本包已含生产云端生成适配，默认关闭云调用；隔离World三场景真实API、收藏与完成事件验证通过。标准面板及其隔离浏览器/导出验收已通过；E稳定性回归、F目标宿主验收未完成，不可宣称最终可发布。

当前tag为experimental，未声明平台限制（核心代码跨平台设计，但本轮只在Windows测试），未发布npm或向市场提交申请。测试生成器为注入假服务，仅用于故障与状态测试，没有冒充真实AI图片。

C阶段实测报告位于工作区output/stage-c-world-validation，三场景各一次生图；雪夜恢复只有文字审核。原失败记录保留，未声称首轮3/3通过。


阶段D：typecheck:web、build:webui退出0；官方检查识别到JS/CSS及1个面板；npm pack dry-run包含预构建产物。真实浏览器验证面板流程与PNG/ZIP下载，哈希一致；完整记录output/stage-d-panel-validation。32项测试包括服务状态、云端预算、标准面板导出、离线云服务下旧卡阅读及浏览器生命周期。D没有调用付费云端接口。
