# WhyJ Quant Interactive CLI — Design Document

## 1. Overview

将现有 `whyj-quant` 命令行工具改造为类似 Claude Code / Codex 的交互式 REPL CLI。

**核心理念**：终端即工作台。用户在单一会话中完成数据查询→因子分析→回测→风险检查→跑分看板的完整量化研究流程，无需反复退出重输命令。

### 1.1 目标体验

```
> whyj quant

  ╔══════════════════════════════════════════════╗
  ║  WhyJ Quant · interactive terminal           ║
  ║  data · factor · backtest · risk · benchmark ║
  ╚══════════════════════════════════════════════╝

  Type /help for commands.  Tab to autocomplete.

Q > /data download --symbol 000001.SZ --market A --period 2y

  ■ Downloading 000001.SZ daily bars via AKShare... 487 rows ✓
  ■ Cached to local db: bars_daily/000001.SZ

Q > /factor analyze --symbol 000001.SZ --factor momentum --period 20

  ┌─────────────────────────────────────────┐
  │  momentum_20 · 000001.SZ                │
  │  ─────────────────────────────────────  │
  │  Latest:   +0.0432                      │
  │  Mean:     +0.0118                      │
  │  Std:       0.0521                      │
  │  Min:      -0.1203                      │
  │  Max:      +0.0891                      │
  │  Percentile now:  78%                   │
  └─────────────────────────────────────────┘

Q > /backtest run --symbol 000001.SZ --fast 20 --slow 60

  ■ Running SMA(20,60) backtest...

  ┌──────────────────────────────────────────┐
  │  Backtest Result                         │
  │  ──────────────────────────────────────  │
  │  Total Return:    +12.35%                │
  │  CAGR:             +5.82%                │
  │  Sharpe:            0.71                 │
  │  Max Drawdown:    -18.23%                │
  │  Win Rate:         42.1%                 │
  │  Total Trades:     23                    │
  └──────────────────────────────────────────┘
```

### 1.2 与当前 CLI 的差异

| 维度 | 当前 whyj-quant | 新 whyj quant (交互式) |
|------|----------------|----------------------|
| 交互模式 | 一次性命令，退出返回 shell | REPL 持续会话 |
| 上下文 | 每命令独立，无记忆 | 会话上下文，记住上次 symbol/周期 |
| 输出 | 纯文本 print | Ink 组件渲染（表格、颜色、进度条） |
| 数据 | CSV/JSON 散落文件 | SQLite 统一存储 |
| MCP | 仅 Claude Code 可用 | CLI 内建 MCP client |
| Skill | Python 脚本 | Slash 命令 `/data` `/factor` 等 |
| 自动补全 | 无 | Tab 补全命令、参数、symbol |
| 自然语言 | 不支持 | 可选 NL→命令映射 |

---

## 2. Tech Stack

| 层 | 选型 | 理由 |
|---|------|------|
| Runtime | Node.js 22+ (TypeScript) | Ink 生态唯一 runtime |
| Terminal UI | **Ink 5** + React 18 | 声明式终端 UI，组件化 |
| CLI 框架 | **pastel** 或自建 | Ink 配套框架，处理输入循环 |
| 命令解析 | 自建 parser + commander | `/` 前缀识别命令；参数解析复用 commander 风格 |
| 数据存储 | **better-sqlite3** | 本地 SQLite，同步 API，零配置 |
| MCP Client | **@modelcontextprotocol/sdk** | 官方 SDK，连接现有 MCP servers |
| 数据获取 | 复用现有 Python SDK 或 HTTP API | 可 Phase 2 改为 Node 原生 |
| 自动补全 | 自建 (基于命令 schema) | 轻量，不依赖外部 |
| Markdown 渲染 | ink-markdown 或自建 | 表格、代码块、颜色 |

### 2.1 为什么不用 Python (Textual / Prompt Toolkit)

- Ink 组件模型更接近 React，组件复用性强
- MCP SDK 的 TypeScript 生态更成熟
- 单二进制分发（pkg / bun build）比 Python 打包简单
- 但：**现有 Python 数据处理逻辑保留**，通过子进程调用或逐步迁移

---

## 3. Architecture

