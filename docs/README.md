# oh-my-quant 文档

更新：2026-10-14。现行文档实际归入两个目录：[Agent Runtime](./agent-runtime/README.md) 与 [Quant Harness](./quant-harness/README.md)。Agent 说明通用运行机制；Quant Harness 说明围绕 Agent 构建的完整量化应用，包括数据、计算、执行、报告、UI/UX 和使用验证。博客保留真实取舍与反思，不另建旧稿归档层。

## 从问题进入

| 你想了解 | 从这里开始 |
|---|---|
| 模型/工具循环、会话、取消、压缩与扩展 | [Agent Runtime 设计](./agent-runtime/README.md) |
| 量化应用如何把数据、计算、研究与交互连接起来 | [Quant Harness 总览](./quant-harness/README.md) |
| 首次配置、完成研究与恢复报告 | [用户手册](./quant-harness/user-guide.md) · [演示](./slides.html) |
| 当前范围、缺口与实施顺序 | [GOALS](./quant-harness/GOALS.md) → [PRD](./quant-harness/PRD.md) → [Roadmap](./quant-harness/roadmap.md) |
| 配置、数据源与工具为何不同步 | [配置](./quant-harness/configuration.md) → [数据源](./quant-harness/source-data-providers.md) → [UI/UX](./quant-harness/quant-uiux.md) |
| 怎样验证，哪些结论尚未得到证明 | [评测指南](./quant-harness/evaluation.md) · [测试与反例](./blog/05-evaluation-beyond-green.md) |
| 产品、架构与 UI/UX 的选择理由 | [技术博客](./blog/README.md) · [离线版](./blog/index.html) |

当前工作区不等于发布版。产品完成度由 PRD 维护；代码和测试链接定位可重复检查，不把旧验证记成本轮成绩。这里的“归档整理”是把现行文档归入责任目录，不恢复 archive、旧稿汇编或重定向页面。

<a id="design"></a>

## 两个实体目录，而不只是两组标题

```text
docs/
├── README.md                 总导航
├── agent-runtime/
│   ├── README.md             通用 Agent 运行时设计
│   └── extensions.md         通用扩展宿主
├── quant-harness/
│   ├── README.md             量化应用总览与研究编排核心
│   └── …                     产品、数据、计算、执行、报告、UI/UX、手册与评测
├── blog/                     工程叙事与配图
├── assets/                   共用素材
└── slides.html               讲解演示
```

Quant Harness 是应用范围，不是某一个同名源文件的范围。`src/runtime/quant-harness.ts` 实现其中的任务装配与守卫；Source、Quant、Storage、Execution、Artifact 和 UI/UX 是这一应用体系内职责不同的组成部分。归入同一目录不抹平模块边界，不表示执行能力已经接入默认研究 Agent，也不放宽账户授权。

当前共 **63 个文件**：40 份 Markdown、2 份 HTML、3 个 TypeScript、5 张 PNG、13 张 SVG。23 份原顶层文档已迁入两个目录；桌面宿主设计也归入 Quant Harness。顶层 Markdown 只保留本页。

| 位置 | 文件数 | 内容 |
|---|---:|---|
| `agent-runtime/` | 2 | 通用运行时与扩展契约 |
| `quant-harness/` | 23 | 完整量化应用的设计、产品与使用文档 |
| `blog/` | 30 | 12 篇正文、目录与编辑说明、12 张 SVG、构建/检查脚本、私有证据路径规则和离线 HTML |
| `assets/` | 6 | 共用产品与设计素材 |
| 顶层 | 2 | 本页和讲解演示 |

<a id="agent-design"></a>

## Agent Runtime：通用运行机制

| 文档 | 唯一职责 |
|---|---|
| [运行时设计](./agent-runtime/README.md) | Pi 适配、宿主依赖、连接快照、队列、取消、会话树、提交、压缩与分支导航 |
| [扩展宿主](./agent-runtime/extensions.md) | WhyJ Extension API、显式加载、启停与资源修订；不等同 Pi 原生 ExtensionAPI |

这一层说明可供不同任务复用的机制，不决定量化指标或研究完成度。产品中的模型设置、OAuth、Pi 导入与诊断统一由 Quant Harness 的配置文档维护，Agent 通过链接引用，不复制第二套字段表。

<a id="quant-harness-design"></a>

## Quant Harness：完整量化应用

本目录包括产品目标、系统设计、领域能力和用户工作流；以下分组全部属于 Quant Harness，不再与它并列为第三种设计体系。

<a id="product"></a>

### 产品目标与系统骨架

