# OhQuant 存储策略

ohmyquant 遵循与 Codex 和 pi 风格 agent 相同的本地文件系统分层：持久化用户设置、可重算的缓存、显式制品和禁止访问的私有状态各自独立。

## 模块结构

```
src/storage/
├── index.ts              # barrel re-export，统一对外接口
├── src/                  # 实现
│   ├── dirs.ts           # 路径常量 + ensureDirs
│   ├── settings.ts       # settings CRUD（load/save/normalize/migrate）
│   ├── model-auth.ts     # 独立 OAuth 凭证和 Pi 链接的本地引用
│   ├── pi-oauth.ts       # 链接后在 Pi auth.json 文件锁下读取/轮换选定账号
│   ├── watchlist.ts      # watchlist CRUD
│   ├── env-keys.ts       # WHYJ_QUANT_* 环境变量别名体系
│   ├── fs-events.ts      # 文件事件发布订阅
│   ├── policy.ts         # 存储策略定义 + 守卫
│   ├── bars.ts           # 行情数据缓存（.ohquant/data/）
│   ├── fund-nav.ts       # 公开基金 NAV/费率观察的不可变研究归档
│   ├── sessions.ts       # session 摘要列表 + 上下文用量估算
│   ├── comparison.ts     # benchmark 制品（.ohquant/benchmark/comparisons/）
│   ├── portfolio-comparisons.ts # 观察组比较的不可变价格/FX/请求与结果
│   ├── panel-portfolio.ts# Overview Portfolio symbol 列表 CRUD
│   ├── local-portfolios.ts# 遗留 portfolio 文件发现（迁移用）
│   ├── portfolio.ts      # portfolio 门面（含废弃桩 + panel-portfolio 代理）
│   └── artifacts.ts      # 原子报告快照、不可变版本与 HTML 视图
└── test/                 # 测试
    ├── sessions.test.ts
    ├── comparison.test.ts
    ├── portfolio.test.ts
    ├── local-portfolios.test.ts
    └── env-keys.test.ts
```

## 目录分类

