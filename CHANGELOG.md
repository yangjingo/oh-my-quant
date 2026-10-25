# Changelog

## [Unreleased]

- 修复 #7：Windows 安装改为当前用户向导，允许选择目录并提示独立的数据位置；增加中文/空格非系统盘安装、快捷方式、重装目录与数据保留验收。
- 修复 Desktop 工作流的环境相关测试失败：取消测试为冷启动留出时间且仍要求中断未完成的流/工具；Doctor CLI 测试核对实际失败阶段的修复建议，不再假定机器已装 AKShare。

- 在当前 `main` / 1.4.0 架构上移植 #10、#12、#14 的终端修复：中文 TWR 标签、消息布局缓存、研究中断与计时、保留原日期的行情及失败项重试、Doctor 修复优先级、配置与报告引导。
- 限定因子回答的否定作用范围：允许明确的否定列举和后置限制，仍拦截逗号后的独立均值回归断言；增加错误回答不得自动生成报告的回归。
- 恢复 session runtime 仍直接导入的 `ignore`、`yaml` 精确依赖，避免干净安装缺包；保留 Pi 1.2、当前模块目录和已有核验规则。

## [1.4.0] - 2026-10-14

项目与桌面版统一为 `1.4.0`，合入主分支并使用同一版本标签。Pi `1.2.0` 是依赖版本。npm 包与 Windows 安装包另按各自发布流程交付；本次提交、合并与标签推送不表示它们已经发布。长期与跨日验证仍暂缓。

### Desktop and documentation