| 文档 | 唯一职责 |
|---|---|
| [总览与研究编排](./quant-harness/README.md) | 完整应用的阅读入口，以及任务、范围守卫、证据、接受条件与研究恢复 |
| [GOALS](./quant-harness/GOALS.md) | 产品目标、原始需求与非目标 |
| [PRD](./quant-harness/PRD.md) | 当前状态、缺口与验收条件 |
| [Roadmap](./quant-harness/roadmap.md) | 实施顺序，不复制完成度 |
| [模块架构](./quant-harness/module-architecture.md) | 应用模块、依赖方向、公共入口与 runtime 组装 |
| [存储策略](./quant-harness/ohquant-storage-policy.md) | 应用文件布局、设置、会话、缓存、不可变归档与私有状态 |

### 数据、计算、能力与执行

| 文档 | 唯一职责 |
|---|---|
| [数据源](./quant-harness/source-data-providers.md) | provider、凭证、回退、归档与研究数据的来源/时间边界 |
| [工具与计算](./quant-harness/quant-tools-design.md) | 注册/能力、参数、账本、因子与价量计算 |
| [研究技能](./quant-harness/trader-skills.md) | 安装、发现、资格、依赖观察与已给材料模式；第三方功能只引用上游 |
| [组合比较](./quant-harness/portfolio-comparison.md) | 权重、币种、同日对齐与历史重算 |
| [新闻研究](./quant-harness/news-research.md) | 来源/时间、正文与标题初筛、价格窗口及解释边界 |
| [账户业绩](./quant-harness/performance.md) | 规范化账户历史、现金流与区间绩效；不代表真实券商接通 |
| [Alpha 回测](./quant-harness/alpha-backtest.md) | AKQuant、固定输入、成交/净值核对与归档 |
| [执行](./quant-harness/execution.md) | 订单端口、授权、预检与幂等；研究完成不授权交易 |

### 报告与 UI/UX

| 文档 | 唯一职责 |
|---|---|
| [报告与制品](./quant-harness/artifacts-design.md) | 固定报告版本、来源核验、恢复入口与分享白名单 |
| [年度报告](./quant-harness/annual-reports.md) | 年度/YTD、组合版本、观点来源与私有导出 |
| [UI/UX](./quant-harness/quant-uiux.md) | 工作台、布局、队列投影、异步状态与文本渲染；视觉真源为根 [DESIGN](../DESIGN.md) |
| [Windows 桌面宿主](./quant-harness/desktop.md) | Electron/ConPTY、随包运行时、数据目录、构建与安装验收 |
| [Web 研究工作台](./quant-harness/research-workspace.md) | 本地对话入口、真实取证与计算、引用、保存和独立复核的首个任务 |

<a id="reference"></a>

### 配置、使用与评测

| 文档 | 唯一职责 |
|---|---|
| [配置参考](./quant-harness/configuration.md) | 模型/数据设置、OAuth、Pi 导入、优先级、保存冲突与诊断 |
| [用户手册](./quant-harness/user-guide.md) | 首次配置、研究、报告恢复、排错与本地 Demo 路线 |
| [命令参考](./quant-harness/slash-commands.md) | 一级命令、参数、TUI 与非 TUI 行为 |
| [评测指南](./quant-harness/evaluation.md) | 研究/技能评测、数据测量、模型延迟与 HUD；区分自动门槛和人工审阅 |

<a id="validation"></a>
## 规则、反思与运行证据分开

现行主题回答“现在如何工作”；博客回答“为什么改、改后仍有什么问题”。旧失败不因离线重检通过就变成一次新模型成功，错误数字也不回写成正确答案。

源码和测试链接定位可重复检查，不替代真实服务回执。内部 `output/` 保留原始运行材料；当前文档中的带日期数字只描述原观察，本轮未重新运行产品验证。旧汇编已删除，完整逐次历史不再由 Docs 保证；选入博客的案例保留必要输入、错误、修正和限制。

<a id="essays"></a>
## 技术博客

面向技术负责人，解释产品、技术架构与 UI/UX 的真实取舍。正文负责叙述问题与反思，具体接口回到设计文档，完成度回到 PRD。每篇配图在「配图素材」中单独登记。