```
┌─────────────────────────────────────────────────────┐
│                    whyj quant (Ink App)               │
│                                                       │
│  ┌─────────┐  ┌──────────┐  ┌────────────────────┐  │
│  │  Input  │  │ Parser   │  │  ConversationView  │  │
│  │ (ink)   │→ │ /command │→ │  (message history) │  │
│  └─────────┘  │ or NL    │  └────────────────────┘  │
│               └────┬─────┘                           │
│                    │ dispatch                         │
│         ┌──────────┼──────────┐                      │
│         ▼          ▼          ▼                      │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐             │
│  │ /data    │ │ /factor  │ │ /backtest│ ...          │
│  │ handler  │ │ handler  │ │ handler  │             │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘             │
│       │            │            │                    │
│       └────────────┼────────────┘                    │
│                    ▼                                 │
│  ┌─────────────────────────────────────┐            │
│  │           Service Layer              │            │
│  │  ┌────────┐ ┌────────┐ ┌─────────┐  │            │
│  │  │ Data   │ │ Factor │ │ Backtest│  │            │
│  │  │ Service│ │ Service│ │ Service │  │            │
│  │  └───┬────┘ └───┬────┘ └────┬────┘  │            │
│  └──────┼──────────┼───────────┼────────┘            │
│         │          │           │                      │
│         ▼          ▼           ▼                      │
│  ┌─────────────────────────────────────┐            │
│  │         Data Access Layer            │            │
│  │  ┌──────────┐  ┌─────────────────┐  │            │
│  │  │ SQLite   │  │  MCP Client     │  │            │
│  │  │ (cache)  │  │  (live fetch)   │  │            │
│  │  └──────────┘  └─────────────────┘  │            │
│  └─────────────────────────────────────┘            │
│                                                       │
│  ┌─────────────────────────────────────┐            │
│  │         Python Bridge (Phase 1)      │            │
│  │  child_process.spawn('python', ...)  │            │
│  └─────────────────────────────────────┘            │
└─────────────────────────────────────────────────────┘
```

### 3.1 目录结构

```
oh-my-quant/
├── cli/                          # (existing) Python CLI — 保留但标记 deprecated
├── whyj/                         # (new) Node.js interactive CLI
│   ├── package.json
│   ├── tsconfig.json
│   ├── src/
│   │   ├── index.ts              # 入口: bootstrap → render Ink app
│   │   ├── app.tsx               # <App> 根组件
│   │   ├── components/
│   │   │   ├── Header.tsx        # 顶部品牌栏
│   │   │   ├── Conversation.tsx  # 对话历史列表
│   │   │   ├── Message.tsx       # 单条消息 (user / system / error)
│   │   │   ├── Input.tsx         # 输入框 + autocomplete
│   │   │   ├── StatusBar.tsx     # 底部状态栏
│   │   │   ├── Markdown.tsx      # Markdown 渲染
│   │   │   ├── Table.tsx         # 表格渲染
│   │   │   ├── ProgressBar.tsx   # 进度条
│   │   │   └── Spinner.tsx       # 加载动画
│   │   ├── commands/
│   │   │   ├── registry.ts       # 命令注册表
│   │   │   ├── types.ts          # CommandSpec 类型定义
│   │   │   ├── data.ts           # /data download | search
│   │   │   ├── factor.ts         # /factor list | analyze
│   │   │   ├── backtest.ts       # /backtest run
│   │   │   ├── risk.ts           # /risk check
│   │   │   ├── benchmark.ts      # /benchmark run | dashboard
│   │   │   ├── portfolio.ts      # /portfolio capture | review | dashboard
│   │   │   ├── config.ts         # /config (MCP settings, etc.)
│   │   │   ├── help.ts           # /help
│   │   │   ├── clear.ts          # /clear
│   │   │   └── exit.ts           # /exit
│   │   ├── core/
│   │   │   ├── parser.ts         # 输入解析器 (区分 /command vs NL)
│   │   │   ├── executor.ts       # 命令执行调度
│   │   │   ├── context.ts        # SessionContext (记忆 last symbol, period等)
│   │   │   └── nlp.ts            # 自然语言 → 命令 映射 (Phase 2)
│   │   ├── services/
│   │   │   ├── data-service.ts   # 数据获取 + 缓存层
│   │   │   ├── factor-service.ts # 因子计算
│   │   │   ├── backtest-service.ts
│   │   │   ├── risk-service.ts
│   │   │   ├── benchmark-service.ts
│   │   │   └── portfolio-service.ts
│   │   ├── storage/
│   │   │   ├── db.ts             # SQLite 初始化 + schema
│   │   │   ├── migrations/       # Schema 迁移
│   │   │   └── repositories/     # 每种数据的 CRUD
│   │   ├── mcp/
│   │   │   ├── client.ts         # MCP Client 封装
│   │   │   ├── config.ts         # MCP 配置加载 (.claude/mcp.json)
│   │   │   ├── tool-registry.ts  # MCP tools → 内部接口
│   │   │   └── adapters/
│   │   │       ├── tushare.ts
│   │   │       ├── financial-datasets.ts
│   │   │       └── llmquant.ts
│   │   ├── bridge/
│   │   │   └── python.ts         # child_process 调用现有 Python 脚本
│   │   └── types/
│   │       ├── messages.ts       # Message, Command, Result 类型
│   │       ├── data.ts           # OHLCV, Bar, Symbol 类型
│   │       └── config.ts         # 配置类型
│   └── test/
├── benchmark/                    # (existing)
├── skills/                       # (existing)
└── docs/
    └── interactive-cli-design.md # ← 本文档
```

