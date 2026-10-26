# 验证记录

2026-10-26，Windows，Node24.14.1，pnpm11.28.6。

选定Cortico checkout cb9ddbd685bcccba1f29905098648f46a79b3862，依赖及源码契约0.2.7/World API6；目标已安装Coopanion0.2.10，内置四份契约源码匹配。未宣称GitHub当前main已更新。

| 命令 | 结果 |
|---|---|
| 包内 corepack pnpm typecheck | 退出0 |
| 包内 corepack pnpm test | 退出0，13/13通过 |
| Cortico checkout内 corepack pnpm describe:extension ../packages/cortico-world-postcard | 退出0，6工具/2事件/1提示文档 |
| Cortico checkout内 corepack pnpm check:extension ../packages/cortico-world-postcard | 退出0，Extension check passed |

完整官方check输出见extension-check.txt。依赖仅安装到工作区的包和Cortico checkout，未安装到运行中的Coopanion。Cortico checkout安装使用--ignore-scripts；官方校验工具仍实际执行成功，不代表未使用的原生依赖已验证可运行。

第一级和第二级完成；第三级目标Coopanion实际安装/加载/事件/工具目击未执行。本包是核心预览，默认无生产生成适配及自定义收藏面板，不能作为完整用户版本发布。

当前tag为experimental，未声明平台限制（核心代码跨平台设计，但本轮只在Windows测试），未发布npm或向市场提交申请。测试生成器为注入假服务，仅用于故障与状态测试，没有冒充真实AI图片。