| 路径 | 类别 | 可缓存 | 规则 |
|------|-------|-----------|------|
| `.ohquant/settings.json` | durable | 否 | 用户配置、模型偏好、开关和保存的明文凭证；显示脱敏不等于加密。WhyJ env 别名规范化，Pi 原生环境键透传。 |
| `.ohquant/model-auth/{UUID}.json` | private durable | 否 | 独立登录含明文 OAuth access/refresh token；显式 Pi 导入只含 provider 和 Pi auth.json 绝对路径指针。两种文件均禁止公开缓存、报告分享和自动清理。 |
| Pi agent 目录 `auth.json`（外部） | Pi-owned private durable | 否 | 只有已审阅且应用的 OAuth 链接会在后续请求中读取；令牌过期时使用同路径 Pi 文件锁轮换选定 provider，保留其他账号及原文件权限。Sign out 只删除 WhyJ 指针。 |
| `.ohquant/watchlist.json` | durable | 否 | Composer 自动补全 symbol 列表。 |
| `.ohquant/panel-portfolio.json` | durable | 否 | 自定义组合：代码、名称、instrument、分组关系、当前研究组合 ID（activeGroupId）与编辑时间。报价在刷新时获取；禁止私有金额和仓位。 |
| `.ohquant/data/{source}/{symbol}/snapshot.json` | cache | 是 | 同一原子快照内的公开 bars、meta 与 revision。旧 daily/meta 仅作 stale 迁移输入。 |
| `.ohquant/data/{source}/{symbol}/revisions/` | research data | 否 | 不可变公开行情版本，供 DatasetRef 复现研究输入；不自动清除。人工清理会让旧引用显式失效，不转用新行情。 |
| `.ohquant/data/akshare/{code.OF}/nav-revisions/` | research data | 否 | 不可变公开基金 NAV 和可选的当前申购费观察；每个已提交修订另有绑定整份快照的 `.commit` 标记，没有 latest head/TTL，不保存模拟投入或账户金额。 |
| `.ohquant/cache/` | cache | 是 | 带 TTL 语义的短生命周期派生制品。 |
| `.ohquant/benchmark/comparisons/portfolios/` | artifact | 否 | `compare_portfolios` 保存 UUID 比较：原始调用假设、组快照、公开价格/NAV、FX 与结果；历史工具校验和重算，报告再绑定引用版本。旧 compare handler 仍未注册。见 [组合比较](../quant-harness/portfolio-comparison.md)。 |
| `.ohquant/benchmark/results/` | artifact | 否 | 内置 `Quant.Benchmark` 工具生成的显式策略评分输出。 |
| `.ohquant/alpha/runs/` | artifact | 否 | UUID Alpha 研究档案，保存明确的模拟参数、Bars/DatasetRef、引擎版本和回执；非真实账户状态，不自动清除。 |
| `.ohquant/research/decisions/` | artifact | 否 | 显式研究声明、声明日期/实际记录时间、比较哈希与理由；请求标识幂等，内容冲突保留原文。不是用户批准或实际成交证明，理由可能私密，不进入公开缓存或分享。 |
| `.ohquant/reports/annual/` | artifact | 否 | 年报 UUID JSON 与可恢复 HTML，绑定比较及显式选定的决策哈希；恢复核对原始档案，不自动纳入后续日志。见 [年报](../quant-harness/annual-reports.md)。 |
| `.ohquant/sessions/` | artifact | 否 | JSONL 格式的 agent session 转录。`listStoredSessions()` 解析 session tree 并计算上下文用量摘要（tokens/contextWindow/percent）。 |
| `.ohquant/artifacts/{id}.report.json` | artifact | 否 | 原子报告 head，包含完整 HTML、元数据、来源与校验；生成新版本不覆盖已归档版本。 |
| `.ohquant/artifacts/.revisions/{id}/{revision}/` | artifact | 否 | 不可变 `report.json` 与可修复的 `{id}.html` 浏览器视图；不自动清理。详见 [Artifacts](#artifacts)。 |
| `.ohquant/portfolio/` | forbidden | 否 | 持仓、净值快照、配置和个人仓位不得缓存或从本地文件推断。`local-portfolios.ts` 仅用于一次性遗留迁移，不建立对该目录的持续依赖。 |

## 可缓存性规则

仅缓存可以安全重算或重新获取的数据，且不编码用户的私密财务头寸：

- 可缓存：行情数据、公开元数据、因子输入、临时后端响应、派生的 benchmark 中间结果。
- 持久化但不可缓存：设置、OAuth 凭证/链接和 watchlist，因为它们含私有凭证、路径或用户主动编写的偏好。
- 制品但不可缓存：session 和 benchmark 结果文件，因为它们是显式输出。
- 禁止访问：portfolio 持仓、净值历史、配置、交易历史、仓位大小、成本基础和任何推断的个人风险敞口。

## 设置与组合的提交规则

`settings.ts` 和 `panel-portfolio.ts` 分别拥有设置与观察组合的规范化、白名单及生命周期，复用 `durable-json.ts` 的版本检查和 `atomic-file.ts` 的进程锁/原子替换。加载返回内存 `revision`（当前文件字节的 SHA-256；文件缺失为 `missing`），草稿克隆必须保留它。保存成功会更新传入对象的 revision，但不把 revision 写进 JSON；未携带版本的对象只允许新建文件。

读取、版本校验、提交在同一写锁内执行。设置的旧格式迁移也在锁内重新读取后规范化；组合命令使用 `updatePanelPortfolio()`，在锁内读取最新分组并应用一次同步修改。`ESTORAGECONFLICT` 要求重新读取后编辑，`ELOCKED` 表示暂时占用可重试，`ESTORAGEFORMAT` 表示必须先修复或恢复原文件。失败不自动回落为可保存的空组合/默认设置，不保存额外的凭证历史副本。面板保留失败草稿，不发送保存成功或网络验证动作。

八进程测试分别验证组合修改全部保留、同版本设置草稿仅一份能提交；损坏文件、外部修改、锁占用和 CLI 恢复说明另有回归。会话、基金 NAV 与报告的版本提交规则见下文；完整 F21 的整体及时性验收仍在进行。

## 日线缓存

公开行情以 `snapshot.json` 原子提交 bars/meta/revision，SHA-256 校验完整内容；同日期新值替换旧值，合并后按日期排序去重。写锁覆盖读取、合并、归档与提交，异步等待有限重试并接受取消。唯一临时文件先 fsync 再 rename；进程中断留下的临时文件不进入读取路径，失效锁在统一 lease 过期后回收。跨进程与崩溃回归见 [Storage 测试](../../src/storage/test)。本机验证范围是进程故障，不承诺所有文件系统的断电恢复。

Windows 的目标临时占用可能使 rename 返回 EPERM/EACCES/EBUSY。共享原子写入仅对这些错误同步重试最多约 250 ms，不先删除目标；持续占用时保留原文件并报告失败。这段有限等待计入本地提交延迟，进程写锁仍保持持有。

Windows 释放锁目录时也可能短暂拒绝下一次 mkdir。同步与异步锁获取只对目标文件对应 `.lock` 目录的 mkdir EPERM/EACCES/EBUSY 作约 250 ms 的有限重试；异步等待接受取消，其他路径/系统调用的错误直接失败。锁内业务只执行一次，正常 `ELOCKED` 竞争仍立即报告占用，不能让同步 UI 保存无限等待。八进程行情与组合写入回归分别复现过该 Windows 瞬态；瞬态、持续失败、取消和非 mkdir 故障由独立子进程注入验证。

空响应和非法记录不刷新时间。`loadCachedBars()` 一次读出数据与 fresh 判定，不再先检查 meta 再另读 bars。新快照的 `meta.fetchedDates` 记录最近一次成功响应经规范化后实际包含的日期，与 bars/meta 一起校验和提交；研究缓存及过期降级只返回这些日期在请求窗口内的行，不能从累计历史补回本次响应缺失的日期。新写入的 meta 另带 `turnoverSemantics: nullable`，表示该次响应将缺失成交额保留为 `null`；无标记旧快照按 `legacy-unknown` 传给快照工具，旧 0 不被当作已核实零成交额。只有日期集合明确、最近 5 分钟成功抓取且抓取请求窗口覆盖当前请求时才算 fresh。窗口不足时重新取数，失败后可返回的 stale 子集仍受该日期集合限制。

`loadBars()` 保留显式读取累计历史的用途，不承诺这些行来自同一次响应或具有相同新鲜度。缺少 `fetchedDates` 的旧快照及旧 daily/meta 只作为 stale 数据读取，不原地改写；下一次成功抓取建立新的响应日期集合。旧不可变版本仍可按原 `DatasetRef` 读取，包括其中无法反推原始字段存在性的数值 0；工具快照的缺值投影不改写该版本或其哈希。新快照损坏后不回读旧文件冒充有效数据。fresh 只表示缓存年龄与请求覆盖，不证明交易日齐全、历史当时可得性或供应商为何删改数据。Overview 继续使用不缓存的 live 路径。

新写入的 Bars 修订使用 `head-or-marker-v1` 提交协议：先原子写不可变 `revisions/{revision}.json`，再原子替换 `snapshot.json` head，最后写入绑定该修订内容哈希的 `{revision}.commit` 标记。旧 head 在被替换前也补齐标记。历史截止查询只接受当前有效 head 或标记校验通过的新协议修订；进程若在归档后、head 前终止，未标记的孤立修订被跳过，不能通过伪造 DatasetRef 读取。取消/异常会尝试删除本次未提交归档；进程崩溃时允许保留孤立文件，但不把它当作本地观察。损坏标记使旧修订明确不可用，原文件保留以供检查。head 已替换、标记尚未写入时终止，当前有效 head 仍可读，下次保存会先补齐它的标记。已成功返回的修订即使后续 head 损坏，也可凭标记读取。旧版没有协议字段的修订继续按原规则读取，无法追溯证明它们是否在旧实现的崩溃边界完成 head 提交；此限制不应解释为供应商的历史发布证据。提交边界回归见 [历史读取测试](../../src/storage/test/bars-asof.test.ts)。

`DatasetRef` 保存 source/symbol/revision、具体日期集合、所选 bars 的内容哈希、请求窗口和 snapshotAt；`loadDataset()` 校验并读取已提交的不可变版本。因子、回测、风险和行情工具结果携带引用，Benchmark 制品保存 strategy/benchmark 两份引用与共同日期。snapshotAt 是本地组装时间，不是历史当时可得性的证明；availability 为 observed-at-fetch，不宣称 point-in-time 数据。

2026-10-11 起，新修订的 `meta.lastResponseAdjustment` 和引用的 `adjustment` 必须一致；范围为 `forward-adjusted`、`unadjusted`、`unit-nav`、`index-level`、`provider-unspecified`，对应 [来源实际请求](../quant-harness/source-data-providers.md#ohlc-复权口径2026-10-11)。旧无字段修订仍按未知读取。伪造口径、非法标签或带口径但没有本次响应日期集合的快照会被拒绝，不回退当前价格。

前复权历史水平可能在再次抓取时变化，因此即使标签和端点相同，也只将本次完整响应写入当前 head，禁止与旧响应拼接。其它口径只在前后标签相同的情况下继续累计；未知转已知、已知转未知和已知口径切换均重建 head。重建不删除不可变归档、提交标记或旧报告，旧 DatasetRef 仍指向旧观察。研究缓存始终按 `fetchedDates` 读取一份响应，`loadBars()` 的显式累积读取也受上述拼接规则约束。算法继续使用 `close`；标签不代替公司行为对账、现金分红处理或供应商独立数值校准。

引用已进入工具结果、评分和组合比较制品。Artifact 的 Research inputs 按每份引用从归档读取价格图，不同标的、角色、窗口和版本分别展示；缺失版本显示 unavailable，不回读当前行情。`loadDataset()` 同时校验日期顺序、窗口边界、市场、抓取时点、复权/可得性声明及内容哈希。七类内置量化结果已支持结构化重算；文本检测内容仍单独标为 Session interpretation，不据此核验模型叙述。

## Alpha 研究档案

`saveAlphaRun/loadAlphaRun/listAlphaRuns` 管理带 SHA-256 的不可变 UUID 档案，复用写锁、原子提交和 file events。保存有限 JSON 数值，读取拒绝路径型 ID、损坏内容及不一致版本。计算语义由 runtime/alpha 核验：原请求、固定数据版本、成交账本和指标必须匹配。历史读取不启动 Python，不用新行情代替缺失证据；列表保留不可读文件的计数。模拟资金/股数仅属于显式研究输出，不写进公开行情缓存。

研究报告与状态接收 `alpha_backtest/alpha_runs` 证据；分享仅投影单位曲线、指标和假设，不暴露模拟金额、股数或交易 ID。完整契约及测试见 [Alpha / AKQuant](../quant-harness/alpha-backtest.md)。

## 评分集合与排行榜

`score_benchmark` 原子保存带完整参数的第三版评分。`listBenchmarkResultSnapshots(signal)` 按文件名依次读取并捕获解析后 JSON 的 SHA-256、原评分和文件名；每 32 项让出事件循环，损坏/不可读文件计数但不删除。它不是全目录同一时刻的文件系统事务，也不建立单独的不可变评分 catalog。

`show_dashboard` 将捕获集合、排序、排名和完整汇总保存在工具结果中，随 session 和报告快照固定。`research/references.ts` 收集各评分的嵌套数据引用，`research/dashboard.ts` 重算所有参与评分再核对汇总；后来的评分修改/新增不影响该次研究。旧版缺完整参数的记录可浏览，但不能冒充已核验集合。公开分享不包含原文件名、私密标签或资金金额。

## 公开基金 NAV 归档

`FundNavDatasetRef` 与 Bars 引用分开，使用 `kind: fund-nav`、标准六位 `.OF`、AKShare 实际端点、日期集合、内容哈希、revision 和本地 UTC 观测时间。`archiveFundNav()` 只投影公开 NAV 字段和可选申购费观察（source/fetchedAt/rate），持锁保存不可变版本；文件写入后再原子写入绑定完整快照哈希的 `.commit` 标记，标记完成才返回引用。`loadFundNavDataset()` 校验身份、元数据、日期、内容及标记；无标记或损坏标记均显式失败，不因文件存在而复活旧结果。取消落在文件写入与标记之间时清理未提交文件；进程死亡留下的孤立文件虽在磁盘上，也不可按伪造引用重放。标记完成后的进程死亡不影响已提交版本。八进程并发、取消、空数据、修订、损坏/缺失、两种崩溃边界和路径/字段约束有专项测试。

旧版本在这项协议实施前没有 `.commit`；由于 NAV 目录没有像 Bars 那样的当前 head，无法从遗留文件本身证明它曾被成功交付。无标记旧引用现在报告 `uncommitted`，不自动补标记或从最新净值替代；可通过重新请求基金净值建立新的引用，但依赖旧引用的历史报告须明确显示证据不可用。此取舍保留旧文件供人工核对，不把孤立归档误称历史观察。

`akshare_fund_nav` 与 `fund_dca_backtest` 仍实时调用 provider，不从此目录复活旧结果或续期。历史报告只读取引用版本，缺失时显示 unavailable；NAV 独立展示，不转换为 OHLC。`unit-nav-unadjusted` / `observed-at-fetch` 明确不证明历史当时可得性、复权或现金分红总回报。费率为当前公开观察或不可用状态，历史 DCA 使用时说明恒定假设。模拟金额与份额仅随原研究转录/报告保存，不写入公开 NAV 归档，个人真实持仓仍禁止缓存。

## Env Key 别名体系

所有应用管理的环境变量使用 `WHYJ_QUANT_*` 前缀，定义在 `src/storage/src/env-keys.ts`：

| 别名 Key | 环境变量名（取第一个存在的值） |
|----------|---------------------------|
| `authToken` | `WHYJ_QUANT_AUTH_TOKEN` |
| `apiKey` | `WHYJ_QUANT_API_KEY` |
| `baseUrl` | `WHYJ_QUANT_BASE_URL` |
| `contextWindow` | `WHYJ_QUANT_CONTEXT_WINDOW` |
| `compactTriggerTokens` | `WHYJ_QUANT_COMPACT_TRIGGER_TOKENS` |
| `tushareToken` | `WHYJ_QUANT_TUSHARE_TOKEN`, `TUSHARE_TOKEN` |
| `financialDatasetsKey` | `WHYJ_QUANT_FINANCIAL_DATASETS_KEY`, `FINANCIAL_DATASETS_KEY` |
| `llmquantApiKey` | `WHYJ_QUANT_LLMQUANT_API_KEY`, `LLMQUANT_API_KEY` |
| `akquantPython` | `WHYJ_QUANT_AKQUANT_PYTHON` |

`canonicalizeWhyjEnv()` 用于 settings normalize 时，将用户配置（可能包含旧别名）映射到统一的 `WHYJ_QUANT_*` 主键名。透传非 WhyJ 前缀的自定义键。

`WHYJ_QUANT_CONTEXT_WINDOW` 仅用于无 provider 的遗留模型配置。新配置从 Pi 模型能力或 `providers[id].models[modelId].contextWindow` 读取窗口。`WHYJ_QUANT_COMPACT_TRIGGER_TOKENS` 仍是 settings env 中的自动压缩阈值，单位为 token、仅接受正整数，且不会扩大模型窗口。

Quant 可见选项见[量化配置](./configuration.md)，字段及迁移规则以[设置实现](../../src/storage/src/settings.ts)为准。外部 skill 使用单一 `skillIntegrations.external` 开关；旧 `codex` / `claude` 字段仅作为迁移输入。

仅对缺少 `provider` 的遗留设置，normalization 校验顶层 `model`：存在 `WHYJ_DEFAULT_SONNET_MODEL`、`WHYJ_DEFAULT_OPUS_MODEL` 或 `WHYJ_DEFAULT_HAIKU_MODEL` 时，`model` 必须是已配置角色别名或映射值。不匹配时按 sonnet、opus、haiku 顺序强制选择第一个可用别名，并在加载或保存时写回规范化配置。没有角色映射时不限制直接模型 ID。显式 provider 的实际模型 ID 不经过此别名重写。

## Session 上下文用量

活动会话通过 `SessionFilePort` 注入文件读写实现；默认 `LocalSessionFile` 使用精确字节 SHA-256、进程锁与 fsync/rename 原子替换。JSONL v3 逻辑追加不变，外部修改/追加/删除后旧 writer 报 `ESTORAGECONFLICT` 并要求重新打开。完整 fork 一次提交，leaf 移动和摘要是同一事务；失败不提前修改内存，读口返回副本。取消贯通压缩/导航的锁等待，文件观察者抛错不影响提交确认。详见 [会话适配](./README.md#pi-integration)。

打开与列表读取都拒绝重复 ID、缺失父项/leaf 目标和截断文件，防止 Resume 遍历循环或把部分文件当成完整会话；列表隐藏损坏条目，原文件保留。提交中的临时文件不进入列表，不自动清理或修复历史。进程终止测试在真实写入、fsync 后的 rename 前/后分别 kill；完整文件恢复通过，但不承诺所有文件系统的断电行为。追加复制完整转录，成本随文件大小增长，可用 src/storage/dev/measure-session-storage.ts 重新测量。

`listStoredSessions()` 在解析 JSONL session 文件时，会额外计算当前分支的上下文用量：

- 沿 `parentId` 链重建从 session root 到最新 leaf 的分支
- 使用 storage 自身的分支/压缩记录规则估算 token 数
- 使用有限的本地模型窗口表和回退值，不调用 Pi 的 `getModels()`
- 返回 `StoredSessionContextUsage`（tokens / contextWindow / percent）

离线摘要主要依据 session 中记录的模型 ID 与 storage 本地表；活动 session 的 HUD/自动 compact 使用 Agent 当前连接能力及覆盖。两者可能不同，统一窗口来源与恢复准确性属于 PRD F03/F20 待办。

storage 使用自身的存储记录契约生成预览和估算，不导入 agent。Agent 通过 storage 的路径 resolver 定位会话目录，并由 session-runtime 管理活动 JSONL tree。

## Artifacts

R06 的 [ResearchState](../quant-harness/README.md#research-state) 每次从活动分支和归档重建，不持久化第二份状态缓存。缺失归档使发现降为未核验，不改写 session 或已保存报告；用户原文、组合名称、模拟参数和 recordedScope 是内部上下文，不能直接作为公开分享数据。

结构化任务的 declare/resolve/cancel 事件保存在同一 session 中：宿主使用 `research_task` custom note，普通输入工具使用已原子提交且唯一匹配的成功 toolResult；不另排队重复写 note。工具调用本身或失败结果不构成声明。任务状态及重试关联是否仍有效均重新投影。归档丢失会重新打开待办，保留已提交事件的 revision，不自动替换研究输入或撤销历史记录。`/resume --task` 只读投影，不新增状态文件或会话事件。

Artifacts 将 WhyJ Quant agent session 导出为本地 HTML 研究报告，支持图表与轨迹浏览。报告保留输入内容，不等于已经过滤私密信息的分享副本。

### 存储规格

| 属性 | 值 |
|------|-----|
| 权威路径 | `.ohquant/artifacts/{id}.report.json` 和 `.revisions/{id}/{revision}/report.json` |
| 浏览路径 | `.ohquant/artifacts/.revisions/{id}/{revision}/{id}.html`，可从相同版本快照修复 |
| 类别 | artifact |
| 格式 | 单文件 HTML，内联 CSS + 报告 JS；ECharts 5.6 从固定 CDN 地址加载 |
| 大小 | 无统一 50 条消息上限；自动生成只读取选中 leaf 的分支 entries |
| 网络 | 报告本身不发起数据 fetch / XHR / WebSocket；图表运行时需要访问固定的 ECharts CDN |
| 生成 | 由 `src/artifact/src/generator.ts` 从 session JSONL 派生 |
| 版本 | `id@revision` 标识具体版本；重新生成追加归档并原子更新 head，旧版本保持不变 |

### 存储操作

`src/storage/src/artifacts.ts`：

- `saveArtifact(id, html, meta): ArtifactMeta` — 持锁读取 head，归档完整快照和 HTML，再原子提交 head；返回 revision 与 previousRevision。
- `loadArtifactSnapshot(ref)` — 单次校验读取 HTML/meta/provenance；`loadArtifact()` 与 `loadArtifactMeta()` 为单字段入口。
- `artifactReference(meta)` / `listArtifactVersions(id)` — 生成固定版本引用，沿已提交的 previousRevision 链列出历史；崩溃前未提交的归档不进入列表。
- `materializeArtifact(ref)` — 从校验通过的选中快照修复缺失/改变的 HTML 视图，不重新生成或读取最新会话。
- `listArtifacts()` — 列出当前 heads。旧 HTML/sidecar 仅在没有新 head 时读取，下一次生成将旧报告归档；新 head 损坏不回退旧文件。
- `pruneUnrestorableArtifacts(validSourceSessionIds)` — 保留此内部入口名称，但仅过滤来源不可恢复的报告，`removedIds` 为空；读取列表不会删除研究证据。
- `deleteArtifact(id)` — 显式移除当前 listing 与旧格式文件；不可变归档仍可按版本引用读取，不自动回收。

### 命令与上下文语义

- `artifactGeneration.auto: true` 在量化分析 `agent_end` 后从当前 agent session JSONL 生成 HTML，确保完整 turn 已写入 Trajectory，保存报告、写入隐藏 `artifact_export` context note，并自动打开浏览器。
- `/artifact` 在 TUI 中只打开已有报告选择器；纯 CLI 模式列出已有报告，不生成新报告。
- TUI Artifacts 面板逐版本显示时间与 revision，`Enter` 携带 `id@revision`：验证来源 entries，恢复生成时的 branch/leaf，打开已保存的 HTML，并写入隐藏 `artifact_restore` context note。恢复本身不生成新版本。
- 打开列表时隐藏缺失来源的报告；恢复前再验证来源并先修复 HTML 视图。来源丢失、被改写、分支不匹配或文件损坏时保留报告与当前会话，显示失败原因。后续新研究仍可自动生成新版本。
- `/artifact` 不接受报告 ID、生成选项或模式选项；面板也不提供生成或模式切换快捷键。
- `artifact_export` / `artifact_restore` note 记录 title、sessionId、固定 reportRef、路径、bytes、messageCount 和 provenance，供后续 agent turn 解析报告指代。

provenance 记录生成时整个 JSONL 的 SHA-256、选中 entries 的内容哈希与 ID 顺序、scope/leaf，以及各工具的 DatasetRef 和校验结果。恢复允许会话追加研究，但要求被引用的原 entries 未改变，且 leaf/parent 链一致。整文件哈希用于记录生成快照，不用于拒绝合法的后续追加；它不是外部签名，也不证明模型结论为真。

### 可缓存性

Artifact 文件是**显式制品**（artifact class），不可视为可随意重算的缓存：

- 已保存版本的 HTML 字节固定，缺失视图可从该版本快照恢复；重新运行生成器会产生新的生成时间、run ID 和版本。输入价格图固定到引用观测，文本推导指标仍需单独核验
- 仅在用户开启 `Auto Artifacts` 后由量化分析流程生成，非自动缓存
- 可能复制 session 中用户输入的私密内容；工具轨迹脱敏不等于全报告隐私过滤，分享时需明确内容范围
- 不提交 git（`.ohquant/` 已在 `.gitignore` 中排除）

### 分享副本

新生成报告内嵌一份独立 HTML 的 JSON 字符串，和完整报告一起接受版本校验；没有新增可漂移的分享 sidecar。预览通过沙箱 iframe 显示这份字节，Download HTML 下载相同字节，不执行上传。浏览器下载目录由用户/浏览器管理，不写入公开行情缓存。旧报告不为补入口而重写。

`research/input.ts` 只投影公开 Bars/NAV 引用字段并核验归档内容，拒绝未知来源、非法日期/哈希，未知属性不进入公开输出。唯一且顺序匹配的工具调用与结果才可进入各 research 核验器；显式日期、标的、来源、参数、指标和账本不匹配时排除。当前覆盖因子、风险、SMA、Benchmark、新方法 DCA、捕获完整评分集合的 Dashboard 和观察组合比较；缺原始参数绑定的旧比较、旧方法 DCA、旧 Dashboard 或包含旧版评分的集合显示未支持计数。此核对证明保存结果与指定计算/输入一致，不证明上游数据真实性或模型叙述。

组合比较额外加载对应 UUID 归档，核对其中保存的原始调用假设、FX 和结果；每份价格再绑定公开 Bars/NAV revision。FX 在比较归档与 session entry 内固定，不存在单独的 FX DatasetRef。分享只投影匿名 Portfolio A/B、公开标的、假设权重、单位曲线、风险/覆盖及白名单 FX；不带自定义组名、配置版本或任意缺失原因文本。已保存版本的分享字节不受后来组编辑、缓存修订或输入归档清理影响；重新生成缺证据时不再展示核验卡片。

副本仅含公开 OHLCV/NAV、研究对象/区间/数据版本和核对后的数值。SMA/Benchmark 模拟净值以初值 1 展示，DCA 为剔除投入的 TWR（申购前 1，首点含费用），不带现金、头寸、份额数量、自定义标题、会话 ID、本地路径、凭证、任意工具原始返回、用户/模型原文或 thinking。使用内联 CSS/SVG 与 Raw 表，CSP 禁止外部资源，无脚本或网络请求。完整报告仍可能包含私密输入，分享必须使用此独立副本。

### 色彩与设计系统

色彩由 [DESIGN](../../DESIGN.md) 和[共享语义 token](../../src/types/theme-colors.ts)维护，存储规范不另列色表。品牌、行情方向与操作状态分开表达；新报告固定生成时的行情约定，旧版本不因设置变化而重画。历史色表与现行规范分叉的原因见[布局与视觉语言](../blog/10-layout-and-visual-language.md#visual-language)，报告边界见 [Artifact](../quant-harness/artifacts-design.md)。

## Portfolio 规则

个人持仓金额、仓位和净值快照仅限实时访问，不得写入 `.ohquant/` 缓存。用户主动维护的组合标的与分组属于 durable 配置，写入 `.ohquant/panel-portfolio.json`；空组合法，读取不自动补回分组，也不重写文件。保存只保留白名单字段，持锁校验版本后通过唯一临时文件原子替换；损坏 JSON 不作为空组合读取。

`local-portfolios.ts` 读取 `.ohquant/portfolio/holdings*.json` 的唯一目的是支持一次性遗留迁移（import legacy → panel-portfolio.json）。迁移完成后不建立对该目录的持续读依赖。

现有的本地 `.ohquant/portfolio/` 文件被视为遗留用户文件。应用不会自动删除它们，也不再读取或写入它们（除非主动触发迁移）。

## TUI 可见性

所有 `.ohquant` 本地文件系统活动应流经 storage、`src/cli/` 或 agent tools，并发出 file event。READ/WRITE 可视化属于 agent/tool-call conversation stream，而非右侧边栏：

- `READ`：设置、watchlist 自动补全、行情缓存、benchmark 结果、session 读取。
- `WRITE`：设置、watchlist、行情缓存、benchmark 结果、session 转录写入。
- `MKDIR`：由存储初始化或缓存写入创建的本地状态目录。
- `DELETE`：遗留数据迁移清理。

TUI 渲染器不应直接调用 `fs`。Overview dock 由 `AppRuntime` 刷新：它读取 `.ohquant/panel-portfolio.json` 获取 Portfolio symbol，并通过数据 provider 获取实时报价。`.ohquant/watchlist.json` 仅用于 Composer 自动补全。
