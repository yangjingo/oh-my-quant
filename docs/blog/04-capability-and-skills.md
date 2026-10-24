# 04｜让 Skills 回到 Pi，JQ 只做预制与加载

Agent Engineering / oh-my-quant · 初稿 2026-10-12 · 修订 2026-10-16 · 精选工具与极简接入

用户想分析一张周线图，应该能够选中技能、提供图片并开始研究。寻找仓库、安装文件、配置数据源这些准备工作，可以由产品提供清晰入口；技能自己的工作流则应随上游演进。

## 从研究任务找到工具

JQ 将常用工具组织成三个入口。行情、因子、回测和风险分析使用内置工具；研究方法从预制 Skills 中选择；额外数据和网页服务从 MCP 预制目录进入。

| 研究需要 | 入口 | 已经准备好的部分 |
|---|---|---|
| 行情与量化计算 | `/config → Market Data` | 数据适配器、凭证填写、样本检查与保存 |
| 公司、宏观、组合与风险研究 | LLMQuant 的五个默认技能 | 仓库与版本、下载入口、模型加载 |
| 图表、广度、仓位与市场环境 | Claude Trading Skills 的五个默认技能 | 同样的一键下载与加载流程 |
| 扩展数据与网页资料 | 五项 MCP 的可选配置 | 官方链接、按需添加与移除、配置导出 |

在 JQ 中执行 `/skill install`，先看可选清单，再用 `/skill install technical-analyst llmquant-risk` 选择所需技能。`/skill remove technical-analyst` 从加载列表移除，保留共享源码与本地修改，需要时可再次启用。随后 `/skill` 查看，`/skill info technical-analyst` 查看路径和说明，提供周线图后调用对应技能。依赖与输入要求由上游 `SKILL.md` 解释，JQ 不再额外维护另一份执行规范。[预制目录与使用步骤](../quant-harness/community-tools.md#toolkit)

相较于自行搜索、安装和拼接工具，这套入口把选型与接入方法提前整理好。它的价值是减少重复准备工作，让用户主要补充自己的凭证、环境与研究输入；实际配置耗时仍需通过任务测量验证。

## 为什么撤掉逐技能检查层

早期实现为每个精选技能记录模式要求、文件哈希、Python 版本、包导入与网络观察，并据此生成 blocked 或 needs-input 等状态。这些检查曾帮助定位具体故障，例如包已安装但无法导入，或者上游报告里的来源标签和实际数据源不一致。

<a id="readiness"></a>

代价也随之扩大。每次上游修改工作流或脚本，JQ 都需要重新维护清单、检查代码、会话策略和专用审计。一个原本只是下载并加载 Markdown 的入口，逐渐承担了第三方软件的运行资格管理。

2026-10-16 的收敛将这部分职责交回上游：删除逐技能探测、固定文件认证和专用报告审计，保留仓库预制与下载。提交号继续用于可重复安装，不再被解释为当前环境或研究结果的认证。

安装失败、用户本地改动和取消仍需由下载入口正确处理，因为这是 JQ 自己执行的文件操作。Python、MCP、数据权限与脚本结果则在实际工作流中处理。这个边界让维护工作跟随 JQ 自身的行为。

## 复用 Pi 的加载能力

Pi Coding Agent 提供 `loadSkills`、`loadSkillsFromDir`、`parseFrontmatter` 和 `formatSkillsForPrompt`。JQ 直接调用这些函数完成扫描、按文件加载、元数据解析、忽略规则和模型索引，删掉原来本地复制的技能加载器与格式化实现。版本随 [package.json](../../package.json) 锁定；一个[集中适配文件](../../src/agent/src/pi-skills.ts)导入包内对应模块，避免 SDK 总入口带入整套应用。升级时需要验证这些内部路径，独立的 Bun / Node 打包测试覆盖加载行为。

![工具在宿主与任务范围内使用，技能提供工作流指令；技能文件可加载不代表外部服务已经可用。](./images/04-capabilities.svg)

*图 4：宿主和任务仍约束工具调用。JQ 负责下载和会话接线，Pi 负责加载，技能依赖遵循上游说明。*

JQ 的薄适配保留目录选择、来源信息和正文快照。新安装或 `/skill reload` 使发现缓存失效，空闲会话在下一次独立请求读取新内容；在途研究与排队续问保留原快照。

Pi 的显式技能命令展开器目前没有独立公开入口，JQ 因而保留一个小的正文包装函数，将已加载内容交给现有会话。这部分只连接技能与会话，不解释特定技能的业务规则。[加载与快照契约](../quant-harness/community-tools.md#discovery)

## 一键准备的实际边界

“近乎预内置”落实为预制目录和一个下载命令。启动应用不再后台下载仓库，用户选择名称后执行 `/skill install <name>`，只有显式 `--all` 才选择全部预制项。下载按共享仓库缓存，加载按技能选择；已有目录会保留，显式指定仓库才执行更新。用户改动不会被重置，失败也不会发布半套安装。

MCP 同样有清晰分工：Financial Datasets、Tushare、LLMQuant Data、智谱搜索与网页读取的介绍和配置统一放在 [Skills 与 MCP 指南](../quant-harness/community-tools.md#mcp)。用户用 `/mcp install <name>` 按需添加，`/mcp remove <name>` 移除，`/mcp export <name>` 取出模板。增删直接复用 Pi 的配置 API，默认维护其用户配置，`--local` 选择项目配置。同名已有配置保留。仓库不再维护 `.claude/mcp.json`，JQ 也不为这些服务实现另一套 MCP 客户端。引入 Pi 的 Skills SDK 不等于已经启动 Pi 的 MCP 会话。

技能可以加载，只说明指令可被消费。图片输入仍需模型支持，研究工具仍受任务范围约束，量化结论仍需真实输入和可核验计算。撤掉第三方技能认证以后，这些属于 JQ 本身的责任继续由各自模块负责。

## 实现索引

这次收缩尚未涵盖社区插件宿主。JQ 仍使用 WhyJ Extension API 1，Git 下载和选择文件也保留现有布局；进一步复用 Pi 的包管理、资源过滤和插件协议由 [#33](https://github.com/yangjingo/oh-my-quant/issues/33)跟进，不能从 Skills API 复用推导为 Pi 插件已兼容。

- [MCP 预制配置](../../src/runtime/skills/mcp-presets.ts)、[Pi 配置接线](../../src/runtime/skills/mcp-config.ts)。
- [预制目录](../../src/skill/catalog.ts)、[下载事务](../../src/skill/installer.ts)、[安装与加载入口](../../src/cli/handlers/skill.ts)。
- [Pi 技能适配](../../src/agent/src/skills.ts)、[提示词格式化适配](../../src/agent/src/session-runtime/harness/system-prompt.ts)。
- [会话刷新回归](../../src/agent/test/session-dependencies.test.ts)、[图片会话回归](../../src/agent/test/chart-image-session.test.ts)、[量化任务守卫](../../src/runtime/quant-harness.ts)。

[← 上一篇](./03-context-as-projection.md) · [下一篇：测试全绿，为什么仍然不能交付一个结论 →](./05-evaluation-beyond-green.md)
