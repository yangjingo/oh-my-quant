# Artifact 模块

Session JSONL → 双视图 HTML 研究报告生成器。Verified research results 从匹配的工具参数与归档输入重算因子、风险、SMA 回测、Benchmark、DCA、捕获的 Dashboard 集合和观察组合比较，核对保存结果后展示。Research inputs 展示各对象/角色/窗口/版本的归档价格或 NAV 图；文本检测内容单独标为 Session interpretation。Trajectory 按选中分支展示执行轨迹。分享副本通过独立白名单投影生成，不包含原始会话或模型叙述。

## 结构

```
src/artifact/
├── index.ts                  # 公共 API 导出
├── README.md
├── src/
│   ├── generator.ts          # 核心编排: JSONL 解析 → GenCtx → HTML
│   ├── report-input.ts       # 分支选择、entry 校验、DatasetRef 归档价格图与 provenance
│   ├── research-comparison-renderer.ts # 三组单位曲线、权重/风险/覆盖与 FX 明细
│   ├── research-renderer.ts  # 已核对结果与独立离线分享 HTML
│   ├── research-theme.ts     # 结果卡片、SVG/Raw、分享预览样式
│   ├── detectors.ts          # 纯函数: 从文本段落检测结构化数据
│   ├── renderers.ts          # ECharts 图表 JS 生成 + HTML 表格渲染
│   ├── dock.ts               # 右侧分析面板组装 (session/market/risk/benchmark)
│   ├── template.ts           # HTML 壳: 双栏布局 + Tab 切换 + 主题/排序 JS
│   ├── theme.ts              # CSS 变量 + 组件样式 (NewForm brutalist)
│   ├── types.ts              # 共享数据模型 (GenCtx, KlineData, TrajectoryEvent, ...)
│   ├── trajectory.ts         # RawEntry[] → TrajectoryDocument 转换器
│   ├── trajectory-renderer.ts # TrajectoryDocument → HTML (traj-weaver timeline)
│   └── redact.ts             # 敏感字段递归脱敏 (api_key, token, secret, ...)
└── test/
    ├── generator.test.ts     # generator + template 单元测试
    ├── report-recovery.test.ts # 同日修订、多对象图表、真实 session 分支恢复与失败保留
    ├── report-share.test.ts  # 实际工具绑定、人工账本、私密过滤与固定版本
    ├── report-fund.test.ts   # NAV/DCA 绑定、当前费率假设与无金额分享
    ├── report-dashboard.test.ts # 独立排行榜重算、旧评分、取消、改写和隐私边界
    ├── report-comparison.test.ts # 比较调用/历史、价格与 FX 绑定、缺失和分享过滤
    ├── benchmarks.ts         # 真实市场基准月度回报数据 (HS300, 机器人, 创业板,...)
    ├── gen-kline.test.ts     # SMH vs SOX 多周期 K线 + 蜡烛形态分析
    ├── gen-kc50.test.ts      # 科创50 vs 创业板指 多周期技术分析
    ├── gen-fund.test.ts      # 华夏机器人ETF (018345) 完整仪表盘
    ├── gen-fund-006265.test.ts # 红土创新新科技 (006265) 完整仪表盘
    ├── gen-stock-300308.test.ts # 中际旭创 (300308) 技术分析
    └── gen-sst-all.test.ts   # 批量生成 7 只半导体/SST 基金 artifacts
```

## 数据流

