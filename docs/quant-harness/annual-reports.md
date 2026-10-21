# 年度研究报告

更新：2026-10-09。F15 已按本地年报边界完成：观察组合报告、显式研究决策日志、生成时本地匹配记录的冻结、可信宿主私有账户年报渲染，以及用户指定完整历史文件的 shell/TUI 终端导出均已接通。真实券商账单转换与授权由 F16 跟踪，模型普遍表达质量由 F12/F24 跟踪。

## 使用

在项目目录运行 `bun run src/index.ts`，通过自然语言请求：

```text
列出保存的组合比较。
用比较 ID <实际 UUID> 生成 2025 年度研究报告，估值截止日 2025-12-31。
列出年度研究报告，并恢复其中的报告 ID <实际 UUID>。
```

默认工具 `portfolio_comparisons` 查比较，`annual_report` 生成，`annual_reports` 列出/恢复。输入必须选择一份请求区间为当年 1 月 1 日到截止日的比较；若不存在，先按 [组合比较](./portfolio-comparison.md) 创建，明确两组、币种、基准和权重方法。不会把季度比较改名为年报，或自动修改观察组。

工具参数示例（ID 替换为列表返回值）：

```json
{"comparison_id":"<comparison UUID>","year":2025,"valuation_cutoff":"2025-12-31"}
```

截止日必须在该年度且不晚于当前 UTC 日期。12 月 31 日标为年度，其余日期标为“年内截至日”。报告返回 ID 与本地 HTML 路径；在浏览器打开该路径即可阅读。`annual_reports` 无参数列出历史，`{"id":"<report UUID>"}` 恢复原始 HTML。两个工具不自动打开浏览器；`/artifact` 仍只浏览会话制品，不收录独立年报。

## 报告内容与核对

| 内容 | 当前行为 |
|---|---|
| 范围与版本 | 请求年度/截止日、实际共同估值日期、比较 ID/内容哈希、原观察组 ID/名称/revision、币种、基准与权重方法 |
| 收益与风险 | 两组及基准的单位净值、累计收益、CAGR、Sharpe、最大回撤、超额收益、波动率和区间 VaR/CVaR；与已有比较共用核验与渲染 |
| 覆盖 | 显示被排除成员、缺价格/同日汇率而移除的日期和不可计算指标；不补零或猜测交易日历 |
| 出处 | 每份公开 Bars/NAV 的 source、snapshotAt、revision、内容哈希和归档日期；汇率观测固定在比较中 |
| 历史观点 | 作者、原始标题/链接、发表日期、页码和来源核对日期；区分原文摘要与 WhyJ 应用 |
| 真实账户 | 默认 Agent 年报明确显示未接入；可信宿主可显式读取完整账户历史并在内存生成私有 HTML，用户也可指定规范化历史文件导出独立私有 HTML；账户 TWR 与研究假设分区 |
| 策略变化 | 可选取研究决策日志，展示声明日期、实际记录时间、选择、理由与比较引用；未选时显示未接入。一份静态比较或补录声明不证明年内真实成交 |

复核链为 `原始年报请求 → 比较归档/原始比较请求 → Bars/NAV 原始版本 + 比较内 FX → comparePortfolios 重算 → HTML`。不构造虚假的工具调用记录，不接受模型填入的收益数字。即使改写比较外层哈希，错误收益或与归档不符的价格仍会被拒绝；历史年报还校验比较内容绑定。

累计收益从首个实际共同估值日开始，并不自动包含上年末至首日的回报。CAGR/风险年化沿用共同观察间隔与实际日历跨度；最大回撤以负值表示。缺指标为 N/A。报价币种属于显式假设；价格/NAV 的复权、分红、费用、税和跨市场同步性限制保留在报告中。抓取时间可以晚于估值截止日，不证明历史当时可得性。