---

## 4. Ink Component Tree

```
<App>
  <Header
    brand="WhyJ Quant"
    version="2.0.0"
    mcpStatus={mcpConnected ? 'green' : 'red'}
  />
  <ConversationView>
    {messages.map(msg =>
      <Message
        role={msg.role}        // 'user' | 'system' | 'error'
        content={msg.content}  // string | ReactElement
        timestamp={msg.time}
      />
    )}
  </ConversationView>
  <Input
    prompt="Q > "
    onSubmit={handleInput}
    onAutocomplete={handleAutocomplete}
    history={inputHistory}
  />
  <StatusBar
    mode={currentMode}         // 'idle' | 'running' | 'error'
    symbol={lastSymbol}
    dataStatus={dataCacheInfo}
  />
</App>
```

### 4.1 关键交互

- **Tab 补全**：按 Tab 循环候选（命令→参数→symbol→值）
- **↑↓ 历史**：上下箭头浏览输入历史
- **Ctrl+C**：取消当前运行中的命令
- **Ctrl+D**：退出（等价 `/exit`）
- **滚动**：ConversationView 自动跟随最新消息

### 4.2 渲染能力

| 数据类型 | 渲染方式 |
|---------|---------|
| 纯文本 | `<Text>` 默认颜色 |
| 数字表格 | `<Table>` 对齐列，右对齐数字 |
| KPI 卡片 | `<Box borderStyle="single">` 边框卡片 |
| 进度 | `<ProgressBar>` 带百分比 |
| 错误 | `<Text color="red">` |
| 成功 | `<Text color="green">` |
| Markdown | 有限子集：标题、粗体、代码块、列表 |

---

## 5. Slash Command Spec

### 5.1 命令格式

```
/<command> <subcommand> [--flag VALUE] [--flag]
```

- 命令大小写不敏感
- 参数名用 `--kebab-case`
- 位置参数逐步废弃，统一用命名参数

### 5.2 完整命令列表

#### `/data` — 数据下载与查询

```
/data download --symbol <CODE> --market <A|US|HK> [--start YYYY-MM-DD] [--end YYYY-MM-DD] [--source auto|akshare|yfinance|mcp]
/data search --keyword <KW>
/data info --symbol <CODE>
```

- `download`: 拉取 OHLCV 日线数据并缓存至 SQLite
- `search`: 按名称/代码模糊搜索标的
- `info`: 显示标的当前快照（最新价、市值、PE 等）

**MCP 映射**：
- yfinance → Python bridge 或 `llmquant-data.equity_historical_prices`
- AKShare → Python bridge（Phase 1）
- 基本面 → `financial-datasets.get_financial_metrics_snapshot`

#### `/factor` — 单因子分析

```
/factor list
/factor analyze --symbol <CODE> --factor <NAME> [--period N]
```

