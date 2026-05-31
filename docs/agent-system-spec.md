# WhyJ Quant — AI Agent 系统设计规范

## 1. 概述

本文档描述 `whyj quant` 交互式 CLI 的 AI Agent 子系统。Agent 负责理解用户自然语言意图、编排量化分析工具链、生成洞察，以及维护跨轮次会话上下文。

### 1.1 设计目标

| 目标 | 描述 |
|------|------|
| 自然语言驱动 | 用户说"分析一下平安银行最近动量"→ Agent 编排 `/data` → `/factor` |
| 多步编排 | Agent 自主决定步骤：发现缺数据→先拉数据→再算因子→再做回测 |
| 分析洞察 | 不只看数字，能解读因子含义、回测风险、给出改进建议 |
| 会话记忆 | 记住本次会话的 symbol、偏好参数，跨轮次复用 |
| 工具可扩展 | 新增 skill 只需注册 tool schema，Agent 自动发现并调用 |

### 1.2 参考项目

- **pi** (https://github.com/earendil-works/pi.git)：开源 Claude Code 替代品
  - 自建 Agent runtime，事件驱动架构
  - 两阶段工具执行：`beforeToolCall` → execute → `afterToolCall`
  - 双队列系统：steering（中轮注入）+ followUp（轮后注入）
  - AgentMessage 类型扩展通过 TypeScript declaration merging
  - 完整生命周期事件流：`agent_start` → `turn_start` → ... → `agent_end`

---

## 2. Agent 架构

### 2.1 总体架构图

```
┌──────────────────────────────────────────────────────────────┐
│                       Ink App (React)                         │
│  ┌─────────┐  ┌──────────────┐  ┌────────────────────────┐  │
│  │ Header  │  │ Conversation │  │ Input (autocomplete)   │  │
│  └─────────┘  └──────────────┘  └───────────┬────────────┘  │
│                                              │                │
│                                         用户输入              │
│                                              │                │
│  ┌───────────────────────────────────────────▼────────────┐  │
│  │                  AgentSession                          │  │
│  │  ┌─────────────┐  ┌──────────────┐  ┌──────────────┐  │  │
│  │  │ NL Parser   │  │ Agent.run()  │  │ Event Bus    │  │  │
│  │  │ (规则+LLM)  │→ │              │→ │ (AgentEvent) │  │  │
│  │  └─────────────┘  └──────┬───────┘  └──────┬───────┘  │  │
│  │                          │                  │           │  │
│  │          ┌───────────────▼──────────────────▼──┐        │  │
│  │          │         Agent Loop                  │        │  │
│  │          │  ┌──────────────────────────────┐   │        │  │
│  │          │  │ convertToLlm → Anthropic API │   │        │  │
│  │          │  └──────────────┬───────────────┘   │        │  │
│  │          │                 │                    │        │  │
│  │          │  ┌──────────────▼───────────────┐   │        │  │
│  │          │  │   Tool Execution Engine      │   │        │  │
│  │          │  │   prepare → execute → final  │   │        │  │
│  │          │  └──────────────────────────────┘   │        │  │
│  │          └─────────────────────────────────────┘        │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌───────────────────────────────────────────────────────┐  │
│  │                    Tool Layer                          │  │
│  │  ┌──────┐ ┌──────┐ ┌───────┐ ┌──────┐ ┌──────────┐  │  │
│  │  │ data │ │factor│ │bktest │ │ risk │ │portfolio │  │  │
│  │  └──┬───┘ └──┬───┘ └──┬────┘ └──┬───┘ └────┬─────┘  │  │
│  └─────┼────────┼────────┼─────────┼──────────┼─────────┘  │
│        │        │        │         │          │             │
│  ┌─────▼────────▼────────▼─────────▼──────────▼─────────┐  │
│  │              Data Layer                               │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌────────────┐  │  │
│  │  │ MCP Client   │  │ .ohquant/   │  │ Python     │  │  │
│  │  │ (tushare..)  │  │ (本地文件)   │  │ Bridge     │  │  │
│  │  └──────────────┘  └──────────────┘  └────────────┘  │  │
│  └───────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

### 2.2 核心概念

#### Agent（`Agent` 类）

pi 风格的带状态 agent 包装器。持有当前 transcript、暴露生命周期事件、管理双消息队列。

```typescript
// whyj/src/agent/agent.ts
class Agent {
  // 状态
  state: AgentState          // systemPrompt, model, tools, messages, etc.

  // 队列
  private steeringQueue       // 中轮注入（用户输入打断当前轮次）
  private followUpQueue       // 轮后注入（agent 停稳后的后续消息）

  // 核心方法
  async prompt(text: string): Promise<void>    // 发送用户输入
  async steer(text: string): Promise<void>     // 中轮注入
  async followUp(text: string): Promise<void>  // 轮后注入
  abort(): void                                // 取消当前运行
  subscribe(listener): () => void              // 事件订阅
  async waitForIdle(): Promise<void>           // 等待 agent 停稳
  reset(): void                                // 重置会话

  // Hook（可注入的行为）
  beforeToolCall?: (ctx) => Promise<BeforeToolCallResult | undefined>
  afterToolCall?: (ctx) => Promise<AfterToolCallResult | undefined>
  shouldStopAfterTurn?: (ctx) => Promise<boolean>
  prepareNextTurn?: (ctx) => Promise<AgentLoopTurnUpdate | undefined>
}
```

#### AgentEvent（生命周期事件）

```typescript
// whyj/src/agent/types.ts
type AgentEvent =
  | { type: 'agent_start' }
  | { type: 'turn_start' }
  | { type: 'message_start', message: AgentMessage }
  | { type: 'message_update', message: AgentMessage, delta: string }
  | { type: 'message_end', message: AgentMessage }
  | { type: 'tool_execution_start', toolCall: AgentToolCall }
  | { type: 'tool_execution_update', toolCall: AgentToolCall, output: string }
  | { type: 'tool_execution_end', toolCall: AgentToolCall, result: AgentToolResult }
  | { type: 'turn_end', message: AssistantMessage, toolResults: ToolResultMessage[] }
  | { type: 'agent_end', messages: AgentMessage[] }
  | { type: 'error', error: Error }
  | { type: 'abort' }
  | { type: 'settled' }
```

Ink 组件通过订阅这些事件来更新 UI（流式文本、工具执行进度、错误提示）。

#### AgentLoop（核心循环）

```typescript
// whyj/src/agent/loop.ts
async function runAgentLoop(
  prompts: AgentMessage[],
  context: AgentContext,
  config: AgentLoopConfig,
  emit: AgentEventSink,
  signal?: AbortSignal,
): Promise<AgentMessage[]>
```

两阶段循环：

1. **外层循环**：等待 follow-up 消息（agent 自然停止后）
2. **内层循环**：处理 tool calls + steering 消息（当前轮次内）

每轮执行流程：
```
[新的用户消息]
  → emit turn_start
  → streamAssistantResponse() → Anthropic API → 流式文本
  → 解析 tool_use blocks
  → 对每个 tool_use:
      → beforeToolCall() hook（可选阻止）
      → prepareArguments(tool, args) → 验证 + 补全默认值
      → execute(tool, args, signal) → 实际执行
      → afterToolCall() hook（可选覆写结果）
      → emit tool_execution_end
  → 将 tool_result 发回 LLM
  → LLM 可能返回更多 tool_use 或最终文本
  → emit turn_end
  → 检查 shouldStopAfterTurn()
  → 回到外层循环顶部
```

### 2.3 与 pi 的差异

| 维度 | pi | whyj quant |
|------|-----|------------|
| AI Provider | 25+ providers 通过 pi-ai 抽象 | **仅 Anthropic**，直接用 `@anthropic-ai/sdk` |
| TUI | 自建 `pi-tui` 库 | **Ink 5 + React 18** |
| 包管理 | npm workspaces | **Bun** |
| 运行环境 | Node >= 22.19 | **Bun >= 1.2** |
| 工具系统 | 通用文件/编辑/Shell 工具 | **量化专用**：data, factor, backtest, risk, benchmark, portfolio |
| 持久化 | JSONL session 文件 | `.ohquant/sessions/` 下 Markdown 文件 |
| 数据存储 | 无数据缓存需求 | `.ohquant/data/` 本地文件缓存 |
| MCP | 无需 MCP | **内建 MCP client** |

---

## 3. 包管理与运行时

### 3.1 Bun 配置

```toml
# whyj/bunfig.toml
[install]
production = false
frozen-lockfile = false

[install.cache]
# 项目本地缓存
dir = ".bun-cache"
```

### 3.2 package.json

```json
{
  "name": "whyj-quant",
  "version": "2.0.0",
  "type": "module",
  "scripts": {
    "dev": "bun run --watch src/index.ts",
    "build": "bun build src/index.ts --outdir dist --target bun",
    "start": "bun run dist/index.js",
    "typecheck": "bun run tsc --noEmit",
    "test": "bun test"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.91.0",
    "@modelcontextprotocol/sdk": "^1.0.0",
    "ink": "^5.0.0",
    "react": "^18.3.0",
    "commander": "^13.0.0",
    "chalk": "^5.4.0",
    "date-fns": "^3.0.0",
    "zod": "^3.24.0"
  },
  "devDependencies": {
    "@types/react": "^18.3.0",
    "typescript": "^5.7.0"
  }
}
```

---

## 4. Agent 工具系统

### 4.1 工具注册表

每个工具通过 Zod schema 定义参数，Agent 自动发现并注册：

```typescript
// whyj/src/tools/types.ts
import { z } from 'zod'

interface ToolSpec<TSchema extends z.ZodTypeAny> {
  name: string                    // 工具名称（LLM function name）
  description: string             // 给 LLM 的工具描述
  label: string                   // UI 显示标签
  schema: TSchema                 // Zod 参数 schema
  executionMode: 'sequential' | 'parallel'  // 执行策略
  execute: (args: z.infer<TSchema>, signal: AbortSignal) => Promise<ToolResult>
}

interface ToolResult {
  content: { type: 'text'; text: string }[]
  isError?: boolean
  details?: unknown  // 结构化数据，供 UI 渲染时使用
}
```

### 4.2 量化工具定义

```typescript
// whyj/src/tools/data-tools.ts
const fetchDailyBars = {
  name: 'fetch_daily_bars',
  description: '下载股票日线 OHLCV 数据并缓存到本地。支持 A 股、美股、港股。',
  label: '📥 下载数据',
  schema: z.object({
    symbol: z.string().describe('股票代码，如 000001.SZ 或 AAPL'),
    market: z.enum(['A', 'US', 'HK']).default('A'),
    start: z.string().optional().describe('起始日期 YYYY-MM-DD'),
    end: z.string().optional().describe('结束日期 YYYY-MM-DD'),
    source: z.enum(['auto', 'mcp', 'akshare']).default('auto'),
  }),
  executionMode: 'sequential',
  execute: async (args) => { /* ... */ },
} satisfies ToolSpec<typeof schema>

const searchSymbols = {
  name: 'search_symbols',
  description: '按名称或代码模糊搜索股票标的',
  label: '🔍 搜索',
  schema: z.object({
    keyword: z.string().describe('搜索关键词'),
    market: z.enum(['A', 'US', 'HK']).optional(),
  }),
  executionMode: 'sequential',
  execute: async (args) => { /* ... */ },
} satisfies ToolSpec<typeof schema>

// whyj/src/tools/factor-tools.ts
const computeFactor = {
  name: 'compute_factor',
  description: '计算单因子值（动量、反转、波动率、RSI、成交量比、均线偏离等）',
  label: '📊 因子分析',
  schema: z.object({
    symbol: z.string(),
    factor: z.enum(['momentum', 'reversal', 'volatility', 'volume_ratio', 'rsi', 'sma_deviation']),
    period: z.number().default(20),
    preprocess: z.enum(['none', 'winsorize', 'standardize']).default('none'),
  }),
  executionMode: 'sequential',
  execute: async (args) => { /* ... */ },
} satisfies ToolSpec<typeof schema>

// whyj/src/tools/backtest-tools.ts
const runBacktest = {
  name: 'run_backtest',
  description: '运行双均线交叉策略回测（SMA 快慢线）',
  label: '📈 回测',
  schema: z.object({
    symbol: z.string(),
    fast: z.number().default(20).describe('快线周期'),
    slow: z.number().default(60).describe('慢线周期'),
    cash: z.number().default(100000).describe('初始资金'),
    start: z.string().optional(),
    end: z.string().optional(),
    benchmark_symbol: z.string().optional(),
  }),
  executionMode: 'sequential',
  execute: async (args) => { /* ... */ },
} satisfies ToolSpec<typeof schema>

// whyj/src/tools/risk-tools.ts
const checkRisk = {
  name: 'check_risk',
  description: '计算风险指标：波动率、VaR、CVaR、最大回撤、偏度、峰度',
  label: '⚠️ 风险评估',
  schema: z.object({
    symbol: z.string(),
    start: z.string().optional(),
    end: z.string().optional(),
    benchmark_symbol: z.string().optional(),
  }),
  executionMode: 'sequential',
  execute: async (args) => { /* ... */ },
} satisfies ToolSpec<typeof schema>

// whyj/src/tools/benchmark-tools.ts
const runBenchmark = {
  name: 'run_benchmark',
  description: '运行策略评分（三维度：收益/风险/稳健性 100分制）',
  label: '🏆 策略评分',
  schema: z.object({
    symbol: z.string(),
    fast: z.number().default(20),
    slow: z.number().default(60),
    cash: z.number().default(100000),
    start: z.string().optional(),
    end: z.string().optional(),
    benchmark_symbol: z.string().default('000300.SH'),
    label: z.string().optional(),
  }),
  executionMode: 'sequential',
  execute: async (args) => { /* ... */ },
} satisfies ToolSpec<typeof schema>

// whyj/src/tools/portfolio-tools.ts
const capturePortfolio = {
  name: 'capture_portfolio',
  description: '抓取当前持仓基金净值',
  label: '💼 净值采集',
  schema: z.object({
    variant: z.enum(['v1', 'v2-semicon', 'v2-kc50']).default('v1'),
  }),
  executionMode: 'sequential',
  execute: async (args) => { /* ... */ },
} satisfies ToolSpec<typeof schema>
```

### 4.3 工具注册

```typescript
// whyj/src/tools/registry.ts
import type { ToolSpec } from './types'

class ToolRegistry {
  private tools = new Map<string, ToolSpec<any>>()

  register(tool: ToolSpec<any>): void {
    this.tools.set(tool.name, tool)
  }

  getAll(): ToolSpec<any>[] {
    return Array.from(this.tools.values())
  }

  getForLLM(): AnthropicTool[] {
    // 转换为 Anthropic tool_use 格式
    return this.getAll().map(t => ({
      name: t.name,
      description: t.description,
      input_schema: zodToJsonSchema(t.schema),
    }))
  }

  async execute(name: string, args: unknown, signal: AbortSignal): Promise<ToolResult> {
    const tool = this.tools.get(name)
    if (!tool) throw new Error(`Unknown tool: ${name}`)
    return tool.execute(tool.schema.parse(args), signal)
  }
}

// 单例
export const toolRegistry = new ToolRegistry()

// 注册所有工具
;[
  fetchDailyBars, searchSymbols,
  computeFactor, listFactors,
  runBacktest,
  checkRisk,
  runBenchmark, showDashboard,
  capturePortfolio, reviewPortfolio,
].forEach(t => toolRegistry.register(t))
```

---

## 5. System Prompt 设计

Agent 的 system prompt 定义了它的角色、可用工具、分析流程和输出风格：

```text
你是一个量化分析助手，运行在 WhyJ Quant 终端中。

## 你的能力
- 下载 A 股 / 美股 / 港股历史行情数据
- 计算技术因子：动量、反转、波动率、RSI、成交量比、均线偏离
- 运行双均线策略回测（SMA 快慢线交叉）
- 评估风险指标：VaR、CVaR、最大回撤、夏普比率
- 策略跑分：三维度评分（收益/风险/稳健性，100 分制）
- 管理个人基金组合：净值采集、回顾、生成看板

## 工作原则
1. **先检查数据**：执行分析前，确保所需数据已缓存；没有数据就先拉数据
2. **循序渐进**：数据 → 因子 → 回测 → 风险 → 评分，不要跳步
3. **解读结果**：不只报数字，用中文简短解读含义
4. **发现异常要追问**：比如动量 vs 反转背离、夏普异常高、最大回撤惊人
5. **记住上下文**：用户说"它"时，指最近提到的 symbol；省略参数时用上次的值

## 输出风格
- 严谨但易读，用表格展示关键数据
- 正收益/低风险用绿色 ✓，负收益/高风险用红色 ✗
- 每次分析结尾给一条 actionable 建议
```

### 5.1 动态 System Prompt 增强

运行时根据会话上下文动态注入附加指令：

```typescript
// whyj/src/agent/context.ts
function buildSystemPrompt(base: string, ctx: SessionContext): string {
  const parts = [base]

  // 注入当前上下文
  if (ctx.lastSymbol) {
    parts.push(`\n## 当前上下文\n- 上次使用的标的: ${ctx.lastSymbol}`)
  }
  if (ctx.portfolioVariant) {
    parts.push(`- 当前组合变体: ${ctx.portfolioVariant}`)
  }

  // 注入可用 MCP 数据源状态
  const mcpStatus = getMcpStatus()
  parts.push(`\n## 数据源状态\n- MCP: ${mcpStatus.connected.join(', ') || '无'}\n- 本地缓存: ${mcpStatus.cachedSymbols} 个标的`)

  return parts.join('\n')
}
```

---

## 6. 数据存储（本地文件）

### 6.1 目录结构

所有数据在项目根目录的 `.ohquant/` 下：

```
.ohquant/
├── config.json                  # 用户配置（API key 引用、偏好）
├── db/                          # SQLite 索引数据库（symbol 元信息、日期索引）
│   └── index.db
├── data/                        # 市场数据（按 source/symbol 组织）
│   ├── akshare/
│   │   ├── 000001_SZ/
│   │   │   ├── daily.parquet    # 日线数据 → Parquet 格式
│   │   │   └── meta.json        # { name, market, fetched_at, row_count }
│   │   └── ...
│   ├── yfinance/
│   │   └── AAPL/
│   │       ├── daily.parquet
│   │       └── meta.json
│   └── mcp-tushare/
│       └── ...
├── sessions/                    # 会话记录（Markdown 格式，人类可读）
│   ├── 2026-05-31/
│   │   └── session-143022.md
│   └── ...
├── portfolio/                   # 组合数据（沿用现有结构）
│   ├── holdings.json
│   ├── daily.json
│   └── nav_sampled.json
├── benchmark/                   # 跑分结果（沿用现有结构）
│   └── results/
│       └── *.json
└── cache/                       # 临时缓存（TTL 24h）
    └── ...
```

### 6.2 数据格式

**日线数据**：使用 **Parquet** 格式（比 CSV/JSON 更紧凑、带 schema、列式存储）：

```typescript
// whyj/src/storage/daily-bars.ts
import { readParquet, writeParquet } from '@dsnp/parquetjs'  // or parquet-wasm

interface BarRecord {
  date: string       // YYYY-MM-DD
  open: number
  high: number
  low: number
  close: number
  volume: number
  amount: number
  adj_close?: number
}

// 读取
async function loadBars(symbol: string, source: string): Promise<BarRecord[]> {
  const path = `.ohquant/data/${source}/${symbol}/daily.parquet`
  return readParquet(path)
}

// 写入（追加 + 去重）
async function saveBars(symbol: string, source: string, bars: BarRecord[]): Promise<void> {
  const existing = await loadBars(symbol, source).catch(() => [])
  const merged = dedupByDate([...existing, ...bars])
  const path = `.ohquant/data/${source}/${symbol}/daily.parquet`
  await writeParquet(path, merged)
  await updateMeta(symbol, source, { row_count: merged.length, fetched_at: new Date().toISOString() })
}
```

**元信息**：每个 symbol 一个 `meta.json`：

```json
{
  "symbol": "000001.SZ",
  "name": "平安银行",
  "market": "A",
  "source": "akshare",
  "first_date": "2019-01-02",
  "last_date": "2026-05-30",
  "row_count": 1798,
  "fetched_at": "2026-05-31T14:30:22Z"
}
```

**配置**：`.ohquant/config.json`：

```json
{
  "version": 1,
  "preferences": {
    "default_market": "A",
    "default_benchmark": "000300.SH",
    "default_cash": 100000,
    "default_fast": 20,
    "default_slow": 60,
    "portfolio_variant": "v1"
  },
  "mcp": {
    "enabled": true,
    "auto_connect": true
  },
  "anthropic": {
    "model": "claude-sonnet-4-6",
    "max_tokens": 4096,
    "thinking_level": "off"
  }
}
```

**会话记录**：`.ohquant/sessions/YYYY-MM-DD/session-HHMMSS.md`：

```markdown
# Session 2026-05-31 14:30:22

## 14:30:22 · User
分析一下平安银行的动量因子

## 14:30:25 · System
■ 检查本地缓存... 000001.SZ 已有数据（最新: 2026-05-30）

## 14:30:26 · System
| 指标 | 数值 |
|------|------|
| 因子 | momentum_20 |
| 最新值 | +0.0432 |
| 均值 | +0.0118 |
| 标准差 | 0.0521 |
| 分位数 | 78% |

动量因子当前处于历史中高位置（78分位），说明近期走势偏强。但需注意...

## 14:31:10 · User
跑个 20/60 回测看看

## 14:31:15 · System
■ SMA(20,60) 回测完成

| 指标 | 数值 |
|------|------|
| 累计收益 | +12.35% |
| CAGR | +5.82% |
| 夏普 | 0.71 |
| 最大回撤 | -18.23% |
```

### 6.3 数据源优先级

```
请求数据
  │
  ├─ 1. .ohquant/data/{source}/{symbol}/daily.parquet
  │     → 存在且 fresh（当日已取）→ 直接返回
  │     → 存在但 stale → 增量更新（仅拉缺失日期）
  │
  ├─ 2. MCP Server（已连接时）
  │     → tushare.daily（A 股）
  │     → llmquant-data.equity_historical_prices（美股）
  │     → financial-datasets.get_stock_prices（美股）
  │
  └─ 3. Python Bridge（fallback）
        → akshare（A 股）
        → yfinance（美股）
```

---

## 7. 自然语言处理

### 7.1 双层处理策略

```
用户输入
  │
  ├─ 以 / 开头 → 直接解析为 slash command（快速路径）
  │     /data download --symbol 000001.SZ
  │
  └─ 其他 → 发送给 Agent（LLM 路径）
        Agent 理解意图 → 调用工具 → 返回结果 + 解读
```

### 7.2 快速路径：Slash Commands

保留上一版设计的 slash commands，作为确定性操作：

```
/data download --symbol 000001.SZ --market A
/factor analyze --symbol 000001.SZ --factor momentum
/backtest run --fast 20 --slow 60
/risk check --symbol 000001.SZ
/benchmark run --symbol 000001.SZ
/benchmark dashboard
/portfolio capture
/portfolio review --days 14
/help
/clear
/exit
```

### 7.3 LLM 路径：自然语言

非 `/` 开头的输入全部交给 Agent：

```
用户: 帮我看看平安银行最近走势怎么样，算一下动量和波动率
  → Agent: search_symbols("平安银行") → 000001.SZ
  → Agent: fetch_daily_bars("000001.SZ", "A") (检查缓存，增量拉取)
  → Agent: compute_factor("000001.SZ", "momentum", 20)
  → Agent: compute_factor("000001.SZ", "volatility", 20)
  → Agent: 生成综合分析文本

用户: 用 10 天和 30 天均线回测一下
  → Agent: run_backtest("000001.SZ", fast=10, slow=30)  (复用上次 symbol)
```

### 7.4 Context 注入

每次 Agent 调用前，注入结构化上下文（不依赖 LLM 记忆）：

```typescript
function buildUserMessage(input: string, ctx: SessionContext): string {
  return [
    input,
    '',
    '<!-- 系统上下文（对用户不可见） -->',
    `last_symbol: ${ctx.lastSymbol ?? 'none'}`,
    `last_market: ${ctx.lastMarket ?? 'none'}`,
    `available_data: ${ctx.cachedSymbols.join(', ')}`,
    `preferred_benchmark: ${ctx.preferences.default_benchmark}`,
    `preferred_fast: ${ctx.preferences.default_fast}`,
    `preferred_slow: ${ctx.preferences.default_slow}`,
  ].join('\n')
}
```

---

## 8. Session 管理

### 8.1 SessionContext

```typescript
// whyj/src/agent/context.ts
interface SessionContext {
  // 跟踪状态
  lastSymbol: string | null
  lastMarket: 'A' | 'US' | 'HK' | null
  lastStartDate: string | null
  lastEndDate: string | null
  lastFastPeriod: number
  lastSlowPeriod: number
  portfolioVariant: 'v1' | 'v2-semicon' | 'v2-kc50'

  // 偏好
  preferences: UserPreferences

  // 缓存状态
  cachedSymbols: string[]
  mcpConnected: string[]

  // 会话消息
  messages: AgentMessage[]
}
```

### 8.2 会话持久化

每次 `agent_end` 事件时，自动将会话保存为 `.ohquant/sessions/{date}/session-{time}.md`。

启动时可恢复上次会话（通过 `--resume` 或交互式选择）。

---

## 9. Ink 组件与 Agent 集成

### 9.1 事件 → UI 映射

```typescript
// whyj/src/app.tsx
function App() {
  const { agent, session } = useAgent()

  useEffect(() => {
    const unsub = agent.subscribe((event) => {
      switch (event.type) {
        case 'message_update':
          // 更新流式文本渲染
          setStreamingText(prev => prev + event.delta)
          break
        case 'tool_execution_start':
          // 显示进度指示器
          setActiveTool({ name: event.toolCall.name, status: 'running' })
          break
        case 'tool_execution_end':
          // 工具完成，显示结果组件
          setActiveTool({ name: event.toolCall.name, status: 'done', result: event.result })
          break
        case 'message_end':
          // 最终消息，渲染 Markdown
          appendMessage(event.message)
          setStreamingText('')
          break
        case 'error':
          // 显示错误横幅
          showError(event.error.message)
          break
      }
    })
    return unsub
  }, [agent])

  // ... render
}
```

### 9.2 消息渲染

不同类型的消息用不同 Ink 组件：

| 消息内容 | 组件 |
|---------|------|
| 纯文本 | `<Text>` |
| 流式文本 | `<Text>` + 光标闪烁 |
| Markdown 表格 | `<Table>` |
| KPI 卡片 | `<Box borderStyle="single">` 内 `<Text>` |
| 工具执行中 | `<Spinner>` + tool label |
| 工具结果 | `<ToolResultCard>` |
| 错误 | `<Text color="red">` |
| 代码块 | `<Box>` + 灰色背景 |

---

## 10. 实施阶段

### Phase 0: 基础设施（已完成设计）
- [x] 技术方案文档（docs/interactive-cli-design.md）
- [x] Agent 系统设计（本文档）

### Phase 1: 项目脚手架（Week 1）
- [ ] `whyj/` 目录初始化：bun init, tsconfig, Ink 基础渲染
- [ ] Agent 核心类 + 事件系统 + 循环
- [ ] Anthropic SDK 集成（单轮对话验证）
- [ ] `.ohquant/` 目录结构创建
- [ ] 配置加载 + Config UI 组件

### Phase 2: 工具 & 数据（Week 2-3）
- [ ] ToolRegistry + Zod schema 工具注册
- [ ] MCP Client 封装 + 配置加载
- [ ] 本地文件存储层（Parquet + meta.json）
- [ ] 6 个量化工具的 tool spec + execute 实现
- [ ] Python Bridge（child_process 调用现有脚本）

### Phase 3: Agent 集成（Week 4）
- [ ] System prompt + 动态上下文注入
- [ ] 多轮对话 + 工具编排
- [ ] Session 持久化（Markdown 会话记录）
- [ ] 流式渲染 + 工具执行进度 UI

### Phase 4: 命令系统（Week 5）
- [ ] Slash command parser → 直接执行（快速路径）
- [ ] NL → Agent（慢速路径）
- [ ] 命令历史 + 自动补全
- [ ] Session 恢复功能

### Phase 5: 打磨 & 发布（Week 6）
- [ ] 错误处理 + 超时 + 重试
- [ ] 颜色系统对齐 DESIGN.md
- [ ] 性能优化（启动速度、首次 token 延迟）
- [ ] 安装脚本 + bun link 全局注册

---

## 11. 关键依赖

```json
{
  "dependencies": {
    "@anthropic-ai/sdk": "^0.91.0",
    "@modelcontextprotocol/sdk": "^1.0.0",
    "ink": "^5.0.0",
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "commander": "^13.0.0",
    "chalk": "^5.4.0",
    "date-fns": "^3.0.0",
    "zod": "^3.24.0",
    "parquet-wasm": "^0.6.0"
  },
  "devDependencies": {
    "@types/react": "^18.3.0",
    "typescript": "^5.7.0",
    "@types/bun": "^1.2.0"
  }
}
```

---

## Appendix: Anthropic SDK 关键用法

### 流式调用 + Tool Use

```typescript
import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

async function* streamWithTools(messages: Message[], tools: Tool[]) {
  const stream = client.messages.stream({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    system: buildSystemPrompt(),
    messages,
    tools,
    // thinking: { type: 'enabled', budget_tokens: 2000 },  // optional
  })

  for await (const event of stream) {
    switch (event.type) {
      case 'content_block_delta':
        if (event.delta.type === 'text_delta') {
          yield { type: 'text', text: event.delta.text }
        }
        if (event.delta.type === 'input_json_delta') {
          yield { type: 'tool_input', partial_json: event.delta.partial_json }
        }
        break
      case 'content_block_start':
        if (event.content_block.type === 'tool_use') {
          yield { type: 'tool_use_start', id: event.content_block.id, name: event.content_block.name }
        }
        break
      case 'content_block_stop':
        yield { type: 'block_end' }
        break
      case 'message_stop':
        yield { type: 'message_end', usage: event.message.usage }
        break
    }
  }
}
```