归档投影、引用收集和七类重算已迁至 [src/research](../research/input.ts)，供报告与会话状态共用。Artifact 保留 HTML/分享渲染；独立模块不反向依赖 Artifact。当前路径为 `input.ts`、`analysis.ts`、`fund.ts`、`dashboard.ts`、`comparison.ts`、`references.ts`、`match.ts` 和 `types.ts`。内部调用绑定不加入公开 analysis DTO，详见 [研究状态](../../docs/quant-harness/README.md#research-state)。

```
Session JSONL
  │
  ├── loadReportSession(path, leafId) → 所选分支 RawEntry[] + ReportProvenance
  ├── renderReportEvidence()    → loadDataset(ref) / loadFundNavDataset(ref) → 旧价格/NAV 图 / unavailable
  ├── buildResearchReport()     → 公开字段投影 → 归档校验 → 参数/结果配对与重算
  │     ├── renderResearchResults() → 完整报告中的已核对结果
  │     └── renderShareReport() → 无会话原文的独立 HTML → 预览/下载
  ├── createGenCtx(entries)      → GenCtx (title, klines, metrics, scores, factors)
  │     └── renderMessage() → processText() → detectors (tryKline, tryMetrics, ...)
  │                                           → renderers (ECharts JS, cards, tables)
  │
  ├── buildTrajectoryFromSession() → TrajectoryDocument
  │     └── redactEventToolArgs() → 脱敏后的 events
  │     └── computeTrajectorySummary()
  │
  ├── renderDock()               → 右侧面板 HTML
  ├── renderTrajectoryDocument() → 轨迹时间线 HTML
  └── renderArtifactTemplate()   → 完整 HTML 文档
```

## 内容检测 Pipeline

每段文本（以 `\n\n` 分割）按优先级依次匹配，首次命中即停止：

| 优先级 | 检测器 | 匹配模式 | 渲染器 |
|--------|--------|----------|--------|
| 1 | `tryNavChart` | 净值表 (date, nav, bm, hs300) | `renderNavEcharts` |
| 2 | `tryKline` | OHLC 表 (日期/周/月/季, 开高低收) | `renderEchartsKline` |
| 3 | `tryCompareFactors` | 对比表 (名称 + 因子%) | `renderComparisonRadar` |
| 4 | `tryFactorBars` | 因子条 (████░░ + 百分比) | `renderEchartsBars` / `renderFactorMatrix` |
| 5 | `tryMetrics` | 键值对 (标签: 数值) | `renderMetricCards` |
| 6 | `tryScoreTable` | 多列数字表 (收益/风险/稳健) | `renderScoreTable` |
| 7 | `tryDataTable` | 通用表格 | `renderDataTable` |
| 8 | plain text | — | `<p>` + 高亮 |

## K线多周期

`tryKline` 检测 `─── 日K ───`、`─── 周K ───`、`─── 月K ───`、`─── 季K ───` 段落标头，将同一消息中的多个周期作为独立 `KlineData` 条目返回。ECharts 渲染器自动生成顶部 tab 切换按钮（日K / 周K / 月K / 季K），每个 tab 独立计算 MA/MACD/成交量。

支持双基准线叠加（bm / bm2），通过图例点击切换显示。

## Trajectory 视图

当前实现从 session JSONL 构建结构化执行轨迹；契约见 [Artifact 设计](../../docs/quant-harness/artifacts-design.md)，转换入口见 [trajectory.ts](./src/trajectory.ts)。历史 recorder / DAG 方案不等同于这一实现。

- **Turn 分组**：每轮显示 calls、returns、skills、outputs 数量，并保留 model input、thinking 与 compaction。
- **完整调用链**：Tool、Bash、Skill 均保留名称、Call ID、参数、返回详情、错误状态和源 JSONL 定位。
- **重点高亮**：用户输入中的命令和 assistant/tool 输出中的关键结果使用独立语义样式。
- **敏感字段脱敏**: api_key, token, secret, password, cookie, authorization 等自动替换为 `****`
- **时间线渲染**: 左侧色带区分 user、assistant、tool、bash 与 skill，同时显示捕获完整度。

## 关键约定

- ECharts 5.6 CDN 渲染 candlestick、bar 与 radar；NAV 概览使用内联 SVG。
- 三窗格 K线布局: K线 38% + MACD 20% + 成交量 12% + 底部 dataZoom
- K 线蜡烛、网格、背景、涨跌色直接使用 `src/types/theme-colors.ts` 的 WhyJ 主题 token
- 所有曲线使用 `smooth: true` + `areaStyle` 渐变填充
- 图表内置 Chart/Raw 切换（图形 / 原始数据表）
- K 线内联 SVG 为 CDN 不可用时的回退；Raw 和主题切换不依赖 ECharts 存在
- 数据引用缺失/被修改时保留 unavailable 状态，不使用最新缓存替换旧观测
- dock 的 Instrument lookup 只根据已核验归档的标的类型和供应商端点生成外部查阅链接：基金 NAV 用蛋卷/同花顺基金页，AKShare A 股个股日线用雪球/同花顺股票页；指数、ETF 和未知端点不猜测。外部页面是查阅入口，报告中的价格证据仍是归档观测。
- 指标说明面板 (Indicator Glossary) 可折叠，解释 K线/MA/DIF/DEA/MACD/Vol 的全称和意义

## 使用

### 通过 CLI

```bash
whyj -c "/artifact"                 # 非 TUI 列出已有报告；交互模式直接输入 /artifact
```

`/artifact` 不接受二级命令或参数。新报告只由 `/config` 中的 `Auto Artifacts` 控制：开启后，量化分析 turn 完成时生成并自动打开浏览器。TUI Artifacts 面板中，`Enter` 通过内部运行时动作恢复选中的 artifact session 并打开报告。恢复或生成成功后，agent session 会收到隐藏上下文 note，后续“这个报告 / 刚才的 artifact”等引用会指向当前选中的报告。公开命令措辞见 [`docs/quant-harness/product-guide.md#commands`](../../docs/quant-harness/product-guide.md#commands)。

选择器逐版本显示时间与 revision，恢复携带固定 `id@revision`，验证源 entries/leaf 并打开已保存 HTML。后续研究可生成新版本；恢复不会重新渲染旧报告。来源缺失时隐藏不可恢复项并保留文件，恢复失败保留当前会话。存储快照和可修复 HTML 视图的规则见 [存储策略](../../docs/quant-harness/ohquant-storage-policy.md#artifacts)。

### 分享研究

在新生成报告中点击 **Share preview**，检查预览中的研究标的和区间，再点击 **Download HTML**。下载名为 `whyj-public-research.html`；页面不执行上传或发布。没有可验证的归档输入时按钮禁用。旧报告不会为了新增分享入口而自动重写，新的研究 turn 可生成新版本。

副本包含白名单公开 OHLCV/NAV、来源/版本/日期及核对通过的七类量化结果。SMA/Benchmark 净值初值为 1；DCA 是剔除外部投入的时间加权序列，申购前基准 1、首点包含费用。现金余额、份额数量、资金金额、自定义标题、会话 ID、路径、凭证、用户/模型原文及 thinking 均不进入副本；可保留模拟申购次数。重复调用 ID、结果不匹配或数据缺失时不展示伪核验结论。缺原始请求的旧组合比较、旧 Dashboard、包含缺完整参数评分的集合和旧方法 DCA 会计入未支持结果，不能从文本补齐。

组合比较另外匹配不可变归档及其中的原始请求和 FX；Bars/NAV 逐份核验，完整重算后投影匿名 Portfolio A/B、基准、单位曲线、假设权重与收益风险。缺失日期和同日汇率明示，自定义组名、组 ID、配置版本及任意缺失原因文本不进入副本。历史工具只提供 ID 也可恢复卡片；不读取当前观察组或最新行情。API 可通过 `resolveComparison` 注入比较归档读取器。

新 Dashboard 固定捕获的全部评分记录，逐条重算后核对汇总及排序；不重新扫描现有评分目录。分享的前十名显示公开标的、SMA/费用假设、实际日期、分数/收益/风险和数据引用，不显示原文件名或策略标签；窄屏表格区域可聚焦后用方向键横向浏览。不同区间/数据源的保存评分排名不是共同窗口的组合比较。

DCA `methodVersion: 2` 须逐字段核对公开 NAV/末值、计划、交易、账户曲线、摘要和费率依据。当前公开申购费仅作为恒定假设，缺失时明确零费假设。本金收益率、TWR、XIRR 分列，NAV 不伪装成 OHLC，也不表示用户账户。单位 NAV 未含现金分红、拆分、赎回费用或历史申购可用性。完整计算契约见 [量化工具](../../docs/quant-harness/quant-tools-design.md#fund_dca_backtest)。

副本使用内联 CSS/SVG 和原生可展开 Raw 表，无脚本、字体或数据网络请求。其 HTML 作为 JSON 安全嵌入原报告，随同一报告快照固定；预览和下载使用相同字节，行情修订或原 session 改变不影响已保存版本。完整报告依然保留原始研究内容并使用 ECharts CDN，不能直接当作已过滤的分享文件。

### 通过 API

```ts
import { generateArtifact } from "./src/artifact/src/generator.ts";

const result = generateArtifact({ sessionPath: ".ohquant/sessions/xxx/session.jsonl", leafId: "selected-entry-id" });
if (result) {
  // result.html  — 完整 HTML；原报告交互图使用 ECharts CDN
  // result.title — 自动检测或自定义标题
  // result.sessionId
  // result.messageCount
  // result.provenance — session/entry 哈希、分支、工具 DatasetRef 与校验结果
}
```

自动生成传入活动 leaf；API 不传 leafId 时导出全 transcript，`null` 表示空分支。解析拒绝截断 JSONL、重复 ID、缺失父项和循环。`resolveDataset` / `resolveFundDataset` 可注入固定数据读取器用于测试；生产默认读取归档。生成器不负责落盘，交给 `storage.saveArtifact()`。

### 生成测试 Artifact

```bash
bun run src/artifact/test/gen-kline.test.ts       # SMH vs SOX
bun run src/artifact/test/gen-kc50.test.ts        # 科创50
bun run src/artifact/test/gen-fund.test.ts        # 机器人ETF
bun run src/artifact/test/gen-sst-all.test.ts     # 批量 7 只半导体基金
```

## 测试

[report-pipeline.test.ts](./test/report-pipeline.test.ts) 独立检查 load/normalize/derive/render：加载指定分支、注入乱序公开观察、用 DatasetRef/参数核对人工动量值、仅凭序列化 DTO 渲染。各阶段不要求启动 Agent 或调用完整生成器，已有七类结果绑定测试继续检查整条链。

```bash
bun test src/artifact/test/generator.test.ts
bun test src/artifact/test/report-pipeline.test.ts
bun test src/artifact/test/report-recovery.test.ts src/storage/test/artifact-versions.test.ts
bun test src/artifact/test/report-share.test.ts
bun test src/artifact/test/report-fund.test.ts
bun test src/artifact/test/report-dashboard.test.ts src/quant/test/dashboard.test.ts
bun test src/artifact/test/report-comparison.test.ts
```

浏览器合成样例：`bun run output/playwright/report-share-preview.ts`，再运行 `bun run output/playwright/report-share-server.ts`，打开 `http://127.0.0.1:18441/whyj-report-sharing.html`。样例通过真实工具入口计算合成 AAPL/MSFT 数据，不调用市场或模型账户。

基金样例：`bun run output/playwright/report-fund-preview.ts`，同一预览服务打开 `http://127.0.0.1:18441/whyj-report-fund.html`。使用合成 NAV、归档和模拟 DCA 账本；真实工具入口另由 `report-fund.test.ts` 核验。`check-report-fund.js` 检查预览、Raw、实际下载与断网打开。

排行榜样例：`bun run output/playwright/report-dashboard-preview.ts`，同一服务打开 `http://127.0.0.1:18441/whyj-report-dashboard.html`。通过真实工具对合成行情评分，再生成只含 Dashboard 调用/结果的报告；`check-report-dashboard.js` 检查桌面/窄屏、排名、键盘焦点、下载、CDN 503 和断网打开。

组合样例：`bun run src/artifact/dev/check-portfolio-report.ts output/portfolio-report-synthetic`，在新目录生成完整报告、带合成标识的分享预览及验证记录，无网络/模型/账户调用。当前 [分享样例](../../output/portfolio-report-2026-09-14-r05-final/share.html) 可直接打开；合成价格/FX 与真实工具链测试分开记录。新比较页面的宽屏/窄屏、键盘和离线视觉检查仍待完成。