- `list`: 列出可用因子（momentum, reversal, volatility, volume_ratio, rsi, sma_deviation）
- `analyze`: 计算因子值并展示统计分布（可选用 winsorize / standardize 预处理）

**输出**：因子当前值、均值、标准差、分位数、近期走势 Mini Sparkline

#### `/backtest` — 均线策略回测

```
/backtest run --symbol <CODE> --fast <N> --slow <N> [--cash AMT] [--start DATE] [--end DATE] [--benchmark CODE]
```

**输出**：回测摘要表 + 收益曲线 ASCII plot

#### `/risk` — 风险指标

```
/risk check --symbol <CODE> [--start DATE] [--end DATE] [--benchmark CODE]
```

**输出**：年化波动率、VaR(95/99)、CVaR、最大回撤及持续天数、偏度/峰度

#### `/benchmark` — 策略评分与看板

```
/benchmark run --symbol <CODE> [--fast N] [--slow N] [--cash AMT] [--start DATE] [--end DATE] [--benchmark-symbol CODE] [--label STR]
/benchmark dashboard [--sort-by score|cagr|sharpe] [--limit N]
```

- `run`: 跑分并保存 JSON 结果到 `benchmark/results/`
- `dashboard`: 汇总展示所有跑分结果排名

**输出**：跑分卡片（总分/等级/三维度得分），dashboard 为排名表

#### `/portfolio` — 基金组合看板

```
/portfolio capture
/portfolio review [--days N] [--variant v1|v2-semicon|v2-kc50]
/portfolio dashboard [--variant v1|v2-semicon|v2-kc50]
```

- `capture`: 抓取当日所有持仓基金净值
- `review`: 展示近期净值变动表
- `dashboard`: 生成完整看板 HTML

#### `/system` — 系统命令

```
/help [command]
/clear
/exit
/config show
/config set --key <KEY> --value <VALUE>
```

#### 自然语言映射（Phase 2）

| 自然语言 | 映射命令 |
|---------|---------|
| "下载平安银行最近2年数据" | `/data download --symbol 000001.SZ --market A --period 2y` |
| "分析平安银行的动量因子" | `/factor analyze --symbol 000001.SZ --factor momentum` |
| "跑一下 20/60 均线回测" | `/backtest run --fast 20 --slow 60` |
| "今天基金净值多少" | `/portfolio capture` + `/portfolio review` |

实现方式：小规则引擎 + symbol 别名表，不依赖 LLM（纯本地）。

---

## 6. MCP Integration

### 6.1 设计原则

MCP Server 作为一等数据源，与本地 SQLite 缓存形成两级架构：

```
User Command
    │
    ▼
DataService.getBars(symbol, start, end)
    │
    ├─ 1. 查 SQLite 缓存 → 命中则返回
    │
    └─ 2. 未命中 → MCP Client 调用 → 存入 SQLite → 返回
         │
         ├─ llmquant-data.equity_historical_prices  (US stocks)
         ├─ tushare.daily                            (A shares)
         └─ Python bridge → akshare/yfinance         (fallback)
```

### 6.2 MCP 配置复用

直接读取项目已有的 `.claude/mcp.json`，无需重复配置。首次启动时自动连接所有已配置的 MCP servers。

```
whyj/src/mcp/config.ts:
  1. 读取 .claude/mcp.json
  2. 对每个 server 建立 ClientSession
  3. 发现所有 tools 并注册到 ToolRegistry
  4. 暴露统一的 executeTool(server, tool, args) 接口
```

### 6.3 Tool Registry

```typescript
interface ToolRegistry {
  // 按数据类别查找可用工具
  findTools(category: 'price' | 'fundamental' | 'macro' | 'etf'): Tool[];
  // 执行具体工具
  execute(tool: Tool, args: Record<string, unknown>): Promise<unknown>;
  // 工具→内部格式转换
  normalize(tool: Tool, raw: unknown): Bar[] | Snapshot | Financials;
}
```

### 6.4 可用的 MCP Server 与数据映射