生成和按 ID 恢复的工具结果现包含 `interpretationNotes`，并把同一说明写入模型可读文本：实际观察数量与最短/最长日历间隔、零无风险率、小样本/不等长区间风险解释、超额百分点与 alpha 的区别、观察回撤的局限。说明从原比较核验结果派生，与比较输出、研究投影及新 HTML 共用；不依赖模型记住生成前读过的内容。恢复旧 HTML 时返回当前解释，但仍恢复保存的原始字节，不升级或重写旧报告。依据和限制见 [比较方法](./portfolio-comparison.md)。

## 观点来源

- Warren E. Buffett，2014-02-28 的 [Berkshire Hathaway 2013 Shareholder Letter](https://www.berkshirehathaway.com/letters/2013ltr.pdf)，PDF 第 19 页 / 印刷第 20 页：报告整理控制费用和低成本指数化的观点，说明遗产安排的原文语境，不把其中配置套给用户。
- Howard Marks，2001-11-20 的 [You Can’t Predict. You Can Prepare.](https://www.oaktreecapital.com/docs/default-source/memos/2001-11-20-you-cant-predict-you-can-prepare.pdf)，PDF 第 1 页：报告整理识别当前周期与预测转折的区别，并单独说明历史回撤对本次研究的用途和限制。

上述两份原文于 2026-09-14 核对，摘要目录版本为 1。生成不实时取原文、不宣称为该年度新增观点；出版晚于截止日的内容不会进入报告。模型不负责补造引用。更多作者、当年研究材料、矛盾观点的综合分析仍待实现。

## 存储与恢复

`storage` 管理 `.ohquant/reports/annual/{UUID}.json` 与同名 `.html`，`OHQUANT_DIR` 可覆盖根目录。JSON 保存版本、请求、比较内容哈希、选取的决策 ID/内容哈希、观点目录版本、生成时间、原始 HTML，并带内容哈希；持锁原子写入，每次生成获得新 UUID。HTML 是可修复视图，不是权威输入。

列表和恢复均重新核对原始比较、选定决策及其比较、公开数据归档；恢复写回保存的 HTML 字节，不按当前模板重新生成，也不读取当前观察组或最新缓存。丢失决策/比较/行情、篡改或损坏时报告 unavailable，保留所有已有文件。不会为了恢复而补取新行情。若 JSON 提交后 HTML 写入失败，已保存记录可在后续恢复时重新物化，不应盲目再生成。

默认 Agent 年报为本地研究制品，不含用户账户数量、现金或权益，但包含观察组名称和研究配置，未经过公共分享过滤。可信宿主的显式私有入口仅返回内存 HTML；文件终端入口只有用户指定新输出路径才将该 HTML 导出到应用状态目录之外。两条私有路径都不进入这套研究存储、会话、模型或公共分享。无上传/发布动作，SVG/CSS 内联、无脚本、CSP 禁止外部资源；查看原文链接才需要网络。`ResearchState` 只保留默认报告引用和缺项，记为 recorded；恢复上下文不等于重新核对文件。

## 模块与测试

| 模块 | 职责 |
|---|---|
| [annual.ts](../../src/research/annual.ts) | 年度边界、显式决策选择与证据投影 |
| [archived-comparison.ts](../../src/research/archived-comparison.ts) | 年报和决策共用的公开归档解析、比较复核 |
| [decisions.ts](../../src/research/decisions.ts) / [research-decisions.ts](../../src/storage/src/research-decisions.ts) | 研究声明校验、比较绑定、幂等持锁提交与读取 |
| [annual-perspectives.ts](../../src/research/annual-perspectives.ts) | 固定版本的历史观点与原始出处 |
| [annual-renderer.ts](../../src/artifact/src/annual-renderer.ts) | 独立离线 HTML，复用三组净值/指标渲染器 |
| [annual-reports.ts](../../src/storage/src/annual-reports.ts) | UUID 归档、哈希、原子写入及 HTML 物化 |
| [runtime](../../src/runtime/research/annual-reports.ts) / [tools](../../src/tools/annual-tools.ts) | 生成/列表/恢复编排及默认 Agent 入口 |
| [私有 runtime](../../src/runtime/research/private-annual-reports.ts) / [账户模块](../../src/performance/index.ts) | 可信宿主的只读账户历史核对与内存年报 HTML；不注册 Agent 或账户存储 |
| [文件终端入口](../../src/cli/private-annual-file.ts) / [文件历史读取](../../src/cli/account-history.ts) | 用户显式选择规范化历史文件和新私有 HTML 输出路径；不发现账户或写入应用报告目录 |

运行专项测试：

```powershell
bun test src/runtime/test/annual-reports.test.ts
```

18 项合成测试使用 TEMP 下隔离的 OHQUANT_DIR，禁止 fetch，不读取真实组合/账户/密钥。覆盖人工可算的 20% 收益、-18.18% 回撤和 5 个百分点超额，年度/YTD/非法时间窗、缺请求绑定、缺数据、错误数值、原始比较被替换、旧版本恢复、损坏文件保留、取消、默认工具、Doctor 四市场声明和研究上下文；还包括基金 NAV、同日 FX、显式缺成员和缺日期、未来出版观点过滤及 HTML DOM/转义。

上述 18 项覆盖确定性工具、文件和 DOM；后续 Pi 与浏览器证据见下节。仍未证明真实模型能正确选择年报工具。真实账户业绩需要用户授权的历史权益、出入金及费用端口，优先评估既有数据 MCP；当前执行接口的账户快照不足以计算年度账户收益。不得从旧私有目录补齐。

2026-09-15 新增独立 [账户区间业绩模块](./performance.md)，提供只读历史适配器、资金流分段收益及已扣费用核对。合成账本已验证，仍待指定真实服务、年度边界与私有展示/导出契约；本年报工具继续返回 accountPerformance=not-connected，不自动接入该模块或保存账户数据。

年报现有独立 [真实模型评测入口](./evaluation.md#annual)：`bun run eval:research -- --case annual`。它用固定合成比较和两条决策检验选择、生成与恢复，自动文件绑定与人工解释审阅分开，不接真实账户。

工程回归：

```powershell
bun run typecheck
bun run check:architecture
bun run test
bun run build
```


2026-09-14 验证：专项 18/18；全量 **1334 pass / 0 fail，163 文件、17071 断言，86.00 秒**，日志 `%TEMP%/whyj-annual-final.log`。typecheck、architecture（0 baseline violations）、build（2954 modules / 6.69 MB）、源码与构建产物 `--help` 通过；文档本地路径和 whitespace 检查通过。工程门槛不替代上述真实模型、浏览器或账户验收。

## Pi 与浏览器补充验证（2026-09-14）

[annual-recovery.test.ts](../../src/agent/test/annual-recovery.test.ts) 增加 4 项真实 Pi 循环加 localhost SSE 测试，和原专项合计 22 项：默认工具生成、下一次模型请求携带报告绑定、有损压缩后重启恢复、原始数据丢失时持久化错误、错误区间拒绝、取消不生成。压缩后的模型消息确实丢失报告 ID，研究状态仍从原始分支恢复；恢复使用原 HTML 字节，不读取当前组合。这里只固定模型响应来验证传输/工具/存储，不称为真实模型语义评测。

```powershell
bun test src/agent/test/annual-recovery.test.ts src/runtime/test/annual-reports.test.ts
```

浏览器使用 [合成预览生成器](../../output/playwright/annual-preview.ts)，与测试共用输入 fixture，并扩展为 259 个共同估值日、1 个排除成员、1 个未对齐日期。无真实行情或账户数据。首次截图显示首屏被元数据占满，已把 UUID/哈希/生成时间放入键盘可展开区域；主要范围采用两列，手机单列，窄屏增加横向滚动提示。数字和原始版本仍保留。

| 检查 | 本机 Chromium 结果 |
|---|---|
| 1440×1000 / 390×844 / 320×740 | 无整页横向溢出；桌面首屏显示净值图，窄屏图表/表格独立滚动 |
| 键盘 | Enter 展开/关闭版本、净值与缺项；方向键横向滚图、End 滚动长净值表 |
| 数据 | 页面收益 23.68%、12.66%、26.30% 与合成输入一致；259 条原始净值、缺成员/日期计数仍可查看 |
| 新开离线文件 | 断网后重新打开 file:// HTML，三条曲线与原始引用存在，0 HTTP 请求、0 page errors |
| 实际 A4 PDF | 4 页逐页查看；关闭的版本记录在打印时展开，关键数字/版本/作者/账户缺项均存在，文本无页外截断；其他折叠详情标注在原 HTML 查看 |

[浏览器断言结果](../../output/playwright/whyj-annual-browser-check.json)、[PDF 文本与边界检查](../../output/playwright/whyj-annual-pdf-check.json)、[桌面截图](../../output/playwright/whyj-annual-desktop.png)、[手机收益页](../../output/playwright/whyj-annual-mobile-performance.png)、[合成 HTML](../../output/playwright/whyj-annual-research.html)、[4 页 PDF](../../output/playwright/whyj-annual-print.pdf) 保留在 output/playwright。这个视觉范围仅限年报及其共享组合组件，不等于所有 TUI 或完整会话 Artifact 页面通过。

重新生成和检查（Playwright CLI 是开发验证工具，不是项目运行依赖）：

```powershell
bun run output/playwright/annual-preview.ts
npx --yes --package @playwright/cli playwright-cli -s=whyj-annual open --config=output/playwright/annual-browser.config.json file:///C:/Users/yangjing/Project/oh-my-quant/output/playwright/whyj-annual-research.html
npx --yes --package @playwright/cli playwright-cli -s=whyj-annual run-code --filename=output/playwright/check-annual-report.js --raw
python -X utf8 output/playwright/check-annual-pdf.py
npx --yes --package @playwright/cli playwright-cli -s=whyj-annual close
```

这组命令按当前 Windows checkout 的路径编写；换机器须同步替换浏览器脚本中的 file:// 路径。独立测试配置仅用于允许浏览器读取生成的本地文件；不改变应用默认配置。PDF 检查需要 PyMuPDF，浏览器与预览服务均已在本次检查后关闭。Firefox/WebKit、真实模型选择与解释、年度决策历史及账户业绩继续验收。

补充后的全量回归：**1338 pass / 0 fail，164 文件、17102 断言，88.47 秒**，日志 `%TEMP%/whyj-annual-ui-pi-final.log`。typecheck、architecture（0 baseline violations）、build（2954 modules / 6.69 MB）及 whitespace 检查通过。

## 研究决策日志（2026-09-15）

默认工具 `research_decisions` 提供 `list/read/record`，只记录显式选择和理由，不从组合快照推断历史决策。自然语言示例：

```text
读取比较 <comparison UUID>。为本次研究记录“暂缓”，声明日期为 2025-12-31，
理由为“尚需更多观察”，请求标识为 review-2025-001。明确标为补录，不是成交。
读取返回的决策 ID，再把它纳入这份比较的 2025 年度报告。
```

对应工具参数（不是 slash 命令）：

```json
{"action":"record","decision":{"requestId":"review-2025-001","comparisonId":"<comparison UUID>","declaredDate":"2025-12-31","choice":"defer","rationale":"尚需更多观察"}}
```

`choice` 为 retain（保留）、revise（修订）、defer（暂缓）、reject（否决），均指研究方案。`requestId` 为 8–128 位字母、数字、下划线或连字符；相同请求标识和内容重试返回原记录、原时间，内容改变则报冲突。需要更正时用新标识另录一条并在理由中说明。`declaredDate` 是输入声明，必须是真实日历日期且不晚于当前 UTC 日期；`recordedAt` 是实际本地 UTC 记录时刻。自由文本可能包含私密研究内容，请按研究理由填写，不记录账户数量或凭证。

`{"action":"list"}` 返回记录列表；`{"action":"read","id":"<64位决策ID>"}` 返回完整理由、时间和证据。ID 是请求标识的 SHA-256。记录保存在 `.ohquant/research/decisions/{id}.json`，持锁原子写入，保存比较内容哈希；读取重新核对其原始比较、价格/NAV 与计算结果。哈希检查内容一致性，不提供用户身份认证、防管理员篡改或第三方时间证明。损坏记录保留并列为 unavailable。

年报通过 `decision_ids` 显式选取 1–20 个不重复 ID：

```json
{"comparison_id":"<comparison UUID>","year":2025,"valuation_cutoff":"2025-12-31","decision_ids":["<64位决策ID>"]}
```

每条声明日期和引用比较区间必须落在报告年度/截止日内，并匹配有序的两组 ID。日志可以引用这些组的其他比较版本，不能混入无关组。输出按声明日期、实际记录时间、ID 排序；默认不会收集全年决策。未传 `decision_ids` 或下述 `decision_scope` 仍生成原有观察组合报告。追加日志不会改变已存年报；更改已引用日志即使重算其外层哈希，也会使原年报恢复失败。

补录、引用比较创建时间或数据区间晚于声明日期时会明确显示。日志只证明保存了这项研究声明，不证明当时已有该判断、用户批准、理由真实或执行了交易。年报仍标明真实账户未接入；日志不进入公共分享副本。ResearchState 保存其参数与引用为 recorded，压缩/恢复后需再次读取才复查当前归档。

本轮新增 18 项回归：16 项隔离日志/年报测试，加 2 项实际 Pi 循环与 localhost SSE 测试。覆盖幂等与冲突、非法字段/日期、取消、缺档/损坏保留、比较和决策绑定、显式年度选择、HTML 转义、公共分享排除，以及有损压缩后重启、重试和恢复失败。模型响应由 fixture 固定，不冒充真实模型选择与解释质量。

```powershell
bun test src/runtime/test/research-decisions.test.ts src/runtime/test/annual-reports.test.ts src/agent/test/annual-recovery.test.ts src/runtime/test/research-task-tool.test.ts
```

该组合初次通过 54/54；随后增加公共分享断言，日志专项 16/16。日志为 `%TEMP%/whyj-decisions-targeted.log` 和 `%TEMP%/whyj-decisions-share.log`。测试使用 TEMP 数据、合成价格与 localhost 模型服务，不接触真实账户或密钥。

[合成预览](../../output/playwright/whyj-decision-research.html) 和 [浏览器断言](../../output/playwright/whyj-decision-browser-check.json) 使用本机 Chromium 检查新决策区：1440/390/320px 均无整页横向溢出，长理由、64 位引用及补录说明可读，断网重新加载成功，无 HTTP 请求或页面错误；三张截图已检查。此轮未重做 PDF 或其他浏览器验收。可用 `bun run output/playwright/decision-preview.ts` 重建；原年报预览与旧验证记录保留。

本轮最终工程回归：**1480 pass / 0 fail，179 文件、19752 断言，137.78 秒**，日志 `%TEMP%/whyj-decisions-full.log`。test fence、typecheck、architecture（0 baseline violations）、build（2973 modules / 6.75 MB）与 whitespace 检查通过。浏览器断言文件 SHA-256：`7E7B164E07D1558EE84B1CBA6A01DA889BA9C09B6041FB0D0568E7C4EAEA0F35`；测试浏览器已关闭。F15 继续保持部分完成，未把本轮工程测试换算成完整账户或模型验收。

## 显式纳入本地年度决策（2026-09-15）

默认 `annual_report` 工具新增可选 `decision_scope: "all-recorded"`，须由请求明确选择，并与手动 `decision_ids` 二选一：

```json
{"comparison_id":"<comparison UUID>","year":2025,"valuation_cutoff":"2025-12-31","decision_scope":"all-recorded"}
```

生成前先核对年度比较及公开档案，再逐份核对本地研究决策。只有声明日期、引用比较区间落在年度/截止日内且两组 ID 顺序相同的记录才纳入；年内截至日不会纳入引用年度末比较的声明。损坏或无法核对的日志会阻断这项“全部已记录”选择，不静默略过；没有匹配记录或匹配数超过 20 条也失败，需修复档案或改用手动选取。报告生成前再次核对档案文件名列表，期间新增记录时要求重试。

成功时报告将选中的 ID 和哈希冻结为生成时的本地记录快照，HTML/工具回执说明纳入数量与来源。后续补录不改变旧报告；恢复只复核已冻结的比较、价格和决策，仍物化原始 HTML。此选项无法发现未在本地保存的研究判断，也不认证理由、声明时间、批准或交易，因此不称为全年真实决策完整。私有 `private-annual` shell 子命令仍只接受重复 `--decision ID` 手动选取。

复跑：`bun test src/runtime/test/research-decisions.test.ts src/runtime/test/annual-reports.test.ts`，覆盖同组/跨年/异组/YTD、损坏/空档/超限/参数冲突、调用方不能伪造覆盖标记、Agent 工具和新增日志后的原字节恢复。本轮专项 **39 pass / 0 fail、229 次 expect**；最终 Windows / Bun 1.3.14 全量 **1634 pass / 0 fail、192 文件、21783 次 expect、170.97 秒**，日志 `%TEMP%/whyj-annual-all-recorded-derived-final-full-2026-09-15.log`。根 typecheck、architecture（0 baseline violations）、build（2996 modules / 6.84 MB）与行尾空白检查通过。合成决策和公开归档测试不能验证真实用户是否记录了全部判断；F15 保持部分完成。

## 显式私有账户年报（2026-09-15）

现有 `annual_report`/`annual_reports` 仍处理观察组合研究制品，返回 `accountPerformance: not-connected`。新增 [可信宿主入口](../../src/runtime/research/private-annual-reports.ts) `renderAuthorizedAnnualReport(request, adapter, accountRequest, signal)`，只有调用方显式提供已授权的只读历史适配器时，才在核对原比较/归档后计算账户业绩并生成私有 HTML。严格要求账户区间为 UTC 年初至估值截止日 `23:59:59.999`；本地券商时区须另订契约。返回的 `html` 包含账户引用、期初/期末权益、出入金、净损益、TWR 和已扣费用，`visibility` 为 `private-live-only`；只在内存交付，不写 `.ohquant/reports/annual`，不进入 Agent 上下文或分享输出。账户与观察组合的收益在页面中分区，并明示后者为研究假设。

```powershell
bun test src/runtime/test/private-annual-reports.test.ts src/runtime/test/annual-reports.test.ts src/performance/test/performance.test.ts
bun run output/playwright/private-annual-preview.ts
```

三文件专项 **46 pass / 0 fail、232 次 expect**：完整/不完整账户历史、UTC 边界、取消、HTML 转义、无账户落盘，以及私有页面生成后默认 Agent 工具和保存的研究 HTML 不含账户 sentinel。私有入口加入后的全量工程回归 **1598 pass / 0 fail、191 文件、21234 次 expect、153.91 秒**，日志 `%TEMP%/whyj-private-annual-full-2026-09-15.log`。合成预览在 [离线 HTML](../../output/playwright/whyj-private-annual-synthetic.html)，实际 Chromium 的 [桌面](../../output/playwright/whyj-private-annual-desktop.png)、[390px 手机](../../output/playwright/whyj-private-annual-mobile.png)、[320px](../../output/playwright/whyj-private-annual-320.png) 和 [手机账户区](../../output/playwright/whyj-private-annual-account-mobile.png) 已逐页/局部检查；1440/390/320px 的 document scrollWidth 等于 viewport，390px 账户区宽 356px、320px 宽 286px。页面控制台 0 错误，自动资源列表为空，浏览器会话已关闭。

这次只验证合成适配器和私有渲染路径；没有真实券商/MCP 连接或默认终端触发入口，也不验证实际账单分页、币种/时区、资金流分类或真实模型解释。详细计算与授权边界见 [账户业绩](./performance.md#显式私有年报渲染2026-09-15)，F15 保持部分完成。

## 显式文件终端导出（2026-09-15）

`whyj private-annual` 是单独的非交互 shell 子命令，不进入公开 slash 命令或 Agent 工具；交互 TUI 另有本地面板入口，见下节。用户必须先有请求窗口完全一致的观察组合比较 ID，并显式提供符合 [AccountHistory v1](../../src/performance/types.ts) 的完整规范化 JSON。这个文件不是任意券商原始 CSV：需由用户或已授权的转换器确认两端权益、每次外部资金流前估值、全部出入金/费用、同一报告币种、`after-fees` 与完整性声明。程序先核对公开比较及选定决策，再读取私有文件；渲染时再次核对，以防证据中途变化。账户输入只做内部一致性校验，不认证原始账单、转换器或券商服务。

```powershell
whyj private-annual --comparison <comparison UUID> --year 2025 --cutoff 2025-12-31 `
  --history-file "C:\private\normalized-history.json" --output "C:\private\annual-2025.html"
# 开发 checkout 中也可用：bun run src/index.ts -- private-annual ...
```

可重复 `--decision <research decision ID>` 显式选取已核验的年度研究决策。输出文件的父目录须已存在，新路径须以 `.html` 结束且位于 `OHQUANT_DIR` 之外；已存在文件不覆盖。文件内容有账户引用、权益和收益，是用户选择的私有导出，不是公共分享副本。`--json` 只返回输出路径、可见性及计算/核验方法，不返回账户金额或 HTML。输入文件不得从应用状态目录读取，损坏 settings 不阻止此独立入口；输入不完整、UTC 年度边界错、比较/决策证据不符或输出失败时不生成应用年报。导出文件不受 `.ohquant/reports/annual` 的恢复/版本服务管理。

终端入口及账户相邻专项 **32 pass / 0 fail**：真实 CLI 子进程在临时目录写入合成规范化历史，检查 JSON 回执不含账户 sentinel、HTML 含私有账户区、默认年报列表仍空；损坏设置、缺流水、错窗口、畸形 JSON、无关决策、禁用路径、旧输出保护，以及无效公开比较在读取私有文件前失败均有反例。此测试没有连接真实账户或模型；券商分页、币种、时区和输入声明的真实性仍属于 F15 未完成范围。复跑：

```powershell
bun test src/cli/test/private-annual.test.ts src/runtime/test/private-annual-reports.test.ts src/performance/test/performance.test.ts
bun run test
bun run typecheck
bun run check:architecture
bun run build
```

最终 Windows / Bun 1.3.14 全量 **1630 pass / 0 fail、192 文件、21761 次 expect、216.05 秒**；日志 `%TEMP%/whyj-private-annual-file-public-first-final-full-2026-09-15.log`。首次与构建/类型检查并行的全量回归为 1628 pass / 1 fail，失败是新增测试连续启动三个 CLI 子进程超过默认 5 秒用例期限；按每个子进程 10 秒上限设置用例期限后再次复跑通过。之后新增“无效公开比较先于私有文件读取”的反例，当前专项 32/32，最终全量如前述；根 typecheck、architecture（0 baseline violations）、build（2995 modules / 6.83 MB）通过。重新编译后的 `node dist/index.js --json private-annual ...` 用合成输入成功导出账户区 HTML，无效比较加不存在的私有文件则先返回公开证据错误。发布入口可达与输入一致性不证明真实账单来源。

## 交互 TUI 私有导出（2026-09-15）

在交互 `whyj` 中输入 `/artifact`，从面板标题看到 `P private annual export` 后按 `P`。独立向导要求年度观察组合比较 ID、年份、截止日、完整规范化 AccountHistory v1 JSON 的文件路径，以及一个新的 `.html` 路径；可选多个研究决策 ID，用逗号分隔。方向键选择字段、`Enter` 编辑或保存，移到 `Review export` 后 `Enter` 查看选择，再按一次 `Enter` 才真正导出；`Esc` 取消编辑或关闭。年度比较 ID 由用户填写，和 artifact 列表的当前选中项无关。

面板只将 ID、日期与用户所选路径传给 [本地 AppRuntime](../../src/app-runtime.ts)；实际公开证据先核对、私有文件读取、账户计算、HTML 新文件独占写入沿用 [shell 导出函数](../../src/cli/private-annual-file.ts)。成功和错误通过临时 composer 状态呈现，没有把账户历史内容或 HTML 送入 Agent 消息、session、应用年报存储与公共分享。导出正在运行时拒绝并行的 Agent/报告动作，退出时按运行时生命周期取消并等待。输出仍有真实账户值，须由用户在所选私有文件位置管理；原始券商账单转换与来源认证未接入。

专项复跑：

```powershell
bun test src/tui/test/private-annual-workflow.test.ts src/tui/test/panel-small-screen.test.ts src/tui/test/panel.test.ts src/cli/test/private-annual.test.ts
bun run typecheck
bun run check:architecture
bun run build
```

交互测试使用临时公开比较和合成规范化账户历史，检查 60 列小屏可发现入口、空必填字段与取消不触发导出、审阅阶段不提前写文件、实际导出私有账户区、状态和 Agent 消息不含账户 sentinel、默认年报目录保持空，以及已有输出保护。此切片补齐 F15 的交互导出入口，F15 仍因真实券商/MCP 服务、年度真实决策覆盖和模型语义验收保持部分完成。

本轮四文件专项 **36 pass / 0 fail、776 次 expect**；Windows / Bun 1.3.14 全量 **1668 pass / 0 fail、197 文件、22046 次 expect、171.66 秒**，日志 `%TEMP%/whyj-private-annual-tui-full-2026-09-15.log`。根 typecheck、architecture（0 baseline violations）、build（3003 modules / 6.87 MB）通过。回归证明本地显式导出与旧面板路径兼容；合成历史不能证明原始券商账单完整或账户金额真实。

全量回归之后，审阅页改为将长输入/输出路径按终端宽度换行，并在超出视口时支持方向键滚动。最终三文件 TUI 专项 **31 pass / 0 fail、750 次 expect**，包含 60 列终端确认页可见输出文件名；根 typecheck、architecture 和 build 再次通过。该最后一处显示调整未重新跑全量。

## F15 本地验收收口（2026-10-09）

按 [产品指南的状态口径](./product-guide.md#status)重新核对，F15 更新为已完成。年度/YTD 区间、观察组合 revision、截止日、币种与基准、收益/风险口径、缺项和限制均进入报告；两位作者观点保留原始出处，并与本次 WhyJ 推演分区。报告生成和恢复核对原比较、行情/NAV/FX、决策 ID 与哈希，缺失、矛盾、损坏、越界和超限都失败可见。

公开年报、私有账户内存端口、独立文件 CLI 和双确认 TUI 导出构成四个可调用入口。私有账户值不进入默认 Agent、研究 session、公共年报或分享副本；用户选择的导出文件明确标记为私有。真实券商原始账单、账户授权与订单执行继续属于 F16，任意模型的表达正确性继续属于 F12/F24，不重复阻塞 F15 的本地报告闭环。当前工程基线为 `bun run test` **1878/1878、224 个文件、23789 次断言**；typecheck、architecture（0 baseline violations）、test fence 与生产构建通过。