| 正文 | 主问题 | 视角 |
|---|---|---|
| [01 · 保留自己的 Harness，不再维护模型协议](./blog/01-own-the-harness.md) | 协议复用以后，谁拥有研究状态？ | 技术架构 |
| [02 · 一次故障，三种成功定义](./blog/02-data-contracts.md) | 保存、能力与实际请求为什么不能混为一谈？ | 数据架构 / 产品信任 |
| [03 · 压缩对话后，研究事实从哪里回来](./blog/03-context-as-projection.md) | 有损摘要如何与可核验事实共存？ | 上下文 / 状态恢复 |
| [04 · 工具和 Skill 越多就越强吗](./blog/04-capability-and-skills.md) | 当前能做什么、允许做什么？ | 能力架构 |
| [05 · 测试全绿，为什么仍不能交付结论](./blog/05-evaluation-beyond-green.md) | 哪种验证支持哪种声明？ | 工程验证 |
| [06 · 终端也是一个一致性系统](./blog/06-terminal-consistency.md) | 迟到数据和旧画面由谁负责？ | 技术架构 / UI 状态 |
| [07 · 报告要固定，设计要演进](./blog/07-artifacts-and-boundaries.md) | 哪些事实要保留，哪些设计可以淘汰？ | 产物 / 演进治理 |
| [08 · 研究终端不能只是聊天框](./blog/08-research-workbench.md) | 如何支持一次提问之外的完整研究？ | 产品设计 |
| [09 · 模块拆开后，为什么还要 Runtime](./blog/09-boundaries-for-change.md) | 变化应当停在哪一个边界？ | 技术架构 |
| [10 · 80×24 的屏幕里，什么值得留下](./blog/10-layout-and-visual-language.md) | 空间不足时怎样分配注意力？ | UI 布局 / 视觉语义 |
| [11 · 不知道下一条命令时](./blog/11-discoverable-interactions.md) | 能力如何被发现，又不误执行？ | UX / 功能发现 |
| [12 · 错误出现以后还能做什么](./blog/12-recovery-as-ux.md) | 如何理解失败、保住工作并继续？ | UX / 失败恢复 |


<a id="research-presentation"></a>
## 演示

[slides.html](./slides.html) 是 12 页讲解演示，使用当前渲染器的合成快照，不连接模型、行情或账户。旧 Pi/量化生态目录已删除，不能根据调研材料声称某个外部包已安装或集成。

<a id="publishing"></a>
## 导航与构建

| 文件 | 维护方式 |
|---|---|
| [README.md](./README.md) | 本页只登记现行入口和内容职责 |
| [blog/README.md](./blog/README.md) | 系列阅读路径与写作约定 |
| [blog/editorial-notes.md](./blog/editorial-notes.md) | 当前编辑约定、来源与证据边界，不保存整理流水 |
| [blog/build.ts](./blog/build.ts) | 从 Markdown/SVG 重建离线图文版 |
| [blog/check.ts](./blog/check.ts) | 文件覆盖、链接、锚点及生成物检查 |
| [blog/evidence-path.ts](./blog/evidence-path.ts) | 区分必须存在的公开文件与可选的本地私有回执；缺少回执不代表证据通过 |
| [blog/index.html](./blog/index.html) | 生成物，不维护第二套正文 |

<a id="assets"></a>
## 配图素材

### 公共视觉素材（6）

这些素材不是独立的设计规范或运行证明。无正文引用只能作为使用情况线索，不能单独作为删除依据。

| 文件 | 内容与用途 | 定位 |
|---|---|---|
| [assets/website-workspace.png](./assets/website-workspace.png) | 网站研究工作台演示，含市场研究、组合比较、报告入口及 Synthetic data 标记 | 当前英文 README 使用；合成演示素材，不证明真实模型、行情或网站部署状态 |
| [assets/terminal-renderer-2026-10-13.png](./assets/terminal-renderer-2026-10-13.png) | 当前 QuantTui 的 120×32 缓冲区投影，默认 red-up | 讲解演示使用；隔离合成输入，非真实行情/模型回答或实体终端证明 |
| [assets/terminal.png](./assets/terminal.png) | 早期终端首页视觉参考 | 保留 GOALS / PRD 的设计来源；已退出项目首页和演示，不作为当前界面截图 |
| [assets/image.png](./assets/image.png) | 另一版终端画面参考，含 Portfolio / Watchlist / Market | 保留素材；本轮分类前未在 docs、项目 README、DESIGN 的文本引用中找到入口 |
| [assets/logo.png](./assets/logo.png) | 羽毛、柱形图与 WhyJ Quant 字标 | 品牌素材，同上范围未发现原入口 |
| [assets/poste.svg](./assets/poste.svg) | 1200×1700 SVG 版面素材 | 展示素材，同上范围未发现原入口；不从文件名推断其发布或验收状态 |

### 博客机制图（12）

本地 SVG 解释机制、流程或布局优先级，不是实测性能图或真实终端截图。