| MCP Server | Tools | 对应命令 |
|-----------|-------|---------|
| **tushare** | daily, stock_basic, fund_nav, fund_basic, index_daily, fina_indicator, moneyflow, macro_*, futures_*, cb_*, etf_* | `/data` (A 股全品类) |
| **financial-datasets** | get_stock_prices, get_income_statement, get_balance_sheet, get_financial_metrics_snapshot, get_company_facts, screen_stocks | `/data` (美股 + 基本面) |
| **llmquant-data** | equity_historical_prices, etf_holdings, etf_lookup, macro_indicator_*, sec_filing_*, crypto_* | `/data` (美股 + ETF + 宏观 + 加密货币) |

---

## 7. Local Storage

### 7.1 SQLite Schema

```sql
-- 标的信息
CREATE TABLE symbols (
  code       TEXT PRIMARY KEY,   -- e.g. '000001.SZ', 'AAPL'
  name       TEXT,
  market     TEXT,               -- 'A', 'US', 'HK'
  exchange   TEXT,
  type       TEXT,               -- 'stock', 'etf', 'index', 'fund'
  list_date  TEXT,
  delist_date TEXT,
  updated_at TEXT
);

-- 日线 OHLCV
CREATE TABLE bars_daily (
  symbol     TEXT NOT NULL,
  date       TEXT NOT NULL,      -- YYYY-MM-DD
  open       REAL,
  high       REAL,
  low        REAL,
  close      REAL,
  volume     REAL,
  amount     REAL,
  adj_close  REAL,
  source     TEXT,               -- 'akshare', 'yfinance', 'mcp-tushare', ...
  fetched_at TEXT,
  PRIMARY KEY (symbol, date)
);

-- 因子缓存
CREATE TABLE factor_cache (
  symbol     TEXT NOT NULL,
  factor     TEXT NOT NULL,      -- 'momentum_20', 'volatility_20', ...
  date       TEXT NOT NULL,
  value      REAL,
  computed_at TEXT,
  PRIMARY KEY (symbol, factor, date)
);

-- 回测记录
CREATE TABLE backtest_runs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol     TEXT NOT NULL,
  strategy   TEXT,               -- 'sma_20_60'
  params     TEXT,               -- JSON
  start_date TEXT,
  end_date   TEXT,
  result     TEXT,               -- JSON: full backtest output
  created_at TEXT
);

-- 基金净值
CREATE TABLE fund_nav (
  code       TEXT NOT NULL,
  date       TEXT NOT NULL,
  nav        REAL,
  acc_nav    REAL,
  daily_pct  REAL,
  fetched_at TEXT,
  PRIMARY KEY (code, date)
);

-- 配置
CREATE TABLE config (
  key        TEXT PRIMARY KEY,
  value      TEXT
);

-- 命令历史
CREATE TABLE command_history (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  input      TEXT NOT NULL,
  timestamp  TEXT NOT NULL
);
```

### 7.2 数据生命周期

```
MCP / Python Bridge → 原始数据
         │
         ▼
   normalizeBar() → 统一字段格式
         │
         ▼
   SQLite INSERT OR REPLACE (upsert)
         │
         ▼
   bars_daily 表 (永久缓存)
```

- **TTL 策略**：当日数据每次请求时刷新；历史数据永久缓存
- 提供 `/data refresh --symbol CODE` 强制更新
- 数据库文件：`whyj/data/whyj.db`

---

## 8. Session Context

每次会话维护一个轻量上下文对象，在命令之间传递共享状态：

```typescript
interface SessionContext {
  lastSymbol: string | null;       // 上次使用的 symbol
  lastMarket: 'A' | 'US' | null;  // 上次使用的市场
  lastStartDate: string | null;    // 上次的起始日期
  lastEndDate: string | null;      // 上次的结束日期
  lastFastPeriod: number;          // 上次的快线参数
  lastSlowPeriod: number;          // 上次的慢线参数
  portfolioVariant: string;        // 当前 portfolio 变体
  messages: Message[];             // 会话消息历史
}
```

上下文使得省略参数成为可能：
```
Q > /factor analyze --symbol 000001.SZ --factor momentum
  ... output ...

Q > /factor analyze --factor volatility   // 复用 --symbol 000001.SZ
```

---

## 9. Implementation Phases

### Phase 1: Core Shell (Week 1-2)

