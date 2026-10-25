# Quant UI/UX：把异步状态变成可理解的界面

更新：2026-10-13。本文统一维护界面职责、异步一致性、结构化文本渲染与色彩消费规则。视觉真源是 [DESIGN](../../DESIGN.md)，字段与键位由 [配置](./configuration.md)、[Slash 参考](./product-guide.md#commands) 维护。旧布局与命令方案的取舍见 [终端演进记录](../blog/10-layout-and-visual-language.md#visual-language)，复验入口见文末；工程叙述分为 [状态一致性](../blog/06-terminal-consistency.md)、[布局与视觉语义](../blog/10-layout-and-visual-language.md)、[功能发现](../blog/11-discoverable-interactions.md)和[失败恢复体验](../blog/12-recovery-as-ux.md)，不以博客分析替代本页行为契约。

## 用户任务与界面责任

主要研究流程为配置 → 观察组合 → 数据检查 → 分析/比较 → 报告 → 恢复。Portfolio 是观察标的/分组；公开价格和模拟曲线不等于个人账户业绩。完整任务质量由 [产品范围与验收](./product-guide.md#requirements) 与带日期验收记录维护。

```text
Header：品牌 / 活动
Analyzing：研究与工具结果  | Overview：刷新事件 / 行情 / 观察组
Composer：用户输入 / 建议 / 队列
状态栏：模型 · 数据来源 · 研究主题
Modal：Settings / Doctor / Portfolio / Resume / Artifact / Task
```

TUI 处理按键、焦点和渲染；AppRuntime/runtime 处理动作、状态与数据。TUI 不直接选择 provider 或读写业务存储。关闭 Overview 让研究区域扩展；小屏布局、中文宽度、截断和密度由 cell 规则实现，字体及真实字号由终端配置决定。

底部状态栏只显示模型、数据来源与当前研究主题（沿用活动组合名称），例如 `◈ glm-5.3-flash · tushare · Ascend昇腾产业链组合`。三个值统一使用常规字重；组合名称使用亮奶油色（#FFF3C4）强调，模型、数据来源与分隔点使用柔和灰色，以 ` · ` 分隔，仅在模型名前增加常规字重的奶油色 `◈` 图标，不添加字段标签。不再显示上下文、TTFT、TPOT 和轮数；旧 `hudMode` 设置不能重新开启这些指标，设置面板也不再提供 Status HUD 控制。空字段及其分隔符省略；窄屏截断模型名，其他字段保持完整、空间不足时省略。CLI 字体族及中文字体回退仍由终端配置决定。

一次只研究一个组合。`/portfolio` 中打开组合后选择 `Research this portfolio`，或执行 `/portfolio select GROUP`。选择保存为观察组合文件的 `activeGroupId`；旧文件未选择或 ID 已失效时使用第一个组合，不合并其他组或未分组标的。Overview 只取当前组合，底部直接使用 Overview 实际显示的组合标题，避免刷新期间两处不同名。切换会中断正在进行的研究请求，清除上一组合的展示并隔离迟到行情；已保存的其他组合保留。当前 CLI 研究入口不暴露 `compare_portfolios`，也拒绝跨组任务声明；市场基准可以单独指定，历史比较报告仍可读取。

紧凑布局的 Header 使用现有 SVG 的简化 2 列 × 1 行 Unicode 点阵标记，与原 JQ 字样同尺寸；产品名和版本同行，下一行为分隔线，空闲 Composer 占 5 行，命令、多行输入或排队时展开至 8 行；小高度保留对话空间。78 列以下自动隐藏 Overview，切换和滚动沿用原按键。布局由 TUI 自己计算，runtime 通过 `PanelSection.refresh` 传递刷新事实；不引入 provider、存储或 Host 生命周期依赖。这沿用 #82 与 [桌面生命周期博客](https://oh-my-quant.vercel.app/blog/agent-desktop-lifecycle/) 的入口/运行状态边界，`apps/tui` 迁移仍属独立架构工作。

正文、列表、普通表格值和代码使用 `#B8B4A8`；标题和少量加粗强调使用 `#FFF3C4`。Thinking 使用 `#8F8A7B`，有明确标签、两格缩进和段落间距；流式与完成状态均保留角色区分，不依赖颜色或 ANSI faint。共享 Desktop/报告配色不变。

左上角品牌在 `thinking` 状态使用 8 帧环行缺口动画，每 160ms 一帧，内侧钩线与短尾保持固定。复用 TUI 现有 80ms 重绘节拍，不新增定时器；始终占两列一行，名称、版本和布局不移动。退出 Thinking（完成、停止、失败或转入工具执行）即恢复静态标记，历史 Thinking 消息不会触发动画。

## 输入与引用

空输入时，光标位于输入行起点、占位提示之前；输入后跟随实际文本末尾。输入箭头 `›` 与发送/排队图标 `↵` 使用加粗金色强调（`#C99A2E`），辅助说明继续使用柔和灰色。

空输入提示为 `Ask anything · @ to reference · / for commands`，不再把 `/config`、`/artifact` 当作固定入口提示。`/` 仍打开命令建议。输入 `@` 显示带类型的本地候选；继续输入名称可筛选，↑↓ 选择，Tab 或 Enter 补全，再按 Enter 发送。文件名中的数字正常输入，不触发命令数字快捷选择。候选异步更新，旧查询结果不能覆盖新输入。

- `@file:notes.md` 或 `@notes.md` 引用相对启动目录的文件，也支持绝对路径。含空格写为 `@"file:My Notes/研究.md"`，目录候选可以逐层展开。发送时读取 UTF-8 文本快照并记录真实路径与 SHA-256；每个文件最多 128 KiB，目录、二进制、非 UTF-8 和缺失文件明确报错。
- `@session:会话ID` 引用当前工作目录下保存会话的活动分支，不切换或续接该会话。内容为最近 24 条可读消息/压缩摘要，每条最多 4000 字符；附会话路径、leaf ID、条目 ID、节选哈希、略去条数与逐条截断标识。历史回答只是上下文，不是本轮已核验事实。
- `@evidence:会话ID/结果条目ID` 引用活动分支中的一个工具结果，携带原会话、调用/结果条目 ID、调用参数、结果内容及哈希。`@evidence:` 同时列出当前会话结果与已保存会话的证据目录；选择目录继续选择结果。失败结果明确标记，其他结果仅称“已记录”，不会绕过现有研究核验、自动满足任务验收或合并分支。

一次最多 8 个引用，展开内容总计最多 256 KiB。自然语言请求和研究中的排队消息都在发送前解析；聊天展示保留原输入，持久化的模型消息保留引用快照。没有引用的请求不扫描文件。读取失败不调用模型，可按 ↑ 找回原输入修改。runtime 负责发现、读取和来源信息，TUI 只消费候选并处理键盘；文件内容作为资料发送给当前模型，slash 命令不展开 `@`。

## 配置和诊断

模型、数据和外观保存是不同事件。模型 Save & Verify 只验证模型；数据 Check data 验证草稿，Save verified 只保存匹配的成功版本并刷新一次。取消/冲突不发布成功，退出父面板不重复刷新。已有显式保存不会因返回上一层而撤销。

Doctor 显示 Model / Tools / Data 的独立结果；报告生成成功不能替代每阶段成功。关闭、重试或进入配置会取消旧检查；迟到结果不能重开面板。工具详情的 Endpoint check 只证明选定端点与参数的响应。状态语义见 [Doctor](./configuration.md#diagnostics)。

Doctor 先显示失败阶段及修复操作，再显示成功阶段与警告。Composer 空态提示 `/config` 和 `/artifact`；Settings 保留英文字段身份，并为模型、行情、凭证、观察组合和自动报告提供中文标签及当前字段说明。

Model OAuth、Pi 导入和 API-key 编辑共享连接归属，但有各自提交边界，见 [OAuth](./configuration.md#oauth)、[Pi 配置导入](./configuration.md#pi-import)。长报告采用可滚动内容及固定动作区；错误正文可完整读取，而不只留一行裁剪文本。

## 输入与队列

Shell 参数、slash 和自然语言各有入口；catalog 是 help、CLI 与建议栏的共同来源。精确命令 Enter 提交，Tab 接受建议。忙碌输入的 steer/followUp 队列由 harness 持有，Composer 展示快照；displayText 保留原文，不把研究元数据显示为用户输入。

`/resume --task` 是只读任务投影；查看或本地刷新不替用户修订任务。继续与修订通过 Composer 的研究输入完成。无效命令参数先返回错误，不为显示用法而初始化模型或刷新行情。

研究运行时，Composer 显示推理/工具阶段与已等待秒数，默认 `Ctrl+G` 停止当前请求，包括模型启动前的准备阶段。中断清理排队输入并阻止该轮自动报告，保留会话、任务和已保存证据；用户输入“继续”才启动新的研究请求，沿用既有证据核验。阶段和时长不代表完成百分比，模型推理深度不变。键位可配置或禁用，见[配置参考](./configuration.md#terminal-keys)；退出与关闭面板的键位保持原意。

## Overview 的时间和代次

[OverviewRefresh](../../src/runtime/workspace/overview-refresh.ts) 管理一轮刷新和取消；[OverviewRequestPool](../../src/runtime/workspace/overview-data.ts) 对本轮规范化标的去重并限制并发。显式刷新使旧轮失效，旧回调不能覆盖新输入。

首个请求行返回即开始发布进度，即使该行没有可用报价；后续短时间内合并重绘。有历史观测的标的在等待时显示原值及 `~`，失败或超时后标为 `!`；没有历史观测的未返回项显示 `--`。旧观测保留原日期、来源和数据窗口状态，等待/失败项不计入可用数；它们只是公开行情展示，不能替代研究工具取数与核验。timeout、partial、unavailable 与 error 分别表达，不能统一成“最新”。默认 `Ctrl+R` 只重试失败标的，健康项沿用上次成功观测、不重新请求；运行中的重试共享当前轮，删除的标的不保留缓存。首次结果耗时只由本轮实际返回的可用报价触发，不能由缓存填充触发。

Overview 顶部只显示一次 `Refresh: YYYY-MM-DD HH:mm`，表示本地刷新尝试开始时间，初次请求前为 `Refresh: --`。渐进发布不移动该时间；重试开启新的刷新事件。它不是公共行情日期，也不声明所有报价新鲜。行情行不重复日期、provider 或回退详情，移除 Source 区块；实际来源、日期和回退元数据仍保留在 observation 中，研究证据不变。异常时显示一条 Loading / Partial / No data / Timeout / Failed 状态及必要的重试快捷键；`~` 表示等待中的上次值，`!` 表示保留旧值或旧窗口，`--` 表示缺失。底栏保留配置的数据来源，不冒充每行实际 provider。请求期限使用取消定时器与单调时钟截止检查；不承诺抢占同步 JavaScript。

## 渲染与背压

[Screen](../../src/tui/src/buffer.ts) 在输出流背压期间保留最新待发画面，恢复后重画同步帧；退出清理光标、鼠标和备用屏幕。中间动画帧可以合并，研究事件仍由会话账本保留。流的 drain 不等于用户终端完成绘制。

行情涨跌色与成功/失败色分开；Market Colors 可切换，零值和缺失值保持中性。TUI 立即应用外观设置，新报告固定生成时的颜色约定，旧报告不重写。结果表格保留结构，长文本和长模型名不挤占输入/操作提示。

必要说明、思考文本和表格/图表注释采用 `#A6A6A6`，不叠加 ANSI faint。Conversation 为每个仍存活的消息缓存一个宽度及渲染输入快照；文字、工具/技能展示字段或宽度变化时重新排版。历史、选择和复制仍完整保留，冷排版和 resize 仍随历史增长。`bun run src/tui/dev/measure-conversation-render.ts --check` 单独测量合成历史的冷排版、热重绘、末条更新及宽度变化，只代表布局/ANSI CPU 耗时。


<a id="structured-render"></a>

## 结构化结果：文本契约与确定性渲染

表格、图表的职责也在这条 UI 链内，不另设 quant-render 包、MCP render 工具或独立 widget 系统：

```text
AppRuntime 原始输入 → Session prompt/followUp/steer/skill
 → context 注入输出契约 → Pi/tool 结果文本
 → render-lines 解析 → 语义样式 → Buffer 绘制
```

基础 prompt 要求比较、排名、持仓、交易记录和信号保留结构化行，评论简短；除非用户要求 Markdown，优先紧凑对齐文本。context 只在 table/chart/compare/ranking/holdings/trade log/backtest 及对应中文关键词出现时追加引导，并按回测、风险、benchmark/dashboard、因子、搜索和快照补充行族提示。普通对话不额外注入。

续问“继续”“展开讲一下”可从 recent_tool_state.result_shape 找回 risk_metrics、backtest_metrics 或 dashboard_ranking 等形状偏好。这是呈现线索，不是研究事实；核验状态仍由[Harness 投影](./README.md#research-state)恢复。AppRuntime 不再次拼接同一 prompt，以免首轮、队列和显式技能走不同策略。

[render-lines](../../src/tui/src/render-lines.ts)确定性解析 assistant/tool preview：

- 接受 Markdown pipe 表及双空格对齐文本，统一为无闭合竖线的三线表。
- 内容行后有明确 divider 才认作表头；没有 divider 时不把第一行数据加粗。
- 独立整行 divider 吸收入表格，以内容宽度重画，不泄漏一小段横线。
- 折线/sparkline 使用紧凑走势字符；K 线使用方向/OHLC 行；柱状与对比块保留 EQ/BM/α 等可扫描标签。
- 不把任意工具 JSON 自动变成专用组件，不承诺识别所有模型排版。

显式技能在 Conversation 显示 SKILL.<name>，不回显隐藏的 XML 指令；已有同名状态行时折叠重复用户 banner。图表附件的传输、释放与恢复规则见[图片输入](./README.md#images)，文本图表渲染不代表模型具备读图能力。

<a id="colors"></a>

## 色彩只表达已知的语义

[DESIGN](../../DESIGN.md)是唯一视觉真源，[theme-colors](../../src/types/theme-colors.ts)维护数值，[metric-semantics](../../src/types/metric-semantics.ts)判定指标，[styles](../../src/tui/src/styles.ts)提供 TUI 样式。不另立 amber / cash gold 调色板；CASH 对应品牌金，不表示盈利或账户现金判断。

| 语义 | 样式行为 | 切换 Market Colors |
|---|---|---|
| 品牌与焦点 | 主金 #D4AF37、焦点 #E2BE4D、亮金 #F0D77A | 不变 |
| 文字与结构 | 正文 #F5F5F5、次要 #A6A6A6、分隔 #242424 | 不变 |
| 涨跌/收益/K 线 | tableGain/Loss、chartUp/Down 携带 market-up/down 的 fgRole | 按工作区约定重映射 |
| 成功/失败、风险量、评分 | 独立 positive/negative 语义，有名称/状态词 | 不随行情翻转 |
| 平盘、显示为零、缺失 | muted/tableNeutral；缺失仍写 -- / N/A | 中性，不把缺失变 0 |

用户通过 /config → Market Colors 选择 red-up（默认红涨绿跌）或 green-up（绿涨红跌），对同一工作区 A/HK/US/基金统一生效，不逐标的自动翻转。保存成功立即重绘、重启保留；取消或冲突不应用未保存值，也不额外抓行情。配置字段只在[配置参考](./configuration.md)维护。

MARKET_UP/DOWN 常量只是默认回退值；绘制时 marketForegrounds 把工作区选择交给 Buffer，在写字符时解析 fgRole。已有缓存行因此可以重新着色，无需重新请求模型或复制 parser。Return +2.50% 随约定变化，Max drawdown −8.20% 是风险，failed 是操作失败，都不随之翻转；价格 100 也不能仅因正数标作盈利。

Overview、表格、K 线和新报告共享约定，报告提供图例并冻结生成时选择，旧版本不改写。符号、方向标签、单位与状态词必须继续可读，不能只靠颜色传达判断。当前是两种行情约定，不是任意皮肤编辑器；真实字号和字体由终端决定。

## 报告与恢复

Artifact 列表选择固定版本；恢复成功后打开原 HTML，不使用后来行情重画。来源缺失或校验失败保留当前会话。完整报告和公开分享副本内容不同，具体边界见 [Artifact](./artifacts-design.md)；年度研究和私有账户输出见相应专题。

报告空态说明 `/config` 开启 Auto Artifacts → 完成并通过核验的量化研究 → `/artifact` 查看。列表提示 Enter 恢复来源会话并打开报告；它不是手动生成命令，也不绕过回答核验。

## 验证范围

界面回归覆盖按键、不同终端尺寸、中文宽度、空态、错误、取消和恢复；固定模型/行情传输可验证 UI 到存储的链路。真实终端、真实模型与真实 provider 的结果需分别记录，不能由截图或单个用例推断全面可用。

可重复检查入口：[键盘流程](../../src/tui/test/research-workflow.test.ts)、[Help](../../src/tui/test/help-navigation.test.ts)、[报告恢复](../../src/artifact/test/report-recovery.test.ts)、[数据测量方法](./evaluation.md#data)、[研究恢复](./README.md#research-state)。这些入口不是本轮执行记录。性能统计先写清测量区间，再报告数值；firstResultMs 不代表终端端到端延迟。

规模与周期复验应覆盖不同标的数量、同一运行时连续调度，以及原价到最终 TUI 行的独立核对；测量边界见 [数据评测](./evaluation.md#data)。应用回调不能代替终端可见性检查。

结构化输出专项入口：[context](../../src/agent/test/context.test.ts)、[Session](../../src/agent/test/session.test.ts)、[render](../../src/tui/test/render.test.ts)。色彩专项：

```powershell
bun test src/tui/test/market-colors.test.ts src/artifact/test/market-colors.test.ts
```

这些回归覆盖缓存行重绘、混合市场、零/缺失、设置冲突与历史报告字节不改写；不是实体终端、所有浏览器或任意模型输出的普遍证明。旧独立 renderer 原型和固定配色被撤下的原因见[布局博客](../blog/10-layout-and-visual-language.md#visual-language)。