- 合并 `app` 分支的 Electron 桌面宿主、Windows 构建与安装验收工作流；后续统一在 `main` 维护，CLI 与桌面版本一致。
- 保留桌面首启 AKShare 默认值、固定随包 Python、Windows Git 目录别名、多行安全粘贴、中文长输入和终端尺寸/窗口状态修复；适配到当前 runtime 分组和测试目录。
- 保留主分支最新的 Pi 1.2、SDK 按需加载、Node 分包和模块边界，不将桌面分支的旧 CLI 快照恢复为现行实现。
- 文档统一归入 `docs/agent-runtime/` 与 `docs/quant-harness/`，完整量化应用包括数据、计算、执行、报告与 UI/UX；博客直接记录取舍，删除旧稿和归档副本。
- 新增 [桌面维护文档](./README.md#quick-start)。运行包、个人工作区和本地验收输出不进入源码提交。


### Runtime

- 将 `@earendil-works/pi-agent-core`、`@earendil-works/pi-ai` 从本地候选的 1.1.0 精确锁定到 **1.2.0**，TypeBox 对齐 **1.3.27**，同步 Bun lockfile。1.2.0 是 2026-10-13 核对 npm `latest` 与[上游发布记录](https://github.com/earendil-works/pi/releases/tag/v1.2.0)时的最新稳定版。
- 明确 Node.js 最低版本 **22.19.0**。此次验证环境为 Windows、Bun 1.3.14、Node.js 25.8.1；其他平台未据此宣称通过。
- 保留上游 Agent loop / provider 调用与本地 Session、Quant Harness、Storage 的模块边界。已有 `normalizeContext()` / `TranscriptContext` 适配继续通过兼容检查；上游 coding-agent 的界面和扩展功能不会因这两个依赖升级而自动成为 WhyJ 功能。

### Fixed

- 新建 `compare_portfolios` 研究任务必须声明 `scope.portfolioRevision` 和按比较顺序排列的 `scope.groupIds`；对已有读取结果核对版本及组身份。遗漏或不匹配时返回可修正错误，不偷偷补写或更换用户版本。模型工具与宿主声明入口共用校验；历史日志按原契约恢复。
- 统一收益类因子 N 个收益区间需要 N+1 个收盘价的说明，保留 Latest 表头换行的正确识别。与已核验因子绑定的观察数错误，即使回答没有 Latest 字段，也会触发复核。
- 新增明确标的权重加总检查：例如给定 SPY 40%、XLE 25% 后，不能把 `SPY+XLE` 写成 75%。只校验可唯一匹配的显式加总，不推断 ETF 穿透敞口或组合收益。
- 新闻正文只说“未报道条件发生”时，不能引用该段落断言“条件未发生”。此项与真实引用段落绑定，也适用于压缩后恢复的证据检查。
- 以上回答校验保留模型原文及会话证据，显示复核提示并阻止该回答自动生成报告；它们是有限规则，不是任意金融解释的正确性证明。
- 修复 Skill 评估对“外部查询：无 / mutations：无”、中文金额单位、长缺失输入列表、“不宣称普遍最优”、`Active alerts` 表头和宏观冲击标签的误判。保留独立肯定陈述、混合告警表、错误金额和真实收益预测的反例测试。
- 增加 `bun run check:release`，统一类型检查、架构边界、测试围栏、全量测试及构建；`prepublishOnly` 调用该门槛，打包包含本文件。

### Module boundaries

- `src/account-performance/` 简化为 `src/performance/`；公开账户类型、计算口径和私有输出标识不变。文件读取移至 `src/cli/account-history.ts`，经模块公共入口校验；runtime 继续负责私有年报组装。
- CLI 的 15 个测试文件收敛至 `src/cli/test/`，handler 测试保留子目录；同步导入、子进程工作目录和文档中的执行路径。
- 架构检查限制 `performance`、`alpha`、`execution`、`extensions` 的外部生产消费者使用 `index.ts`，禁止生产代码引用测试代码；账户计算限定依赖范围。测试围栏禁止 CLI 测试再次散落，新增 11 项正反例验证门禁。
- 这次未淘汰产品功能、迁移用户数据或改写历史验证记录；其他旧模块的测试布局仍需逐步收敛，未宣称全仓已经插件化。

### Skill isolation

- 后续收敛 `skill`：命令及报告文件适配移至 CLI，应用目录与发现刷新移至 runtime；Python 探测只依赖显式 `SkillPythonRunner`。生产消费者统一使用 `skill/index.ts`，架构检查禁止 skill 反向引用宿主或 CLI 结果类型，测试围栏覆盖 `skill/test/`。保留安装事务、取消、探测有效期及现有命令行为；新增脱离其他产品模块运行的隔离回归。

### Quant isolation

- `quant/index.ts` 改为显式公共计算契约，生产消费者统一从该入口导入。笔记生成迁至 `insight/generator.ts`，取数/保存比较流程迁至 `runtime/research/comparison.ts`，撤掉 quant 到 insight 的转发依赖；现有计算公式与工作流行为保留。
- 计算测试收敛至 `quant/test/`，合成夹具和独立数值参考归 `test/fixtures/`；insight 与比较编排的测试跟随职责迁移。架构门禁禁止 quant 导入 IO、provider 或应用宿主，并检查 `.js` 到 TypeScript 的解析，避免绕过公共入口。
- 新增 Bun/Node 独立目录运行公共计算的回归、比较流程保存/失败契约，以及入口、依赖和测试布局的正反例。此次不淘汰产品功能或迁移用户数据。

### Src convergence

- 扫描全部 19 个生产模块及顶层入口的静态依赖、公开消费路径、测试和夹具归属；没有因文件大或目录多而删除产品功能。[本轮模块依赖清单](./output/src-convergence-audit.json)。
- runtime 的 95 个根级实现文件收敛为 11 个组装入口，其余按 `data`、`models`、`skills`、`research`、`evidence`、`evaluation`、`workspace` 分组。回答检查不依赖评测场景；评测作为可选消费者存在，生产服务不能反向引用。
- Agent 核心的 `createAgent()` 必须接收完整宿主端口；默认配置、工具、发现与 JSONL 组装移至 runtime 的 `createLocalAgent()` / `createDefaultSessionDependencies()`。现有应用行为保留，架构和整条构建加载链均检查 Agent 不再加载 runtime、CLI、TUI 或内置工具注册表。
- `AppState`、UIMessage、面板和 HUD 契约归 `types`，命令分类归 runtime 命令目录；移除 tools 到 runtime 展示服务的旧转发文件。runtime 不再反向导入 CLI/TUI，包含类型依赖。
- 所有 src 模块测试集中管理，补齐 runtime、tools、research、market、Alpaca 适配器及顶层入口的测试布局；进程和技能夹具跟随测试迁移。测试围栏自动覆盖新增模块，保留 `source/tests` 与 app 子功能各自的 `test`。

| 已扫描模块 | 本轮处理与边界结论 |
|---|---|
| agent | 核心端口与默认宿主组装分离；保留上游内核适配 |
| runtime | 七个职责分组，限制 UI 与评测反向依赖 |
| cli、tui、types | 命令分类与共享展示契约归位，界面消费服务 |
| tools | 集中测试，移除展示兼容转发；工具仍调用应用服务 |
| research、market | 集中测试，维持证据计算/规范化与宿主的方向 |
| app | 私有执行适配器各自管理测试与进程夹具 |
| source、storage、artifact | 保留 provider、持久化与报告管线的既有职责；同步消费路径和测试引用 |
| alpha、execution、extensions、performance、quant、skill、insight | 维持已建立的显式输入、公共入口或服务所有权；纳入全仓门禁，不额外套抽象层 |

### Agent resource loading

- 技能与提示模板加载器的 Markdown 读取、frontmatter 解析、文件名及符号链接判断收敛至 Agent 内部 `markdown-resource.ts`，两份实现合为一份；相关生产代码由 642 行减至 573 行。技能的递归发现、ignore 规则与元数据校验，模板的浅层发现与描述回退保持原样，不扩大公共入口。
- 增加 13 项加载契约回归，先在重构前通过，再验证合并后的行为；覆盖三种换行、未闭合/空 frontmatter、读取/解析错误、来源身份、符号链接的缺失/权限错误与发现范围。测试集中于 `src/agent/test/resource-loading.test.ts`。
- 全量回归暴露的测试依赖同步收敛：Doctor 的样本失效用例注入固定 Python 依赖结果，避免无关的本机环境探测超时；命令检查对完整手册保留全目录及描述断言，对 README 校验所列命令有效且链接完整手册，允许首页保持简短。
- Overview 的失败/超时恢复用例提前读取组合夹具，避免磁盘读取被 10 毫秒预算误判；使用 1 秒预算，增加初始成功及价格断言，保留挂起请求必须超时、旧值标记 stale 和下一轮恢复的校验。

### Implementation simplification

- 按调用关系清理 5 个不再使用的实现文件：CLI 的旧参数执行器和未注册 watchlist handler、旧消息转发类型、未使用的 TUI banner 和工具转发文件；保留当前组合、观察列表和启动界面的实际入口。连同失效私有方法、导入及重复实现，本轮生产源码净减少 **472 行 / 20,871 UTF-8 字节**，不计测试与本地审计文件。
- 工具输出截断改用运行时的 UTF-8 编解码能力，合并重复结果字段，保持行数/字节限制、尾部换行、BOM 和多字节字符边界契约。终端的工具/技能状态行与 Doctor 换行复用现有实现；五处相同的图表指标说明使用 artifact 内部常量，不增加跨模块依赖。
- 启用 TypeScript `noUnusedLocals`，将未使用导入、局部声明和私有成员纳入发布门槛；它不替代公共导出调用审计。新增 12 项截断测试，先在旧实现验证，覆盖正常输入、零预算、行/字节限制、多字节字符及异常代理项。既有界面、命令与模块边界回归继续保留。
- 一次性对比重构前快照与当前实现：Bun、Node 分别通过 **190,000 组**截断结果对比，终端与图表通过 **258 组**输出对比。[对比记录](./output/simplification-equivalence.log)。对比证明这些输入下的行为一致，不代表任意输入的形式化证明。

### Startup loading (2026-10-14)

- `--help`、`--version` 与根参数错误只加载命令目录和版本信息；交互界面、Doctor、私有年报、paper 与 Alpaca paper 在进入对应操作后加载。四种兼容协议复用 Pi 的 lazy API，OAuth 流在认证时注册，不再因读取模型配置提前加载 SDK。删除从当前工作目录读取 `package.json` 的重复版本函数，首页始终显示应用自身版本。
- 构建启用分包，`dist/index.js` 从约 7.25 MB 降为 **12,751 字节**；完整产物仍为 **74 个文件 / 7,192,470 字节**，不是把全部功能压缩成 13 KB。构建脚本清理旧生成目录，防止旧哈希分包混入安装包；运行和分发必须保留完整 `dist/`。
- Windows 本机隔离目录下，新旧构建交替启动；每项预热一对后统计八对新进程的耗时中位数。Node：版本 **264.92 → 53.88 ms**，帮助 **268.70 → 53.80 ms**，首页首帧 **277.61 → 208.99 ms**；Bun：版本 **271.71 → 55.74 ms**，帮助 **275.39 → 54.93 ms**，首页首帧 **296.75 → 215.37 ms**。首帧以真实 CLI 输出到管道的第一帧为界并结束进程，包含进程退出开销，不包括 Agent 完成初始化、模型调用、行情刷新或物理终端绘制；文件缓存经过预热。[最终交替测量记录](./output/startup-paired-2026-10-14.json)。
- 新增 10 项 Bun/Node 分包回归：在加载 SDK 或应用服务时主动报错，验证帮助/版本/错误参数及模型目录不触发这些加载；四种自定义协议验证首次加载和取消，OAuth 验证实际 Pi 流的凭证转换。请求在构造 payload 时终止，未调用真实模型。此轮重点是减少启动加载，未声称生产代码行数继续大幅下降。

### Verification

- 1.4.0 合并后的 `bun run check:release` 通过：**2723 项测试 / 307 个文件 / 0 失败 / 28916 次断言**，297.94 秒；类型、架构、测试围栏及 Node 分包构建通过。桌面 TypeScript、固定 Python/Git 导入、独立 Bun 编译及 `whyj.exe --version` 通过，显示 CLI 1.4.0 / Pi 1.2.0。
- 实际生成 1.4.0 tarball，解包到没有源码和 `node_modules` 的独立目录；Node/Bun 的版本及帮助入口共 4 项通过。npm 包和 Windows 安装包尚未发布。
- 首轮合并检查保留两项本机 Python 探测超时；回归改为显式缺失解释器，相关 44 项通过，未放宽超时或删除断言。最终完整结果见 [1.4.0 发布检查](./output/release-1.4.0-final.log)。新版本 Windows 安装包仍由工作流单独完成实际安装验收。
- 启动优化后，`bun run check:release` 全部通过：**2715 项测试 / 304 个文件 / 0 失败 / 28892 次断言**，297.84 秒；类型、架构、测试围栏和 Node 分包构建通过。[完整检查记录](./output/startup-release-gate-2026-10-14.log)。实际 tarball 解包到无源码、无 `node_modules` 的独立目录，Bun/Node 共 **16 项检查通过**，覆盖帮助、版本、slash 帮助、无凭证诊断、私有命令参数错误及首页正确显示应用版本。[安装包检查记录](./output/startup-package-smoke-2026-10-14.json)。未恢复长期验证，未发布。
- 实现精简后，`bun run check:release` 全部通过：**2705 项测试 / 303 个文件 / 0 失败 / 28828 次断言**，213.51 秒；类型、架构、测试围栏与约 7.25 MB Node 构建通过。新增 12 项截断回归，重构前后行为对比另行记录。[完整检查记录](./output/simplification-release-gate-2026-10-13.log)。未重跑真实模型或长期验证，未发布。
- Agent 资源加载收敛后，`bun run check:release` 全部通过：**2693 项测试 / 302 个文件 / 0 失败 / 27721 次断言**，264.47 秒；类型、架构、测试围栏与约 7.25 MB Node 构建通过，构建后版本入口及差异空白检查通过。[最终完整记录](./output/resource-loading-release-gate-verified-2026-10-13.log)。两次中间运行分别暴露 Doctor/README 检查和 Overview 时间预算问题，修正后的最终结果以此记录为准；未重跑真实模型或长期验证，未发布。
- 全 src 收敛后，`bun run check:release` 全部通过：**2680 项测试 / 301 个文件 / 0 失败 / 27664 次断言**，246.25 秒；类型、架构、全模块测试围栏及约 7.25 MB Node 目标构建通过。新增 13 项门禁回归和 1 项 Agent 整条构建依赖回归；runtime 分组的 96 个实现体除导入路径外保持一致。文档总检查、构建后 Node 版本入口及评测/模型测量脚本帮助入口通过。[本轮完整记录](./output/src-convergence-release-gate-2026-10-13.log)。未调用真实模型，未恢复长期验证，未发布到 main 或 npm。
- `quant` 隔离后，`bun run check:release` 全部通过：**2666 项测试 / 300 个文件 / 0 失败 / 27634 次断言**，239.08 秒，Node 目标构建约 7.25 MB。新增 18 项边界、独立运行和编排契约回归；22 个计算实现文件与迁移前一致。独立 Decimal 数值参考与当前文档总检查均通过。[本轮完整记录](./output/quant-boundaries-release-gate-2026-10-13.log)。未重跑真实模型、外部服务或长期验证。
- `skill` 隔离后，`bun run check:release` 全部通过：**2648 项测试 / 299 个文件 / 0 失败 / 27596 次断言**，353.64 秒，构建入口约 7.25 MB。新增 9 项架构/布局反例及 1 项独立宿主回归；模块 16 个测试文件均位于 `src/skill/test/`。[本轮完整记录](./output/skill-boundaries-release-gate-2026-10-13.log)。没有进行真实服务或长期验证。
- skill 阶段的文档总检查曾发现 `docs/slides.html` 的 4 个归档链接失效；quant 阶段重新检查时，当前文档已通过。上述历史问题不影响保留各轮代码发布检查记录。
- 上一轮 performance/CLI 目录收敛后，`bun run check:release` 全部通过：**2638 项测试 / 298 个文件 / 0 失败 / 27579 次断言**，271.15 秒，构建入口约 7.25 MB；包含新增的 11 项边界门禁测试。专项为 151 项 / 18 个文件 / 0 失败；文档链接检查通过。[该轮完整检查记录](./output/module-boundaries-release-gate-2026-10-13.log)。此次没有重新调用真实模型或重跑长期验证。
- Pi 升级阶段、目录收敛前的 `bun run check:release`：类型检查、架构边界、测试围栏、**2627 项测试 / 297 个文件 / 0 失败**、Node 目标构建全部通过。构建入口约 7.25 MB；`bun install --frozen-lockfile` 通过。[该阶段检查记录](./output/pi-1-2-release-gate-verified-2026-10-13.log)。
- 使用保存的 `zai-coding-cn / glm-5.3-flash` 连接，隔离合成输入下复测组合、六因子、10-K、13F 持有人、宏观组合、止盈、观察列表、对冲、新闻共 **9 个场景**，每个场景的最终复测均通过自动检查。组合、六因子和新闻包含压缩/重启恢复。两次新格式误判的初次失败记录与修复后的实模复测分别保留。[场景、检查数与源码哈希清单](./output/pi-1-2-release-validation-2026-10-13.json)。
- 原始 35 场景实模记录保持原样，不能用本轮 9 场景复测或离线重判覆盖其 28/35 历史成绩；本轮没有重跑全部 35 个场景。
- 产物检查使用 `bun pm pack --ignore-scripts` 生成真实 tarball，再解包到独立临时目录，在没有源码与 `node_modules` 的条件下检查 Node 版本入口、Bun 帮助和 Node 工具诊断。此项不替代全新依赖安装、真实市场权限或全天运行验收。[包内容、哈希与启动结果](./output/pi-1-2-package-smoke-2026-10-13.json)。
- 离线重放原始回答已确认：格式误判得到修正，原先漏检的宏观权重错误与新闻“未发生”错误现在会失败。它不代表模型重新生成了正确回答。
- 发布检查：`bun run check:release`；启动已构建版本：`bun run start`。真实模型检查另运行 `bun run eval:research -- --case portfolio --output output/research-evaluation-new.json`，输出路径须未存在，该命令会产生模型用量。

### Progress and deferred work

- 当前 PRD 总表为 **17 项完成、8 项部分完成**。F01/F04/F08/F11/F12/F21/F23/F24 仍有真实认证、终端、数据覆盖、解释质量或第三方能力验收缺口。旧 goal 中“3 项完成、回测 P0 尚未修复”的文字已过时，但本轮没有将全部 25 项标记完成。
- 内核本地副本已移除，Session/Harness 与 Source/Runtime/Storage 的职责已拆分；上游循环接入不等于本地会话、交互和数据层全部简化完毕。此次优先稳定性修复，不继续扩大结构重构。
- **暂缓：跨日持续运行、长时间网络故障与恢复、长期数据新鲜度和目标终端全天使用验证。** 本轮短时回归与实模复测不能替代这些结论。
- 新闻与第三方 Skill 的自由解释仍按预览能力处理。人工查看本轮输出时，10-K 回答仍出现“涨价即停产”的过强推断，宏观回答自行把报告日作为情景起点；这些不在有限自动规则的通过保证内，不能宣称解释层缺陷已全部消除。
- 本轮固定源码为 `1.4.0` 并整合分支历史；npm 发布、Windows 新版本安装验收及长期验证仍各自执行，不由代码标签替代。

## [1.2.0] - 2026-07-15

### Added

- 新增量化研究 Dashboard：内置 K 线/成交量/MACD、NAV 与收益曲线、风险收益指标、因子图、数据覆盖度和会话统计；图表颜色与 WhyJ TUI 主题 token 保持一致。
- 新增完整 Trajectory 复原：按 Turn 统计 calls、returns、skills 和 outputs，保留用户/模型输入、assistant 输出、thinking、compact、Tool/Bash/Skill 名称、Call ID、调用参数、完整返回与源 JSONL 定位信息。
- 新增 Artifact 自动生成配置。`/config` 中开启 `Auto Artifacts` 后，量化分析 turn 在 `agent_end` 持久化完成后生成 Dashboard + Trajectory，并自动打开浏览器预览。
- 新增研究对象标题推断，报告标题优先使用名称与证券/基金代码；无法识别时使用中性的“量化研究报告”。
- 新增 Artifact 恢复索引和上下文 note，使恢复后的 agent 能继续理解“这个报告”或“刚才的 artifact”。

### Changed

- `/artifact` 收敛为无参数的一级命令，只负责浏览、恢复和打开已有报告；生成模式不再作为 Slash Command 的二级选项。
- Settings 按 `Agent Runtime`、`Research Data`、`Workspace Experience` 三组规整；面板说明与操作提示进一步精简并增加可读间距。
- Codex、Claude、Agents 与 pi 的用户级 skill 集成合并为单一 `External Skills` 开关，项目量化 skills 始终可用。
- Slash command 目录、Composer 建议、Help 与 CLI 帮助共享统一 catalog，公开描述保持短而一致。
- Agent 的证券、基金与组合研究流程内置技术因子和风险指标要求；有有效收益序列时保留波动率、VaR/CVaR、最大回撤、偏度、峰度与风险调整收益，供 Dashboard 解析。
- Source provider 改为可注入 adapter 和分层 fallback；AKShare 普通 A 股日线依次尝试东方财富、新浪、腾讯，上层仍可继续降级到 Tushare。

### Fixed

- 修复 Overview 刷新失败或超时后长期停留在 `refreshing` 的问题；刷新状态可恢复，过期请求结果不会覆盖较新的数据，并保留最近一次成功面板。
- 修复组合中的开放式基金被误判为交易所证券、只得到全零行情的问题；基金代码会保留 `.OF` provider 语义，无有效数据时显示 `--`。
- 修复 Artifact 恢复时来源 session 已不存在仍继续打开的问题；报告列表和恢复前都会校验并删除孤立 HTML/metadata。
- 修复 resume 后 TUI 结构化表格和工具输出丢失，以及 Artifact Trajectory 未完整展示 Tool、Bash、Skill 调用及返回细节的问题。
- 修复报告标题沿用用户第一句话、K 线缺失或误用 Trajectory 数据生成金融图表等问题。

### Verification

- 覆盖 Artifact 生成/恢复/孤立报告清理、Trajectory schema 兼容、K 线渲染、开放式基金报价、Overview 超时恢复与竞态保护的回归测试。
- 发布前执行 `bun run test`、`bun run typecheck`、`bun run check:architecture`、`bun run build` 与 npm pack dry-run。

## [1.1.2] - 2026-07-10

### Changed

- 底部 HUD 简化为 Ctx、TTFT、TPOT、T 四项核心指标，移除冗长的阶段级 trace 展示。
- TTFT 与 TPOT 统计口径调整为跨会话多轮的平均值，不再按单轮重新计数。
- HUD 文案间距与分隔符收紧，整体观感更接近专业终端状态栏。

### Removed

- 移除详细链路状态行及其配置开关，不再显示 Ctx/Sys/LLM/Auth/Pack/Net/1st/HTTP 等内部阶段占位。
- 清理与阶段级 latency trace 相关的运行时状态、渲染逻辑和测试分支。

## [0.1.0] - 2026-06-25

首个重新梳理后的 WhyJ Quant 版本。本版本按当前 TypeScript/Bun 代码线重新定义为新的 `v0.1.0`，旧发布记录不再作为当前发布口径。

### Added

- 交互式量化分析终端：`whyj` 启动全屏 TUI，支持自然语言提问、slash commands、状态栏、组合面板、历史会话恢复和结构化输出渲染。
- Shell 入口与 one-shot 模式：支持 `whyj --help`、`whyj -c "/help"`、`whyj --json doctor` 和 `whyj --json -c "/portfolio"`。
- `.ohquant/` 本地存储体系：统一管理 settings、行情缓存、组合状态、session JSONL、artifact 输出和恢复索引。
- AI Agent runtime：接入 pi agent core/harness，支持 streaming、工具调用展示、session 持久化、resume、compact、system prompt skills block 和本地 skill runtime。
- Provider 与认证体系：支持 Anthropic Messages、OpenAI-compatible 等模型 provider 路由，并统一 API key、base URL、auth token 与行情 source credential 的读取逻辑。
- 数据源模块：提供 AKShare、Tushare、Financial Datasets、LLMQuant 等 source adapters，以及显式 source 参数、fallback flow 和 provider smoke test。
- 内置量化工具：注册 `Quant.Factor`、`Quant.Backtest`、`Quant.Risk`、`Quant.Benchmark` 与数据工具，覆盖因子、回测、风险、benchmark 和组合对比工作流。
- Portfolio 与 Insight 工作流：支持本地组合面板、基金分组、自动分类、组合对比、投资格言生成与思考区提示。
- Artifact 模块：可从 session JSONL 生成双栏 HTML 分析 dashboard，并包含敏感信息 redaction、轨迹渲染和测试样例。
- Doctor 诊断：新增 `/doctor` 和 `whyj --json doctor`，检查 runtime、配置目录、auth 来源，并输出安全的修复 hints。
- 文档体系：补充 agent loop、CLI、doctor、storage policy、source providers、built-in tool registry、quant tools、TUI layout/table/chart render、artifact design 等设计文档。

### Changed

- 代码线重新定义为 TypeScript + Bun + frame-buffer TUI，旧 Python/skills 原型和旧 Ink/React UI 不再作为当前发布基础。
- CLI command registry、TUI panel、storage、source、quant、agent harness 按模块边界重构，减少 legacy bridge、MCP adapter 和旧 service implementation。
- 配置从散落的 `.env`/旧 config 口径收敛到 `.ohquant/settings.json`，同时支持配置面板与 JSON 输出中的 secret redaction。
- TUI 渲染契约更新为结构化 text/table/chart/skill-call 展示，改善 CJK 宽度、分隔线表格、图表颜色、工具调用预览和面板 loading 状态。
- README 与中文文档改为描述当前可用的 `whyj` 安装、启动、配置、commands、JSON policy 与架构入口。

### Fixed

- 修复 provider routing：显式 source 参数不再被 fallback chain 覆盖，Anthropic/OpenAI-compatible endpoint 路由和认证来源保持一致。
- 修复 session persistence 与 resume 进度同步，减少恢复历史会话时的状态错乱。
- 修复 TUI doctor 输出、panel rendering、divider-only table parsing、figure/chart rendering、组合状态栏数据源标签和 agent busy guard 等交互问题。
- 修复 one-shot 与 TUI doctor 输出不一致，统一 JSON envelope 和人类可读输出路径。

### Release Notes

- npm 包名：`whyj-quant`
- CLI binary：`whyj`
- 首发版本：`0.1.0`
