# WhyJ Quant 产品与使用指南

更新：2026-10-21。本文统一维护产品目标、需求边界、用户流程和命令参考，替代原 GOALS、PRD、user-guide 与 slash-commands。整理以 `main@f254bb4` 为初始依据，并同步 `main@620c02c` 的设计参考更新；本次合并不重新验收真实模型、数据供应商或账户，也不代表 npm 已发布相同功能。安装版先用 `whyj --version` 确认。

- [产品范围与已确认选择](#scope)
- [需求与验收边界：F01–F27](#requirements)
- [从配置到一次可恢复的研究](#workflow)
- [Slash 命令与 Shell 入口](#commands)
- [文档维护与历史证据](#maintenance)

<a id="scope"></a>

## 产品范围与已确认选择

WhyJ Quant 面向个人量化研究者，围绕自定义观察组合完成“配置 → 获取数据 → 分析与比较 → 报告 → 恢复”。产品价值来自数据可解释、计算可核验、研究可延续，以及模块可替换。GOAL1 对应研究体验与业务能力（F01–F16）；GOAL2 对应 Harness、扩展、上下文和持久化（F17–F24）；F25 保留早期 Alpha/AKQuant 引擎需求，F26/F27 负责文档与项目表达。

当前入口包括 CLI/TUI、[Electron 终端宿主](./desktop.md)、[本地 Web 研究工作台](./research-workspace.md)及产品网站。网站与 Blog 已有发布流程和记录，见[网站发布指南](../blog/website-publishing.md)。网站展示、浏览器工作台和桌面宿主的能力不能相互代替；后续 Electron 工作台与前端迁移按[架构拆分计划 #29](https://github.com/yangjingo/oh-my-quant/issues/29)推进，计划不等于已交付。

Portfolio 指代码、instrument 和分组组成的观察组合，不包含券商账户、真实数量、成本或现金。公开基金披露也不是个人持仓。默认研究 Agent 不提供下单工具；执行接入必须满足独立契约与授权。

以下选择已由维护者确认，不再列作待决策问题：

- Pi 复用配置、模型和技能加载；API-key 快照与选定 OAuth 链接的范围见[配置契约](./configuration.md#pi-import)。真实账号轮换及原生 ExtensionAPI 兼容仍独立验收。
- 原需求 `yhoo` 暂按 Yahoo 理解，但 Yahoo 不是强制新闻源；可搜索 Yahoo、同花顺、中金、彭博等来源，仍须标明原文、时间和引用边界。
- 视觉以 [DESIGN](../../DESIGN.md) 为准，参考选定的 [workspace-design-reference.png](../assets/workspace-design-reference.png)，仅取其暖黑、奶油白与金色方向，旧 Logo、布局和示例数据不作为当前产品预览；字体与大小需要一致设计。行情默认红涨绿跌，可切换绿涨红跌；品牌、强调、风险与操作状态各有语义，不以金色表示盈利。
- Slash 的研究语境可以覆盖系统动作，但保持 `/help`、`/config`、`/resume` 等入口可发现；计算工具不逐个增加一级命令。
- 年报同时考虑观察组合研究与真实账户业绩。个人数据必须显式提供并授权；优先复用合适的数据/MCP 接口不等于已获得账户访问权。
- F16 当前要求为“暂时留好文档和接口”。真实服务、市场、账户和允许订单范围另行选定，接口完成不授权实盘交易。

<a id="requirements"></a>

## 需求与验收边界

<a id="status"></a>

### 状态如何读取

下表沿用原 PRD 最后汇总的本地范围判定（F16 于 2026-10-13 复核，F23/F24 于 2026-10-16 收敛），并删除已撤销能力。它不是 2026-10-21 的全产品重验，也不据旧测试数推算完成百分比。“已完成”仅指该行限定的功能闭环；“部分完成”表示仍有目标或验收缺口。新增缺陷须保留失败证据，不能以过去通过覆盖现在失败。

每次提高状态必须同时有入口、实现、成功/缺输入/空结果/失败/取消行为，以及对应版本的验证。外部服务另记 provider、市场、标的、窗口、权限和验证日期；模型解释需人工审阅。完整门槛与复跑方法见[评测指南](./evaluation.md)，实施切片见 [Roadmap](./roadmap.md)。

| ID | 目标与范围判定 | 验收边界、仍需验证的部分与现行契约 |
|---|---|---|
| F01 | Pi 模型配置与引导 · 部分完成 | Provider/模型选择、API-key、环境凭证、导入预览和取消须保留原设置；新请求切换连接且会话不丢失。选定 OAuth 链接已有实现，真实账号轮换、跨终端刷新和更多供应商兼容仍待验收。[配置](./configuration.md#oauth) |
| F02 | 数据与工具配置 · 已完成 | 选市场/来源、填写凭证、检查并保存同一草稿；覆盖缺依赖、401、权限不足、空数据、超时、取消和设置冲突。通过仅证明配置/诊断流程，不代表所有数据源可用。[配置](./configuration.md) |
| F03 | TTFT/TPOT 与上下文 HUD · 已完成 | 固定输入/模型/样本与统计口径，报告失败数和分位数，未测不显示零；恢复和切换连接不串指标。应用请求时延不等于供应商 SLA 或完整研究耗时。[性能测量](./evaluation.md#model-performance) |
| F04 | 终端视觉、字体与皮肤 · 部分完成 | 共享主题和多尺寸布局有回归；真实物理终端字体、中文宽度、输入法和全界面对照仍需复验。[UI/UX](./quant-uiux.md) |
| F05 | 日常研究布局 · 已完成 | 配置、组合编辑、分析/比较、自动报告与恢复构成连续键盘流程；小尺寸有收缩策略，获取中、陈旧、空结果、失败与局部成功分开显示。终端像素与输入法仍归 F04。[UI/UX](./quant-uiux.md) |
| F06 | 色彩、间隔与行情约定 · 已完成 | TUI、Overview 和报告消费统一语义；涨跌、风险、成功/失败、零值和缺失不能混用，数值保留符号或文字。视觉规范更新以 [DESIGN](../../DESIGN.md) 为准。 |
| F07 | Slash 简化与可发现性 · 已完成 | 名称/描述以 catalog 为真源；参数、空态、Tab、帮助及 TUI/非 TUI 行为一致。帮助和静态 schema 查询不执行目标操作；无效参数先拒绝。新增 `/mcp` 已纳入[命令参考](#commands)，不沿用旧命令数量。 |
| F08 | 可靠、分级、自动取数 · 部分完成 | market/symbol、窗口、实际来源、数据日期、抓取时间与 fresh/stale 可追溯；回退遵守市场身份、期限和取消，空/损坏响应不续 TTL。权限、交易日、复权、历史可得性及更多市场长期覆盖仍需验证。[数据源](./source-data-providers.md) |
| F09 | 自定义观察组合 · 已完成 | CLI/TUI 共用增删改、空组合、分组、标的身份及重启持久化；不推断个人头寸。[组合服务](../../src/runtime/research/portfolio.ts) |
| F10 | 组合比较 · 已完成 | 明确权重、基准、报价/计价币种、同日 FX 对齐和缺失策略；冻结 revision、支持只读历史重算与报告绑定，不用当前组替换旧输入。[组合比较](./portfolio-comparison.md) |
| F11 | 新闻、情绪与走势解释 · 部分完成 | 来源过滤、去重、正文指纹、原文引用与价格窗口已有实现；标题不足以支持方向性建议，网页指令不能成为宿主指令。真实新闻覆盖、情绪校准与完整解释质量仍待验收。[新闻研究](./news-research.md) |
| F12 | 因子、风险与针对性分析 · 部分完成 | 对象/日期/单位/方法和证据一致；已知错误算式、定义与越界解释应暴露并阻止错误完成声明。更多真实模型任务、跨场景解释及总体成功率尚未建立。[任务评测](./evaluation.md#tasks) |
| F13 | 回测与评分数值可信 · 已完成 | 人工账本与独立公式检查现金、股数、费用、复利年化、日期对齐和未定义比率；通过限显式假设的本地研究引擎，不证明交易收益。[计算契约](./quant-tools-design.md) |
| F14 | 自动 Artifact 与恢复 · 已完成 | 开启 Auto Artifacts 后仅对完整落盘的合格研究生成；浏览、固定版本恢复、缺档/损坏拒绝及分享过滤可复验。[报告](./artifacts-design.md) |
| F15 | 年度报告与观点来源 · 已完成 | 年度/YTD、组合版本、截止日、币种/基准、缺项及观点出处可追溯；研究、推演和私有账户导出分开，决策记录与行情/NAV/FX 哈希绑定。券商转换与模型普遍质量另验。[年报](./annual-reports.md) |
| F16 | 执行文档与接口 · 已完成 | 独立 ExecutionAdapter 覆盖账户、意图、预检、授权、订单、成交、查询、取消与不确定结果；paper/live 目标及幂等明确。真实账户/服务另行授权验收。[接口范围](./execution.md#2026-10-13f16-当前范围与接口验收) |
| F17 | 扩展结构与管理 · 已完成 | 当前为 WhyJ API 1 静态模块：manifest、重名/版本校验、启停/重载、取消、资源修订及诊断。不是 npm Pi ExtensionAPI 安装器，也不是恶意同进程代码沙箱。[扩展宿主](../agent-runtime/extensions.md) |
| F18 | 量化研究 Harness · 已完成 | 任务声明、范围、验收、重试、工具装配与证据绑定；缺输入、错误、取消和跨入口结果有明确状态。固定响应证明机制，不替代自然语言研究质量。[任务](./README.md#tasks) |
| F19 | 模块内聚与替换 · 已完成 | 模型、工具、skills、repo、prompt 和证据通过宿主端口注入；模块测试覆盖快照、失败恢复和报告分阶段处理。架构静态检查不等于插件安装或运行时沙箱。[依赖](../agent-runtime/README.md#dependencies) |
| F20 | 上下文、压缩与恢复 · 已完成 | 从活动分支原事件和不可变引用恢复对象、参数、核验与未完成项，不从有损摘要猜测；长历史、缺档、取消、多分支/会话隔离须保留。模型转述准确性仍归 F12/F24。[恢复](./README.md#research-state) |
| F21 | 持久化与数据及时性 · 部分完成 | 配置/组合并发、行情/NAV 修订、session 原子提交、报告输入与来源时间明确；空值不伪装为零，过期缓存不伪装 fresh。跨日、断电、长期服务及真实屏幕延迟仍需验证。[存储](./ohquant-storage-policy.md) |
| F22 | Portfolio 私有状态边界 · 已完成 | 观察组仅存公开标的元数据；不自动扫描旧持仓，仅显式 legacy import；个人金额/仓位/净值不进公开行情缓存。未来真实持仓必须另定私有状态契约。[存储](./ohquant-storage-policy.md) |
| F23 | 预制 Quant Skills · 部分完成 | 按名称下载、移除加载选择、Pi 扫描和 reload；保留共享文件与用户修改。启动自动安装和逐技能资格体系已撤销，依赖及工作流遵循上游，真实第三方执行仍逐项验证。[Skills](./trader-skills.md) |
| F24 | Tools/Skills 与 prompt 装配 · 部分完成 | Pi 生成技能索引，JQ 维护会话资源快照、研究工具范围和证据核验；名称/schema/能力一致、取消贯通、选用与任务匹配。工具数量不代表场景覆盖，完整解释质量另验。[工具](./quant-tools-design.md#registry)、[技能评测](./evaluation.md#skills) |
| F25 | Alpha/AKQuant 引擎 · 已完成 | 固定 Bars/DatasetRef、成本、日期和引擎版本；账本/净值独立复核，超时、异常、空结果、取消与缺档明确。默认工具、归档/报告/恢复限通用股票模拟，不覆盖真实交易规则。[Alpha](./alpha-backtest.md) |
| F26 | 文档合并与清理 · 持续维护 | 需求映射稳定 ID；产品、Harness 和 UI/UX 阅读入口清楚，独有约束进入现行契约，取舍写入博客。删除被替代页后更新链接与生成物，不再复制旧稿归档。 |
| F27 | 产品与技术演示 · 已有交付 | [slides.html](../slides.html)保留场景、技术选择、证据与规划的区别；键盘、窄屏、打印与来源可检查。旧演示或测试数字不自动变成最新产品验收。 |

配置、组合、数值和数据谱系是后续能力的基础：F10 依赖 F08/F13，F15 依赖 F08/F12/F20，扩展依赖 F18/F19 的宿主边界，执行依赖独立授权和 F21/F22 的私有状态。Roadmap 维护切片与依赖，不重复完成度；桌面与前端迁移另沿 #29 的实施问题跟踪。

<a id="workflow"></a>

## 从配置到一次可恢复的研究

以下以源码 CLI/TUI 为操作对象；Desktop 和 Web 工作台的启动、宿主边界与验收分别见各自文档。模型和数据请求可能产生额度消耗，回测和解释不保证未来收益。

### 启动与找到入口

在已有项目根目录、安装 Bun 后运行：

~~~powershell
bun install
bun run src/index.ts
~~~

使用已安装的 CLI 时运行 `whyj`。源码启动和已发布安装包是两种入口，不据此保证功能完全一致。所选数据源或 Skill 可能还需 Python、包版本、账号与接口权限，依赖不因启动成功而自动满足。

输入 `/help` 查看命令；`/help config`、`/portfolio --help` 查看具体用法。帮助查询不执行目标操作。TUI 面板通常使用方向键、Enter 和 Esc，具体按屏幕提示；详细键位以命令参考为准。

### 先把两类连接配好

#### 模型：谁负责回答

1. 输入 `/config`，选择 `Model`。
2. 选择 Provider、实际模型 ID 和认证方式；不要把行情 token 填进模型 API key。
3. `Save` 保存连接；`Save & Verify` 还会发送最小模型检查请求。保存和验证是不同结果。
4. 保存后新提交使用新连接并保留会话历史；在途操作遵循已有连接快照。

OAuth 和 Pi 配置导入见 [认证生命周期](./configuration.md#oauth)与 [Pi 导入](./configuration.md#pi-import)。存在入口不代表任意账号已验收，不能跳过供应商授权。

#### 数据：研究依据从哪里来

在 `/config → Market Data` 选择来源、市场和样本参数，填写该来源自己的凭证。按 `Check data → Save verified` 检查并保存同一份草稿。保存成功后，Overview 的后续刷新与 Agent 后续取数使用新配置；普通研究仍可按数据契约回退，实际来源应看结果标签。

`Data Token` 进入同一数据编辑器。配置主来源是 `.ohquant/settings.json`，`OHQUANT_DIR` 可选择独立目录；不要通过公开分享这个文件来排查问题。

当出现 `daily_basic` 无权限，不应只凭面板上的 key 判断修改失败。检查回执里的 provider、endpoint、参数与错误类型：某个 Tushare 接口失败，不等于 token 完全无效；另一个来源成功，也不能证明这个接口获得权限。用 `/doctor --phase data` 检查保存的连接，精确工具/端点的 schema 与单源探测按 [Doctor 用法](./product-guide.md#commands)执行。

### 让界面遵循你选择的行情约定

`/config → Market Colors` 默认 `red-up`（红涨绿跌），可切换为 `green-up`（绿涨红跌）。选择适用于整个工作区，不会因为某一行是美股而自行翻转。

行情涨跌与操作成功/失败、风险指标分开着色：切换不会翻转失败、回撤或 VaR 的含义。金色是品牌与焦点，不表示盈利；`0.00%` 是零变化，`--` / `N/A` 是缺失，不能混读。保存会重绘，不额外请求行情；新报告保存生成时的约定，历史版本不变。完整视觉规则以 [DESIGN](../../DESIGN.md) 为准。

### 建立观察组，再发起研究

输入 `/portfolio` 打开编辑器，创建自己的观察组并添加标的。A 股建议使用交易所后缀，开放式基金带 `.OF`。也可以先看 `/portfolio --help` 再使用文字命令。

例如下面会真实创建和修改本地观察组，可能触发 Overview 取数；它只是操作样例，不是投资建议：

~~~text
/portfolio create DemoResearch
/portfolio add DemoResearch 000001.SZ 平安银行
/portfolio list
~~~

组内只保存代码、名称、instrument 和分组，不保存账户现金、成本或仓位。操作前确认目标名称或 ID；删除操作不作为入门演示的一部分。

若要完成下面的“研究 → 报告 → 恢复”路线，先在 `/config` 开启默认关闭的 `Auto Artifacts`，再提交研究请求；符合条件的 turn 结束后会生成并打开报告。不需要报告时可保持关闭。

研究用自然语言表达对象、日期和想核对的问题。例如：

~~~text
分析 000001.SZ 在 2025-01-06 到 2025-06-30 的收益与风险。
列出实际数据来源、覆盖日期、计算口径和缺失项；
数据不足时说明原因，不补造数值。
~~~

这会请求已配置的模型与数据服务；数据覆盖取决于所选来源，示例不是成功保证。结果至少核对：实际来源与数据日期、请求窗口与有效窗口、是否用了陈旧缓存、指标单位和方法、模型解释是否超出证据。

比较两个观察组时，还要明确基准、报价币种、计价币种、权重方法与缺数据策略。完整可用示例见 [组合比较](./portfolio-comparison.md)，不要把不同日期或不明币种的数字直接比较。

### 保存报告，然后继续研究

预先开启 `Auto Artifacts` 后，符合条件的量化研究 turn 完整结束并写入会话，系统才生成报告并打开浏览器。它不会为此前已经结束的研究补生成；若先完成了研究，需开启后再提交一轮符合条件的研究请求。不是每个命令或普通聊天都会生成报告。

`/artifact` 浏览、打开和恢复已有报告，不能作为“立即生成一份报告”的命令。需要年度/YTD 研究报告时，按 [年度报告](./annual-reports.md) 使用明确比较 ID 和研究条件；私有账户年报是另一条显式文件导出路径，不要将两者混称。

`/resume` 选择保存的会话；`/resume --task` 只读查看活动分支的研究任务、证据和缺项；`/compact` 在需要时压缩交流上下文，可能调用模型并产生用量。恢复能继续使用原分支的研究事实，不保证模型每次解释都正确。

原数据或报告版本缺失时，先读阻断原因，不用最新行情冒充旧输入。完整报告可能包含用户输入、模型文本和工具轨迹，不能直接公开；分享应使用支持的独立分享白名单，并再次核对内容。完整报告部分图表可能依赖 CDN，不能一概称为完全离线；详见 [Artifact 边界](./artifacts-design.md)。

### 遇到失败时，先确认失败发生在哪层

| 看见的情况 | 下一步 | 不应据此推断 |
|---|---|---|
| 保存成功，但请求失败 | 检查实际 provider/endpoint；用 Doctor 限定范围复查 | “配置成功”不等于权限、网络或数据覆盖成功 |
| Overview 显示旧值或 `--` | 看来源、数据日期、stale/失败提示，再检查数据连接 | 本地刷新时间不等于市场数据时间 |
| Skill 已安装但不可调用 | `/skill info <name>` 核对来源与路径，再按上游 SKILL.md 准备依赖和输入 | 安装、发现、依赖可用和输出质量不是同一状态 |
| 设置冲突 | 重新加载并核对修改，不直接覆盖另一窗口的配置 | 冲突不表示新值已经生效 |
| 报告恢复受阻 | 核对来源会话、固定报告版本和归档是否仍可用 | 旧 HTML 可打开不等于来源证据可恢复 |

用 `/skill install` 查看选择，`/skill install <name>` 按需下载，`/skill remove <name>` 移除加载选择，`/skill reload` 刷新本地修改；MCP 用 `/mcp install <name>` 和 `/mcp remove <name>` 管理 Pi 配置；依赖和配置按上游说明准备，具体见 [Skills 指南](./trader-skills.md)。长错误可在 Doctor 面板滚动阅读，截图前遮盖私有信息。

### 本地 Demo 的两条路线

#### 不连接外部服务：讲解与离线帮助

打开 [产品与技术演示](../slides.html)，用方向键或按钮翻页，N 展开备注；再看 [Blog 离线图文版](../blog/index.html)。这两页展示机制与范围，不执行量化研究，不使用真实行情或账户。

源码 CLI 的 `bun run src/index.ts -- --help` 和 `bun run src/index.ts -- --version` 可展示帮助与构建版本，不请求模型或行情。它们不是完整 TUI 研究演示。

#### 使用自己的服务：一次可恢复的研究

先将 `OHQUANT_DIR` 指向专用于演示的独立目录，再配置自己的模型和数据连接；不要复用包含私人历史的设置目录来录屏。目录仍会保存凭证和会话，不能因名为 Demo 就公开。结束后退出进程并恢复自己原来的环境设置。

按本节顺序完成“检查连接 → 创建观察组 → 开启 Auto Artifacts → 明确日期研究 → 阅读来源与限制 → 自动报告 → 恢复”。可以现场切换 Market Colors，观察界面行情色改变、风险语义和历史报告不变。不要提交订单、展示账户信息或声称这里证明了交易收益。

演示失败也保留正确反馈：权限失败就说明端点范围，数据缺失就保留缺失。不要用编造的结果补齐脚本。网站 Demo 的类型以入口标注为准；合成数据交互或录屏回放必须说明输入与版本，不把它叫作实时交易或完整在线终端。本手册不以截图代替站点或真实服务验收。

<a id="commands"></a>

## Slash 命令与 Shell 入口

Slash Command 提供设置、诊断、研究会话、观察组合、skill 和报告浏览入口。压缩、诊断、技能安装或运行可能调用模型/网络；帮助查询只读。量化研究直接输入自然语言，由 agent 选择行情与 Quant tools。

Shell 层级使用 `whyj --help`、`whyj --version` 或 `whyj --json --version` 查询入口和当前内置 Pi 包版本；`whyj -c "/help"` 可离线列出 slash 命令。未知根级参数、单独 `--json`、缺值的 `-c`/`--command` 和重复/混合 `--version` 均返回参数错误，不进入交互界面。版本与帮助查询不读取设置或发送模型/行情请求。

私有账户年报可用非交互 `whyj private-annual` shell 子命令，也可在 `/artifact` 的 TUI 面板按 `P` 打开本地导出向导。两者都要求用户显式指定完整规范化历史文件和新私有 HTML 路径，参见[文件终端导出](./annual-reports.md#显式文件终端导出2026-09-15)和[交互面板导出](./annual-reports.md#交互-tui-私有导出2026-09-15)。它不加入 Composer 或公开 slash 命令，也不进入默认 Agent 年报。

显式本地模拟盘可用 `whyj paper init|account|submit|lookup|cancel` 文件终端命令，或在已有私有账户上运行 `whyj paper agent --root ABS --account ID`。后一条是独立 paper-only Agent 会话，提交/撤单由终端按完整意图审阅；账户和订单上下文会发给已配置的模型服务，转录写在所选私有根目录下。默认研究 Agent 与公开 slash 命令不提供下单工具，见[模拟盘 Agent](./execution.md#显式私有-paper-agent2026-09-16)。
外部 Alpaca Paper 走 `whyj alpaca-paper account|submit|lookup|cancel` 的独立文件终端和 paper 凭证；它也不进入默认研究 Agent 或 slash 命令，见[外部适配器](./execution.md#alpaca-paper-外部适配器2026-09-16)。

### 一级命令目录

`src/runtime/workspace/command-catalog.ts` 是一级名称和英文描述的单一真源。Composer 建议、TUI Help、`/help` 与 `whyj --help` 必须展示同一组描述。

| 命令 | 统一描述 | 执行结果 |
|---|---|---|
| `/compact` | Compact research session context | 压缩当前 session 上下文；可附带本次压缩的关注点。 |
| `/resume` | Resume saved research sessions | TUI 中浏览并恢复 JSONL session；非 TUI 中列出或按 ID 恢复。 |
| `/portfolio` | Manage observation portfolios | 创建、重命名、删除组合，以及增删标的。 |
| `/config` | Configure models and research data | TUI 中打开 Settings；非 TUI 中输出规范化设置摘要。 |
| `/doctor` | Check model and market data readiness | 未配置时进入配置流程；已配置时诊断模型、工具链和数据源。 |
| `/skill` | Download, load, and run skills | 选择、安装、移除、查看或通过当前 agent session 运行 skill。 |
| `/mcp` | Choose and manage MCP presets for Pi | 选择 MCP 预制项，调用 Pi 接口添加或移除配置，或导出模板。 |
| `/help` | Browse commands and shortcuts | TUI 中打开 Help；非 TUI 中输出命令目录和快捷键。 |
| `/clear` | Reset the current research session | 清空对话显示并重置当前 agent/session runtime。 |
| `/artifact` | Browse and restore research reports | 浏览有效报告；选中后恢复来源 session，并在浏览器打开报告。 |
| `/exit` | Exit WhyJ Quant | 退出 WhyJ Quant。 |

一级目录只有 `name` 和 `desc`，不承载二级菜单、示例或说明段落。参数只在命令已经明确后由 parser/handler 处理；composer 不为 `/artifact` 展开任何二级选项。

查看用法可输入 `/help portfolio`、`/help /portfolio` 或 `/portfolio --help`（也支持 `-h`）。所有一级命令均支持；帮助在业务处理之前返回，即使是 `/portfolio delete Core --help` 也不会修改组合。带值的错误帮助参数会返回错误而不会执行原操作。TUI 将详细用法显示在对话区，Help 面板中可按 `?` 查询选中命令；没有安装技能时 `/ski` 仍可补全为 `/skill`。

非交互示例：`whyj --json -c "/clear --help"`，成功结果含 `data.name`、`data.desc` 和 `data.usage`。命令用法在读取或迁移配置前处理，损坏设置不会阻止此查询。查看帮助不等于执行权限、数据依赖或网络可用性检查。入口取舍见[功能发现博客](../blog/11-discoverable-interactions.md)；参数行为以本页为准。

参数采用 `--name value`；含空格的名称或路径用引号包住整个值。通用命令拒绝未知选项、重复选项和错误的参数数量，失败时提示查询用法；例如不存在 `--dry-run`，`/portfolio delete Core --dry-run` 会报错且不删除。配置子模式和工具端点继续执行各自的参数校验。当前 slash 不提供 `--name=value` 或 `--` 结束选项语法。

单引号或双引号包住的参数是字面值，即使内容为 `--help`、`-h` 也不会变成选项。例如 `/portfolio create "--help"` 创建该名称，`/portfolio delete "--help" --help` 仅查看用法；`--model "--help"` 把字符串传作模型 ID，后续仍须通过模型校验。负数和证券代码保持原文本，具体类型由端点 schema 转换。单词内部的英文撇号与 Windows 反斜杠保持原样；含空格的 Windows 路径可整体加引号，末尾反斜杠不会吞掉闭合引号。

引号必须闭合，闭合后须有空白或输入结束；不支持引号片段拼接或反斜杠转义引号。输入 `/portfolio create "Core"extra` 或缺少结束引号会先报错，不创建组合、不读取配置或请求模型；即使同时包含 `--help` 也先报告词法错误。名称中需要一种引号时，可用另一种引号包围整个值。该语法属于 slash 参数解析，不执行 shell 替换。

### 命令行为

#### `/compact [focus]`

等待当前 agent idle 后压缩 session tree，并输出保留范围、token 和量化上下文摘要。`focus` 是可选的自然语言压缩指示。上下文已经足够小时返回说明，不改写 session。

#### `/resume [sessionId]`

- TUI：`/resume` 打开有效 JSONL sessions 列表，`Enter` 恢复选中项。
- 非 TUI：无参数时列出 sessions；传入 `sessionId` 时直接恢复。
- `/resume --task`：只读查看活动 Quant session 当前分支的任务、验收条件、证据和失败原因。TUI 方向键滚动、Enter 刷新本地核验、Esc 关闭；模型输出期间也可查看，不请求模型或改写会话。必须单独使用该参数；无活动 session 的 one-shot shell 调用报错。非 TUI 宿主提供活动 session 时返回文本及同一状态 data。
- `/session` 仅作为旧输入兼容别名，不出现在公开目录、建议或文档命令表中。

#### `/portfolio`

TUI 打开组合编辑器：方向键选择，Enter 创建/打开/保存，Esc 返回或取消。可创建空组合、重命名、增删标的，删除整个组合时在面板内确认。每次修改即保存并刷新 Overview。

非 TUI 或需要直接输入时使用：

```text
/portfolio create Core
/portfolio add Core 000001.SZ 平安银行
/portfolio add Core 022364.OF 永赢科技智选A
/portfolio add Core AAPL Apple
/portfolio add Core 00700.HK 腾讯
/portfolio list
/portfolio remove Core AAPL
/portfolio rename Core 长期观察
/portfolio delete 长期观察
```

GROUP 可用组合名称或 list 输出的 ID；名称有空格时用 ID 引用。开放式基金请带 `.OF`，A 股建议带交易所后缀；`.SH/.SZ/.OF` 不会因为数字相同被合并。支持空组合和同一标的加入多个组合，删除一个组合不移除其他组合的成员。

只保存代码、名称、instrument 和分组关系，不保存持仓金额、仓位或私人净值。启动、刷新、普通 `/portfolio` 均不读取旧 holdings 文件。只有显式 `/portfolio import` 才列出旧文件，`/portfolio import <name|file|index>` 才追加导入一个组合；导入不覆盖现有自定义组合。

#### `/config`

TUI 中打开 Settings，统一编辑 Agent Runtime、Research Data 与 Workspace Experience。非 TUI 中只输出脱敏摘要和配置路径。字段、默认值与迁移规则见 [配置参考](./configuration.md)。

`/config --extensions list` 在命令回执中查看当前构建的扩展版本、声明、启用状态和诊断，不打开 Settings。`/config --extensions enable|disable|reload <id>` 管理指定扩展；当前默认 ID 是 `whyj.core`。启停保存到 `disabledExtensions` 并更新同一研究会话，重载重新初始化当前编译模块；不安装 npm 包或加载任意路径。禁用 core 会移除后续模型请求中的数据/量化/shell 工具，宿主 `research_task` 和本地管理命令仍可用。

查看可在运行中使用，更改须等模型准备/执行和其他命令结束；忙时明确提示重试。设置冲突会报告失败并尝试恢复原启停状态，不覆盖其他设置。单次调用 `bun run src/index.ts -- --json -c "/config --extensions list"` 不启动模型，返回 `data.extensions` 与 `data.unavailable`；逐项检查 enabled/configuredEnabled/diagnostics，操作失败为非零退出码。只接受上述动作和精确参数数量。开发接口与测试见 [扩展宿主](../agent-runtime/extensions.md)。

`/config --pi list|preview|apply` 显式读取并导入 Pi 的选定模型连接，不打开 Settings。可带 `--from "目录"`；preview/apply 还可带 `--provider ID`、`--model ID`，apply 必须带 preview 返回的 `--review TOKEN`。预览不导入，源文件/环境值/本地设置变化使令牌失效，失败保留现有设置；API-key 导入快照，所选 provider 支持且凭证有效时 OAuth 建立指向 Pi auth.json 的本地链接，不复制 token。后续刷新可能在 Pi 文件锁下更新该账号，Sign out 只移除 WhyJ 链接；不支持字段不会静默转成其他认证。preview/apply 不执行凭证命令或网络验证。具体映射与使用例见 [Pi 配置导入](./configuration.md#pi-import)。

Pi 与 extensions 子模式不能混用。Pi 选项值及扩展 ID 不接受空字符串或纯空格；`--review` 仅用于 apply。无效组合在读取配置、切换活动状态或执行管理操作前返回错误，TUI 在输入区提示查询用法。裸 `/config --extensions` 仍等同 list。

#### `/doctor [--phase model,tools,data]`

首次运行且缺少凭证时提供配置入口；其余情况执行真实 readiness 检查。可用 `--phase` 限定诊断范围，只接受 model、tools、data 的逗号列表，忽略大小写并去重。仅省略参数才采用默认范围；缺值、空值、未知值或混入非法项均报错，不开始诊断。Shell 的 `whyj doctor --phase data` 使用相同规则。输出可以包含认证来源和脱敏指纹，但不得包含完整 secret。

TUI 的 Configure 共用模型与数据编辑器；数据经 `Check data → Save verified` 保存，`Run diagnostics` 只检查已保存设置。关闭 Doctor、进入配置或重跑会取消旧检查；迟到结果不能重新打开面板。具体字段及取消层级见 [配置参考](./configuration.md)。

Doctor 报告支持 ↑/↓ 逐行、PageUp/PageDown 翻页、Home/End 到首尾；摘要与操作提示常驻，长错误和修复建议可完整查看。滚动不执行检查；`r`/Enter 重跑全部，`m`/`t`/`d` 重跑单阶段，`c` 配置，Esc 关闭。回归入口见 [Doctor 导航](../../src/tui/test/doctor-navigation.test.ts)。

#### `/doctor --tool NAME --market MARKET [--provider NAME] [--endpoint NAME]`

检查指定工具的一条数据路由；与 `--phase` 分开使用。其余参数直接使用端点的 API 名称，代码/日期保留字符串；参数含空格时可整体加引号，或使用 TUI 的 JSON 参数编辑器。此入口复用 `runtime/data/tool-probe.ts`，不启动模型、不执行原工具的计算/存储/shell 副作用。

数字参数必须显式提供非空数值，并满足所选端点 schema；例如单写 `--timeout` 或 `--timeout ""` 会在 Python 依赖检查和数据请求前失败。合法数字按数值传递，基金代码 `000001` 等字符串保留前导零；动态端点声明的 Boolean 参数仍按原契约处理。

日线、新闻和汇率路由的 `--start` / `--end` 使用真实公历 `YYYY-MM-DD`，且起点不能晚于终点。无效日期或倒置窗口在凭证、Python 与供应商请求前返回 `invalid-input`；端点签名另有日期格式时，以该端点的 schema 为准。

```text
/doctor --tool search_symbols --market A --provider tushare --endpoint stock_basic --keyword 平安银行
/doctor --tool akshare_fund_fund_open_fund_info_em --market Fund --symbol 270042 --indicator 单位净值走势
/doctor --tool fetch_index_rows --market A --endpoint index_stock_info
/doctor --tool fetch_bars --market US --provider financial-datasets --symbol AAPL --start 2025-01-06 --end 2025-01-17
```

非交互调用用 `bun run src/index.ts -- --json -c "/doctor --tool …"`。返回 `data` 为 `ToolProbeResult`：tool/provider/endpoint/market/params、status、rowCount、observedAt、durationMs 和 scope。响应检查通过才有 `ok: true` / 退出 0；空结果、依赖/权限失败、非法输入、超时或取消都失败。通过只证明这次响应，不能推定其他端点、参数或实时性。无缓存或设置写入；终端检查编辑器也不保存长期权限。

#### `/doctor --tool NAME --market MARKET --schema`

先查看当前构建声明的端点与参数，再决定是否执行数据检查。`--schema` 是无值开关，市场必须显式提供；可用 `--provider`、`--endpoint` 筛选，不接受 `--phase` 或端点业务参数。未知工具、无对应路由或非法参数返回失败，不回退为实际检查。

```text
/doctor --tool fetch_bars --market US --schema
/doctor --tool fetch_bars --market US --schema --provider financial-datasets
/doctor --tool akshare_fund_fund_open_fund_info_em --market Fund --schema
/doctor --tool fetch_index_rows --market A --schema --endpoint index_stock_info
/doctor --tool fetch_index_rows --market A --schema --endpoint index_zh_a_hist
/doctor --tool fetch_index_rows --market A --schema --installed --endpoint index_zh_a_hist
```

多路由时文本列出端点，筛选到一路时显示该参数 JSON schema。`whyj --json -c "/doctor --tool … --schema"` 的 `data.kind` 为 `tool-probe-schemas`、`scope` 为 `static-declarations`；`routes` 包含所有匹配路由的 provider、endpoint、parameters 和 parameterContract，`parameterRules` 为实际检查器共用的名称、长度、标量值及控制字符规则。指数路由另含 `signatureSources.akshareIndex`，标明打包签名的 AKShare 版本。查询成功的退出码 0 仅表示找到声明。

`declared-parameters` 使用已声明的字段类型、required 和额外字段规则；仍可能有日期/标的等后续语义检查。当前 92 个白名单指数端点的字段、默认值和说明来自本机 AKShare 1.18.63 的函数签名及 docstring，经 [生成器](../../src/runtime/dev/generate-akshare-index-signatures.py) 写入[静态声明](../../src/runtime/data/akshare-index-signatures.generated.ts)。例如 `index_stock_info` 没有参数，`index_zh_a_hist` 接受 symbol、period、start_date、end_date；未声明字段在 Python/网络前拒绝。当前注册表已无 `scalar-forwarding` 路由。查询本身不加载 Python，也不验证本机包版本、凭证、权限、数据覆盖或当前扩展启用情况；包升级后须用同一解释器运行生成器并重新验证。未覆盖的参数语义仍以 [AKShare 官方指数文档](https://akshare.akfamily.xyz/data/index/index.html)和实际端点响应为准。

日线、新闻和汇率的 `start` / `end` 字段现在声明 `YYYY-MM-DD` 模式及本构建的 `whyj-daily-date` 公历校验；单独消费 JSON schema 的外部程序需要实现这个自定义 `format`。跨字段的起止顺序由实际探测入口检查，schema 字段本身不表达此约束。格式正确不证明供应商有该时段的数据。

函数说明中 19 处完整 `choice of` 列表已经进入字段 `enum`，包括 `index_zh_a_hist` 的 daily/weekly/monthly、`index_zh_a_hist_min_em` 的 1/5/15/30/60 和跨行说明的 Drewry 航运指数选项。日线端点的 `start_date`/`end_date` 要求八位 `YYYYMMDD`，分时端点要求 `YYYY-MM-DD HH:mm:ss`。[语义模块](../../src/runtime/data/akshare-index-semantics.ts)把实际日历有效性写为字段 `format`；探测还比较包括函数默认值在内的起止日期，倒置窗口在 Python 前失败。自定义 `format` 由本构建的 TypeBox 校验器解释，单独消费 JSON schema 的外部程序须实现同一规则。上述检查不证明指数代码存在、供应商接受其他别名或数据覆盖；分时接口只能返回有限的近期窗口，格式合法也可能没有旧数据。其他没有完整枚举说明的字段仍按原字符串 schema 处理。

此入口在读取设置与切换活动之前返回。损坏配置仍可查看 schema，TUI 显示查询结果而不打开/取消 Doctor；CLI 不生成 insight 缓存或研究文件。无参数 schema 查询只读；去掉 `--schema` 并填写业务参数才会执行响应检查。

需要核对运行环境时，显式添加无值开关 `--installed`。它仅支持 AKShare 白名单指数路由；混合 provider 的查询先用 `--provider akshare` 或 `--endpoint` 限定。查询使用行情请求同一 Python 选择器导入本地 AKShare，读取所选函数的签名和说明，不访问数据端点、模型、凭证或设置。普通 `--schema` 仍只读打包声明，不启动 Python。

安装版回执的 `scope` 为 `installed-signatures`，`signatureSources.akshareIndex` 为实际包版本；`comparison` 分别给出 `packagedVersion`、`versionMatches`、`matchesPackaged` 与 `changedEndpoints`。版本不同但字段相同会分别标记，避免把版本号变化误作参数变化。缺少 Python/AKShare、函数或不支持的参数签名会返回失败；取消不继续显示旧结果。安装版 schema 用于诊断漂移，实际端点探测仍使用当前构建的静态声明；更新依赖后可运行[生成器](../../src/runtime/dev/generate-akshare-index-signatures.py)并复核探测。签名一致也不证明参数可选值、响应内容或权限。

#### `/skill`

`/skill` 查看已加载技能；`/skill catalog` 或不带名称的 `/skill install` 先展示选择，不下载。使用 `/skill install <name> [name ...]` 按需下载并加载，`/skill install --all` 才选择整个预制合集。`/skill remove <name> [name ...]` 从 JQ 加载列表中移除，保留共享仓库文件和本地修改；以后可按名称恢复。仍支持 `/skill install <owner/repo>`、`/skill info <name>`、`/skill reload`、`/skill run <name>` 和 `/skill:<name>`。Pi 负责技能扫描与模型索引。2026-10-16 已撤销逐技能文件/依赖/网络资格检查和 `/skill audit`；依赖与脚本执行遵循上游 SKILL.md，安装不构成运行成功保证。详细规则见 [Skills 文档](./trader-skills.md)。

`/skill [list]` 最多接受一个 `--scope VALUE` 或 `--source VALUE` 过滤项；`info`/`run` 的技能名可用位置参数、`--name` 或 `--skill` 三选一。仓库安装可用单个 `--repo OWNER/REPO`，不能同时指定位置仓库或 `--all`。`catalog` 和 `reload` 不接受额外参数。运行技能需要活动 Agent session；没有会话时先发送一条 AI 消息，运行结果仍须按上游工作流核对。

`/skill:technical-analyst --image "C:\Charts\weekly.png" 分析周线` 或 `/skill run technical-analyst --image PATH [instructions]` 显式附加一张本地公开图表。PNG/JPEG/WebP 最大 8 MiB，当前模型须声明图片输入。图片像素只用于本次模型操作及工具续轮，不进入 JSONL、缓存或后续独立请求；恢复后需要重新附图。分析文字仍按普通研究规则保存，账户截图没有因此获得私有输出权限。文件、模型、取消及验证边界见 [图表图片输入](./README.md#images)。

#### `/mcp`

`/mcp` 列出五项预制服务与当前配置；`/mcp info <name>` 查看依赖和官方链接。`/mcp install <name> [name ...]` 和 `/mcp remove <name> [name ...]` 复用 Pi 的配置接口，默认编辑 Pi 用户目录的 `mcp.json`；加 `--local` 选择当前项目的 `.pi/mcp.json`。同名已有配置保留。`/mcp export <name> [name ...]` 仅输出所选模板 JSON，不读取或导出本地凭证。

安装表示添加连接配置，实际连接、认证与 stdio 包启动交给 Pi；在 Pi 中 `/reload` 或重启生效。移除项目项可能重新显露用户级同名服务；包缓存与 OAuth 凭证由 Pi 管理。Tushare 模板默认禁用，需填写账号提供的完整 URL 后启用。详见 [MCP 指南](./trader-skills.md#mcp)。

#### `/help`

无参数时展示与一级 catalog 一致的命令描述和键盘快捷键；`/help COMMAND` 查询一个命令的简要用法、前置条件和示例。完整语义以本文为准。

Help 面板使用全宽列表：`Tab` / `Shift+Tab` 切换 Commands 与 Hotkeys，方向键选择并滚动，`Esc` 关闭。Commands 中 `Enter` 执行选中命令，`?` 关闭面板并在对话区显示其用法；Hotkeys 是只读说明，Enter 和 `?` 不会执行快捷键或上次选中的命令。切换视图保留各自位置，重新打开 Help 从首条命令开始。底部显示当前操作和用法入口。

#### `/clear`

清空当前对话界面，并重置 agent/session runtime。它不删除磁盘中的历史 sessions 或 artifacts。

#### `/artifact`

`/artifact` 不接受参数或子命令。TUI 按已提交版本显示报告、时间与 revision；`Enter` 恢复选中版本对应的来源分支，并在浏览器打开原报告，后续研究不会覆盖旧版本。面板标题提示 `P private annual export`；按 `P` 打开独立的私有文件导出向导，所选 artifact 与导出使用的年度比较 ID 无关。非 TUI 列出可恢复报告版本。

缺失来源的报告会从可恢复列表隐藏，文件保留以便修复；原 entries 改变或损坏时恢复失败，保留当前会话。HTML 视图缺失或被改写时，可从选中版本的校验快照修复。详情见 [存储策略](./ohquant-storage-policy.md#artifacts)。

`whyj --json -c "/artifact"` 在 `data.reports` 返回每个版本的 `ref`、title、createdAt、sourceSessionId、messageCount 和 bytes；不包含完整轨迹或报告正文。交互恢复仍通过 TUI 选择器完成。

报告生成不属于 `/artifact`。只能在 `/config` 中开启 `Auto Artifacts`；开启后，量化研究 turn 完成并写入完整 trajectory 时自动生成 Dashboard + Trajectory，并打开浏览器预览。

新报告中的 **Share preview → Download HTML** 下载独立的离线分享副本：公开行情/NAV 及已核对量化结果。SMA/Benchmark 净值初值为 1，DCA 的时间加权序列以申购前 1 为基准、首点包含费用；不包含会话原文、模型叙述、轨迹、资金金额或凭证。研究标的与区间仍可见，请在预览中检查。没有归档输入时分享按钮禁用，旧报告版本不自动改写；没有新增分享 slash，也不执行上传或发布。

#### `/exit`

结束当前进程。它不删除设置、sessions、缓存或 artifacts。

### 自然语言与量化工具

不带 `/` 的输入进入 agent loop。因子、回测、风险和策略评分由 agent 调用 `Quant.Factor`、`Quant.Backtest`、`Quant.Risk` 与 `Quant.Benchmark`；不为这些工具新增平行的一级 Slash Command。

`Quant.Research` 接收明确对象/日期/目标的任务声明；用户可直接输入“查看当前研究的验收条件和未完成原因”“继续原任务”或“结束这项任务”。任务条件、原文与重试关系保存在当前会话，通过 `/resume` 一并恢复，也可用 `/resume --task` 本地只读查看。任务机制与固定输入连续流程见 [结构化研究任务](./README.md#tasks)；任意自然语言的拆解与解释质量仍按 F12/F24 单独评测。

```text
分析 688981.SH 的 momentum 因子
回测 20/60 双均线并检查最大回撤
比较组合风险，并生成研究报告
```

### 命令维护约束

- 改一级名称或描述时，先修改 `src/runtime/workspace/command-catalog.ts`。
- 本文命令表必须逐字包含 catalog 的英文描述；README 介绍的公开命令必须来自 catalog，并链接到本页。现有 registry 测试校验这些约束。
- `slashCommands` JSON 字段继续提供名称数组；`slashCommandDetails` 提供 `name` + `desc`，避免破坏既有调用方。
- 详细参数属于 handler 与本文，不得重新扩张一级 catalog schema。

<a id="maintenance"></a>

## 文档维护与历史证据

本页是目标、范围、任务流程和命令的共同入口。配置字段只在 [configuration](./configuration.md) 维护，技术边界在模块/领域文档维护，复跑方法在 [evaluation](./evaluation.md) 维护；Roadmap 负责顺序，Blog 解释决策与反例。行为变化应同步本页对应 F-ID 和命令，不通过添加另一份总结维护第二套现状。

本次合并移除 PRD 中反复追加的阶段流水、互相覆盖的完成计数和失效的 Skill 检查说明。原始日期、失败和当时成绩可从固定修订的[历史 PRD](https://github.com/yangjingo/oh-my-quant/blob/f254bb4b2c50696fb251013f6c160eecf2e82db0/docs/quant-harness/PRD.md)与[历史 GOALS](https://github.com/yangjingo/oh-my-quant/blob/f254bb4b2c50696fb251013f6c160eecf2e82db0/docs/quant-harness/GOALS.md)追溯；这些是历史快照，不是当前操作指南。需求来源误判的纠正见[目标来源与取舍](../blog/07-artifacts-and-boundaries.md#goals)，数值反例见[评测博客](../blog/05-evaluation-beyond-green.md#counterexamples)，引擎来源见[Alpha 决策](../blog/09-boundaries-for-change.md#alpha)。

新增验收记录注明修订、环境、命令、输入和限制；固定样本、真实服务、真实模型和实际终端分别记录。文档合并的链接检查只能证明导航和结构，不能把旧模型回答、供应商响应或部署记录记为本轮成绩。
