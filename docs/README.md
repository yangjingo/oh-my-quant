# oh-my-quant 文档

从读者的问题进入：产品定义说明做什么，设计文档解释为什么这样划分，博客讨论判断如何形成，运行证据留在 PR 与 CI。当前源码、已发布软件和线上网站是不同状态。

<a id="design"></a>

## 主题只保留一个当前入口

| 问题 | 入口 |
| --- | --- |
| 产品形态与 Quant 核心价值 | [PRD](./prd.md) |
| 两种入口如何共享执行与状态 | [模块架构](./agent-runtime/architecture.md) |
| 工程检查、分支保护与软件发布 | [CI 与发布](./ci-release.md) |
| 因子基线、公开 Benchmark 与研究方法 | [量化评测](./evaluation/README.md) |
| 文章怎样进入网站 | [博客发布流程](./blog/website-publishing.md) |
| 运行与交互入口 | [首页帮助](../README.md#commands) · [讲解演示](./slides.html) |

Desktop 面向 Windows/macOS，CLI/TUI 面向 Linux 专业用户；Web 是共享界面与开发入口，不是第三种产品。目标平台不等于已交付支持，实际范围以相应产品说明和发布验收为准。

<a id="agent-design"></a>

## Agent Runtime：运行机制与持久化

| 文档 | 责任 |
| --- | --- |
| [Agent Runtime](./agent-runtime/README.md) | 会话、资源快照、取消与恢复 |
| [WhyJ Quant 模块架构](./agent-runtime/architecture.md) | 入口、共享服务与 Host 边界 |
| [存储](./agent-runtime/storage.md) | 提交点、缓存、不可变历史与私有状态 |
| [Quant 配置](./agent-runtime/configuration.md) | Quant 数据、组合、报告与引擎设置 |
| [扩展宿主](./agent-runtime/extensions.md) | 显式扩展、启停与资源修订 |

<a id="quant-harness-design"></a>
<a id="product"></a>

## Quant Harness：研究与交付边界

| 文档 | 责任 |
| --- | --- |
| [Quant Harness](./quant-harness/README.md) | 研究范围、证据与完成条件 |
| [数据源](./quant-harness/source-data-providers.md) | 来源、回退、覆盖与数据版本 |
| [量化工具](./quant-harness/quant-tools-design.md) | 计算方法、单位与结果核验 |
| [Community Tools](./quant-harness/community-tools.md) | Skills 与 MCP 的接入责任 |
| [组合比较](./quant-harness/portfolio-comparison.md) | 日期、币种与权重的可比性 |
| [新闻研究](./quant-harness/news-research.md) | 报道、正文与价格解释的边界 |
| [Alpha 回测](./quant-harness/alpha-backtest.md) | 引擎假设与独立账本核对 |
| [账户业绩](./quant-harness/performance.md) | 账户历史、现金流与收益口径 |
| [执行](./quant-harness/execution.md) | 授权、订单与不确定结果对账 |
| [报告与制品](./quant-harness/artifacts-design.md) | 固定报告、恢复与分享 |
| [年度报告](./quant-harness/annual-reports.md) | 年度范围、研究决策与私有输出 |
| [UI/UX](./quant-harness/uiux.md) | 输入、渐进状态与可恢复交互 |
| [Web UI 设计草案](./quant-harness/web-ui.md) | #84 分区布局与独立原型，作为 #81 / #50 的设计输入 |

<a id="reference"></a>
<a id="validation"></a>

## 文档怎样保持可读

设计正文解释问题、结构、接口边界、取舍及必要的证据限制；命令参数由应用帮助或源码维护。配置与发布指南保留完成任务所需的操作，不复制实现细节或逐轮通过数。

每页以 5–10 分钟阅读为目标，复杂中文设计通常约 2,000–3,000 字，不凑字数。PRD 的 3,000 字及已纳入检查的产品/架构页 5,000 字上限继续有效。论文评测独立维护，历史博客也不因文档简化而自动删除。

新增内容先更新对应责任页。只有独立读者问题才拆新页，不再建立修复账、重复规范或旧稿归档层。合并需保留独有约束，并更新引用与生成页；删除旧路径可能影响外部链接，Git 历史不等于旧 URL 兼容。

<a id="essays"></a>

## 博客与阅读工具

[系列导览](./blog/README.md)组织阅读顺序，[编辑约定](./blog/editorial-notes.md)维护证据边界。以下文章解释历史判断，不替代当前设计契约。Repo Ops 原稿继续保留，清理须等待内容确认。

- [01｜我们为什么保留自己的 Harness，却不再维护模型协议](./blog/01-own-the-harness.md)
- [02｜一次数据源故障，为什么需要三种成功定义](./blog/02-data-contracts.md)
- [03｜压缩对话之后，研究事实从哪里回来](./blog/03-context-as-projection.md)
- [04｜让 Skills 回到 Pi，JQ 只做预制与加载](./blog/04-capability-and-skills.md)
- [05｜测试全绿，为什么仍然不能交付一个结论](./blog/05-evaluation-beyond-green.md)
- [06｜终端为什么也是一个一致性系统](./blog/06-terminal-consistency.md)
- [07｜报告要固定，设计要演进：我们保留什么、淘汰什么](./blog/07-artifacts-and-boundaries.md)
- [08｜换一个入口，如何继续同一份研究？](./blog/08-research-workbench.md)
- [10｜80×24 的屏幕里，什么值得一直留下？](./blog/10-layout-and-visual-language.md)
- [11｜用户不知道下一条命令时，界面应该做什么？](./blog/11-discoverable-interactions.md)
- [12｜错误出现以后，用户还能做什么？](./blog/12-recovery-as-ux.md)
- [给 Agent 做桌面，先想清楚关窗之后](./blog/agentic/agent-desktop-lifecycle.html)（架构提案，未实施）
- [编辑与证据说明](./blog/editorial-notes.md)
- [Agent Engineering：oh-my-quant 的产品、架构与体验](./blog/README.md)
- [博客更新与 Vercel 发布流程](./blog/website-publishing.md)
- [Agentic / Vibe Repo Ops：代码变快以后，怎样把一次交付做完整](./blog/agentic/vibe-repo-ops-merged-draft.md)
- [Agentic / Vibe Repo Ops：让 AGENTS.md、Skills 与 CI 对同一次交付负责](./blog/agentic/vibe-repo-ops.md)

离线内容由 [build.ts](./blog/build.ts)生成 [index.html](./blog/index.html)；[check.ts](./blog/check.ts)核对目录、链接与生成物，[evidence-path.ts](./blog/evidence-path.ts)区分可选私有回执。运行 `bun run docs:build` 与 `bun run check:docs`，但不据此声称网站已发布或历史证据已重新验证。

<a id="assets"></a>

## 素材目录

品牌、产品素材和正式插图可以入库；验收截图、录屏与浏览器输出通过附件或 CI artifact 提供。官网工作台预览归属 [site/public](../site/public/workspace-preview.png)，展示合成数据，不是实际行情或运行验收证明；不在 docs/assets 保留网站截图。视觉规则由 [DESIGN](../DESIGN.md)维护，不在目录复制色表。

**品牌与产品**：[app-icon.ico](./assets/app-icon.ico) · [app-icon.svg](./assets/app-icon.svg) · [geist-license.txt](./assets/geist-license.txt) · [index.html](./assets/index.html) · [logo-lockup-dark.svg](./assets/logo-lockup-dark.svg) · [logo-lockup-light.svg](./assets/logo-lockup-light.svg) · [logo-lockup-mono.svg](./assets/logo-lockup-mono.svg) · [logo-mark-mono.svg](./assets/logo-mark-mono.svg) · [logo-mark.svg](./assets/logo-mark.svg) · [logo-wordmark.svg](./assets/logo-wordmark.svg)

**图标尺寸**：[1024x1024.png](./assets/icons/1024x1024.png) · [128x128.png](./assets/icons/128x128.png) · [16x16.png](./assets/icons/16x16.png) · [24x24.png](./assets/icons/24x24.png) · [256x256.png](./assets/icons/256x256.png) · [32x32.png](./assets/icons/32x32.png) · [48x48.png](./assets/icons/48x48.png) · [512x512.png](./assets/icons/512x512.png) · [64x64.png](./assets/icons/64x64.png)

**系列机制图**：[01-harness.svg](./blog/images/01-harness.svg) · [02-data.svg](./blog/images/02-data.svg) · [03-context.svg](./blog/images/03-context.svg) · [04-capabilities.svg](./blog/images/04-capabilities.svg) · [05-evaluation.svg](./blog/images/05-evaluation.svg) · [06-terminal.svg](./blog/images/06-terminal.svg) · [07-artifacts.svg](./blog/images/07-artifacts.svg) · [08-workbench.svg](./blog/images/08-workbench.svg) · [10-layout.svg](./blog/images/10-layout.svg) · [11-discovery.svg](./blog/images/11-discovery.svg) · [12-recovery.svg](./blog/images/12-recovery.svg)

**Repo Ops 插图与变体**：[repo-ops-actions.svg](./blog/agentic/images/repo-ops-actions.svg) · [repo-ops-artifacts-mobile.svg](./blog/agentic/images/repo-ops-artifacts-mobile.svg) · [repo-ops-artifacts.svg](./blog/agentic/images/repo-ops-artifacts.svg) · [repo-ops-evidence-mobile.svg](./blog/agentic/images/repo-ops-evidence-mobile.svg) · [repo-ops-evidence.svg](./blog/agentic/images/repo-ops-evidence.svg) · [repo-ops-governance-mobile.svg](./blog/agentic/images/repo-ops-governance-mobile.svg) · [repo-ops-governance.svg](./blog/agentic/images/repo-ops-governance.svg) · [repo-ops-jq-evidence.png](./blog/agentic/images/repo-ops-jq-evidence.png) · [repo-ops-jq-trust.png](./blog/agentic/images/repo-ops-jq-trust.png) · [repo-ops-merge-flow-mobile.svg](./blog/agentic/images/repo-ops-merge-flow-mobile.svg) · [repo-ops-merge-flow.svg](./blog/agentic/images/repo-ops-merge-flow.svg) · [repo-ops-rsi.svg](./blog/agentic/images/repo-ops-rsi.svg)

<a id="website-content"></a>

## 网站复用内容，不复制规范

产品介绍复用 PRD 与首页，Docs 按设计问题组织，Blog 复用稿件，用户手册围绕完成任务，Demo 说明演示范围。规划栏目不代表已有发布路由，具体接入由 [site](../site/README.md)维护。

发布只使用显式白名单，不上传整个仓库、私有会话、账户数据或凭证。链接和图片不能代替部署验收；新增文章与译文先建立真实路由，再声明可访问。

[本页](./README.md) · [项目首页](../README.md) · [变更记录](../CHANGELOG.md) · [投资笔记](../notes/README.md)