- [ ] 项目脚手架：package.json, TypeScript, Ink, 基础组件
- [ ] 输入解析器：`/command subcommand --flag value` 解析
- [ ] 命令注册表 + 执行调度
- [ ] `/help`, `/clear`, `/exit`
- [ ] 消息历史 + ConversationView
- [ ] Input 组件 + 基础键盘交互（Enter 提交，↑↓ 历史）

### Phase 2: Data Layer (Week 3)

- [ ] SQLite 初始化 + schema 迁移
- [ ] DataService：symbol 搜索 + bars 缓存查询
- [ ] Python Bridge：调用现有 akshare/yfinance 脚本
- [ ] `/data download` + `/data search`

### Phase 3: MCP Integration (Week 4)

- [ ] MCP Client 封装 + 配置加载
- [ ] Tool Registry + normalize 层
- [ ] 优先 MCP，fallback Python bridge
- [ ] StatusBar 显示 MCP 连接状态

### Phase 4: Core Commands (Week 5-6)

- [ ] FactorService + `/factor list | analyze`
- [ ] BacktestService + `/backtest run`
- [ ] RiskService + `/risk check`
- [ ] BenchmarkService + `/benchmark run | dashboard`

### Phase 5: Portfolio & Polish (Week 7-8)

- [ ] PortfolioService + `/portfolio capture | review | dashboard`
- [ ] SessionContext：省略参数智能复用
- [ ] 自动补全（Tab completion）
- [ ] Markdown/Table 渲染优化
- [ ] 颜色系统对齐 DESIGN.md (NewForm brutalist)

### Phase 6: Natural Language (Future)

- [ ] 中文 symbol 别名表（茅台 → 600519.SH）
- [ ] 规则引擎 NL→命令映射
- [ ] 可选 LLM 集成（本地模型或 API）

---

## 10. Migration from Current CLI

### 10.1 兼容策略

- 现有 Python CLI (`cli/main.py`) **保留但标记 deprecated**
- `whyj quant` 新命令作为主入口
- 现有 Python 脚本作为 bridge 继续可用
- `benchmark/results/*.json` 格式不变，新旧兼容

### 10.2 入口

```bash
# 新交互式模式
whyj quant

# 向后兼容：一次性命令模式（通过同一个 Node 入口）
whyj quant --one-shot "data download --symbol 000001.SZ"
```

### 10.3 安装

```bash
cd whyj && npm install && npm run build
npm link  # 全局注册 whyj 命令
```

---

## 11. Open Questions

1. **Python Bridge 范围**：Phase 1 复用所有 Python 计算逻辑 vs 逐步用 TypeScript 重写？建议先 bridge，稳定后按模块迁移。
2. **LLM 集成**：是否需要内置 LLM 做自然语言理解？Phase 6 之前不需要。
3. **跨平台**：Windows Terminal / macOS Terminal.app / iTerm2 / Warp 兼容性需逐一验证（Ink 对 Windows 有基本支持）。
4. **分发**：npm 全局安装 vs 独立二进制（bun build / pkg）？建议先 npm，成熟后二进制。
5. **现有 benchmark 数据迁移**：启动时自动将 CSV/JSON 导入 SQLite，去重。

---

## Appendix A: Color Scheme (from DESIGN.md)

```
Primary:    #121413  (near-black)
Accent:     #39E180  (mint green)
Canvas:     #F7F9F6  (light cream)
Surface:    #1E2220  (dark card)
Hairline:   #2C302E  (borders)
Muted:      #8C9490  (secondary text)
```

In Ink terminal colors:
- 绿色 (accent) 用于成功、正收益、进度条
- 红色 用于错误、负收益、风险警告
- 灰色 用于次要信息、时间戳
- 白色 用于主文本、标题

## Appendix B: Key Dependencies

```json
{
  "dependencies": {
    "ink": "^5.0.0",
    "react": "^18.3.0",
    "better-sqlite3": "^11.0.0",
    "@modelcontextprotocol/sdk": "^1.0.0",
    "commander": "^12.0.0",
    "chalk": "^5.3.0",
    "date-fns": "^3.0.0"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "@types/react": "^18.3.0",
    "@types/better-sqlite3": "^7.6.0",
    "tsx": "^4.0.0",
    "vitest": "^2.0.0"
  }
}
```