| 文件 | 对应内容 |
|---|---|
| [blog/images/01-harness.svg](./blog/images/01-harness.svg) | 01：协议内核与领域 Harness 的责任 |
| [blog/images/02-data.svg](./blog/images/02-data.svg) | 02：配置、能力与请求结果 |
| [blog/images/03-context.svg](./blog/images/03-context.svg) | 03：摘要与研究事实投影 |
| [blog/images/04-capabilities.svg](./blog/images/04-capabilities.svg) | 04：能力清单与运行资格 |
| [blog/images/05-evaluation.svg](./blog/images/05-evaluation.svg) | 05：验证层次与证据边界 |
| [blog/images/06-terminal.svg](./blog/images/06-terminal.svg) | 06：异步刷新与界面一致性 |
| [blog/images/07-artifacts.svg](./blog/images/07-artifacts.svg) | 07：固定报告与设计演进 |
| [blog/images/08-workbench.svg](./blog/images/08-workbench.svg) | 08：可接续的研究工作流 |
| [blog/images/09-boundaries.svg](./blog/images/09-boundaries.svg) | 09：模块依赖与组装边界 |
| [blog/images/10-layout.svg](./blog/images/10-layout.svg) | 10：屏幕空间与信息层级 |
| [blog/images/11-discovery.svg](./blog/images/11-discovery.svg) | 11：命令发现与确定性入口 |
| [blog/images/12-recovery.svg](./blog/images/12-recovery.svg) | 12：失败后的诊断与继续路径 |


<a id="website-content"></a>
## 面向产品网站的内容分工

用户已明确未来网站包含产品介绍、Docs、Blog、用户手册和 Demo。本页规定内容所有权；站点实现与部署状态由 `site/` 自身交付记录维护，本轮只整理文档。站点层负责导航、搜索和阅读体验，产品行为仍以仓库正文为依据，避免复制五套会漂移的规范。

| 网站栏目 | 栏目路径示意 | 复用内容 | 发布边界 |
|---|---|---|---|
| 产品介绍 | `/` | 根英文 README、产品目标、当前演示 | 描述价值与适用范围，区分工作区与发布版 |
| Docs | `/docs/` | 本目录、架构、契约、配置和命令参考 | 按开发者问题组织；审计与实施记录单独标日期，不全部铺成入门导航 |
| Blog | `/blog/` | 十二篇 Markdown、对应 SVG、编辑元数据 | 保留中文叙事、修订日期、来源与限制 |
| 用户手册 | `/guide/` | user-guide 的任务流程，链接配置和命令正文 | 以完成一次工作为中心，不把架构说明换标题当手册 |
| Demo | `/demo/` | 当前 slides、本地演示路线及新渲染快照 | 现阶段是讲解与操作路线；后续录屏/合成交互/真实服务分别标注，不承诺在线终端 |

发布只采用显式内容与资产白名单，不把整个仓库、`output/`、`.ohquant/`、完整研究会话、私有报告或凭证打包上线。指向本地测试与输出的证据链接需要转换为可公开的说明或保留在仓库，不制造站点死链。演示与帮助是否离线、会否调用服务及产生用量，都应在入口说明。

终端讲解配图由 [现有渲染脚本](../src/tui/dev/render-terminal-audit.ts)生成：使用隔离内存数据，得到 SVG 字符单元与 ANSI 输出，再在浏览器捕获 `120x32-research-red-up` 帧。它展示绘制逻辑，不证明宿主字体、输入法或真实市场研究。项目首页另使用上表的网站合成工作台素材；图片和链接不能代替部署或在线服务验收，本轮不判断站点交付状态。


## 后续不再按每次修复新增顶层文档

现行主题只保留一个责任入口。新规则修改对应契约；有解释力的反例与取舍更新对应博客；一次运行保存结构化回执，注明日期、输入、版本、失败与未验证项。只有出现独立生命周期或明确读者任务才拆新页，不为每个补丁建立永久文档或归档。

合并前核对独有约束，只迁移仍有价值的判断，不逐字复制旧稿。旧入口不保留空跳转壳，外部旧 URL 不保证兼容。未入库文档不能承诺 Git 可以恢复，仓库外临时副本也不是永久历史。`output/` 不因被文档引用就成为默认公开内容。

~~~powershell
bun run docs/blog/build.ts
bun run docs/blog/check.ts
~~~

覆盖检查以本页为完整目录，新增文件必须归到一处责任目录，并禁止重新引入淘汰的归档层、独立决策账和已合并专题页。本次检查不调用真实模型或市场，不改变产品完成度。

仓库外层入口：[项目首页](../README.md) · [变更记录](../CHANGELOG.md) · [视觉规范](../DESIGN.md) · [投资笔记](../notes/README.md)。模块指南：[Agent](../src/agent/README.md) · [Source](../src/source/README.md) · [Storage](../src/storage/README.md) · [Artifact](../src/artifact/README.md) · [TUI](../src/tui/README.md)。
