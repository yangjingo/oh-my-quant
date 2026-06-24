# Artifact 模块

Session JSONL → 双栏 HTML 仪表盘生成器。左侧 Dashboard 展示会话消息和结构化数据检测（K线图、指标卡、因子、基准对比），右侧 Dock 面板展示会话统计、风险指标和外部数据源链接。Trajectory 标签页展示 Agent 执行轨迹。

## 结构

```
src/artifact/
├── index.ts                  # 公共 API 导出
├── README.md
├── src/
│   ├── generator.ts          # 核心编排: JSONL 解析 → GenCtx → HTML
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
    ├── generator.test.ts     # generator + template 单元测试 (19 tests)
    ├── benchmarks.ts         # 真实市场基准月度回报数据 (HS300, 机器人, 创业板,...)
    ├── gen-kline.test.ts     # SMH vs SOX 多周期 K线 + 蜡烛形态分析
    ├── gen-kc50.test.ts      # 科创50 vs 创业板指 多周期技术分析
    ├── gen-fund.test.ts      # 华夏机器人ETF (018345) 完整仪表盘
    ├── gen-fund-006265.test.ts # 红土创新新科技 (006265) 完整仪表盘
    ├── gen-stock-300308.test.ts # 中际旭创 (300308) 技术分析
    └── gen-sst-all.test.ts   # 批量生成 7 只半导体/SST 基金 artifacts
```

## 数据流

```
Session JSONL
  │
  ├── readSessionFile()          → RawEntry[]
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

基于 `docs/artifacts-design.md` Section 7-8，从 session JSONL 构建结构化执行轨迹：

- **12 种事件类型**: user_request, task_understanding, plan, step_start, tool_call, tool_result, observation, decision, retry, warning, artifact_write, final_answer
- **敏感字段脱敏**: api_key, token, secret, password, cookie, authorization 等自动替换为 `****`
- **时间线渲染**: traj-weaver 风格，左侧色带区分角色 (coral=user, teal=assistant, amber=tool)

## 关键约定

- ECharts 5.6 CDN 渲染所有图表 (candlestick, line, bar, radar)
- 三窗格 K线布局: K线 38% + MACD 20% + 成交量 12% + 底部 dataZoom
- 所有曲线使用 `smooth: true` + `areaStyle` 渐变填充
- 图表内置 Chart/Raw 切换（图形 / 原始数据表）
- 雪球 (danjuanfunds.com) 和同花顺 (fund.10jqka.com.cn) 链接在 dock Sources 面板中自动生成
- 指标说明面板 (Indicator Glossary) 可折叠，解释 K线/MA/DIF/DEA/MACD/Vol 的全称和意义

## 使用

### 通过 CLI

```bash
whyj /artifact              # 为当前活跃 session 生成 artifact
whyj /artifact --title "我的分析"  # 自定义标题
```

### 通过 API

```ts
import { generateArtifact } from "./src/artifact/src/generator.ts";

const result = generateArtifact({ sessionPath: ".ohquant/sessions/xxx/session.jsonl" });
if (result) {
  // result.html  — 完整的自包含 HTML 文档
  // result.title — 自动检测或自定义标题
  // result.sessionId
  // result.messageCount
}
```

### 生成测试 Artifact

```bash
bun run src/artifact/test/gen-kline.test.ts       # SMH vs SOX
bun run src/artifact/test/gen-kc50.test.ts        # 科创50
bun run src/artifact/test/gen-fund.test.ts        # 机器人ETF
bun run src/artifact/test/gen-sst-all.test.ts     # 批量 7 只半导体基金
```

## 测试

```bash
bun test src/artifact/test/generator.test.ts
```
