# WhyJ Quant CLI — Command Manual

## Quick Start

```bash
bun install
bun run src/index.ts
```

Or after global install:

```bash
npm i -g whyj-quant
whyj
```

## Two Modes

| Mode | How | Example |
|------|-----|---------|
| **Slash Command** | `/` prefix | `/claw --code 000001.SZ` |
| **AI Agent** | Natural language | `"分析平安银行的动量因子"` |

The AI Agent uses Claude (via Anthropic API) to understand intent and call tools step-by-step.

---

## Slash Commands

### `/skill` — Skill Management & Execution

Skills are the building blocks of WhyJ Quant. Each skill is a registered AgentTool that can be used by the AI Agent or triggered directly.

```
/skill list                              List all available skills
/skill list --category factor            Filter by category
/skill info --name fetch_bars            Show skill details
/skill trigger --name fetch_bars --code 000001.SZ   Execute directly
```

**Subcommands:**

| Command | Description |
|---------|-------------|
| `list` | Show all installed skills |
| `info --name N` | Show details for a specific skill |
| `trigger --name N [--flags]` | Execute a skill directly (bypass AI Agent) |
| `install --name N` | Install a new skill (from community or custom) |

**Built-in Skills:**

| Skill | Category | Description |
|-------|----------|-------------|
| `fetch_bars` | data | Download OHLCV price data for any symbol |
| `compute_factor` | factor | Compute momentum, reversal, volatility, RSI, SMA deviation |
| `run_backtest` | backtest | SMA crossover backtest with full metrics |
| `check_risk` | risk | VaR, CVaR, max drawdown, Sharpe, skewness, kurtosis |
| `score_benchmark` | benchmark | 3-dimension strategy evaluation (100-point scale) |
| `show_dashboard` | benchmark | Aggregated benchmark results viewer |

**Direct trigger examples:**

```bash
/skill trigger --name fetch_bars --code 000001.SZ --market A
/skill trigger --name compute_factor --code 000001.SZ --factor momentum --period 20
/skill trigger --name run_backtest --code 000001.SZ --fast 20 --slow 60
/skill trigger --name check_risk --code 000001.SZ
```

Adding a custom skill:
1. Create `src/tools/my-skill.ts` following the `AgentTool` pattern
2. Register in `src/tools/quant-tools.ts` `QUANT_TOOLS` array
3. Add to `BUILTIN_SKILLS` in `src/commands/registry.ts`

---

### `/claw` — Stock / Fund Snapshot

Fetch real-time information for a stock or fund via MCP data sources.

```
/claw --code 000001.SZ              A-share snapshot
/claw --code AAPL --market US       US stock snapshot
/claw --code 600519.SH              Kweichow Moutai
```

**Flags:**

| Flag | Default | Description |
|------|---------|-------------|
| `--code`, `-c` | (required) | Stock code (e.g. 000001.SZ, AAPL) |
| `--market`, `-m` | `A` | Market: `A` (A-share), `US`, `HK` |

**Output:** Company name, sector/industry, latest close price, PE/PB ratios, market cap.

**Data sources:**
- A-share → tushare MCP (`stock_basic` + `daily_basic`)
- US → financial-datasets MCP (`get_company_facts` + `get_financial_metrics_snapshot`)

---

### `/add` — Watchlist Management

Maintain a personal stock watchlist at `.ohquant/watchlist.json`.

```
/add stock --code 000001.SZ --name 平安银行     Add A-share
/add stock --code AAPL --market US --name Apple  Add US stock
/add list                                        Show all
/add remove --code 000001.SZ                     Remove
```

**Flags:**

| Flag | Default | Description |
|------|---------|-------------|
| `--code`, `-c` | (required) | Stock code |
| `--name`, `-n` | code | Display name |
| `--market`, `-m` | `A` | Market |

**Subcommands:**

| Command | Description |
|---------|-------------|
| `stock` | Add a stock to watchlist |
| `list` | Show current watchlist |
| `remove` | Remove a stock by code |

---

### `/benchmark` — Strategy Scoring

View benchmark results for portfolio strategies.

```
/benchmark                   Latest portfolio benchmark summary
/benchmark dashboard         Full results ranking (top 10)
```

**Data:** `.ohquant/benchmark/results/*.json`

The AI agent can run new benchmarks:
> "Run SMA 20/60 backtest on 000001.SZ with 000300.SH as benchmark and score it"

**Scoring dimensions (100 points):**
- Return (40 pts): CAGR, excess return, positive month ratio
- Risk (40 pts): Sharpe, max drawdown, Calmar, CVaR
- Robustness (20 pts): Train/test consistency

| Grade | Score |
|-------|-------|
| S | ≥ 80 |
| A | ≥ 60 |
| B | ≥ 40 |
| C | ≥ 20 |
| D | < 20 |

---

### `/config` — Configuration Wizard

Set up LLM API keys, MCP data sources, and model preferences.

```
/config                          Show setup guide
/config show                     Show current configuration
/config model --model claude-sonnet-4-6    Set LLM model
/config thinking --level medium            Set thinking depth
```

**Supported models:**
- `claude-sonnet-4-6` (default, fast + capable)
- `claude-opus-4-7` (most capable)
- `claude-haiku-4-5` (fastest, cheapest)

**Thinking levels:** `off`, `minimal`, `low`, `medium`, `high`

**Environment variables (in `.env`):**

```bash
ANTHROPIC_API_KEY=sk-ant-...
TUSHARE_TOKEN=your_tushare_token
FINANCIAL_DATASETS_KEY=your_fd_key
LLMQUANT_API_KEY=your_llmquant_key
```

---

### `/mcp` — MCP Data Server Control

Connect to market data providers.

```
/mcp connect        Connect to all configured MCP servers
/mcp status         Show current connections
```

**Available MCP servers (from `.claude/mcp.json`):**

| Server | Data |
|--------|------|
| `tushare` | A-share stocks, funds, indices, futures, macro |
| `financial-datasets` | US stocks, fundamentals, SEC filings |
| `llmquant-data` | US stocks, ETFs, macro indicators, crypto |
| `alphavantage` | Global stocks, forex, technical indicators |

---

### `/help` `/clear` `/exit`

```
/help      Show command reference
/clear     Clear conversation history
/exit      Quit WhyJ Quant
```

---

## AI Agent (Natural Language)

Type without `/` prefix to chat with the AI agent. The agent has access to these tools:

| Tool | Function |
|------|----------|
| `fetch_bars` | Download OHLCV price data |
| `compute_factor` | Compute momentum, reversal, volatility, RSI, SMA deviation |
| `run_backtest` | Run SMA crossover backtest |
| `check_risk` | Compute VaR, CVaR, max drawdown, Sharpe |
| `score_benchmark` | 3-dimension strategy scoring |
| `show_dashboard` | View all benchmark results |

**Example conversations:**

```
Q > 下载平安银行最近2年数据，算一下动量因子
Q > Run a 20/60 SMA backtest on 000001.SZ and score it vs 000300.SH
Q > 我的持仓基金最近表现怎么样？
Q > What's the Sharpe ratio and max drawdown for 600519.SH?
```

The agent remembers context — after mentioning a stock, you can say "it" or omit the symbol.

---

## Data Flow

```
User input
  │
  ├─ /command → Parser → Handler → Direct execution
  │                              → MCP / local storage
  │
  └─ Natural language → Agent → Anthropic API
                               → Tool calls → MCP / local storage
                               → Response + analysis
```

All market data is cached in `.ohquant/data/` as JSON files. Benchmark results are stored in `.ohquant/benchmark/results/`.

---

## Directory Map

```
oh-my-quant/
├── .ohquant/
│   ├── config.json          # User preferences + LLM config
│   ├── watchlist.json       # /add watchlist
│   ├── data/                # Cached market data (by source/symbol)
│   ├── benchmark/results/   # Scored strategy results
│   └── sessions/            # Agent conversation history
├── .env                     # API keys (gitignored)
├── .claude/mcp.json         # MCP server definitions
└── src/                     # TypeScript source
    ├── agent/               # AI Agent (pi core + Anthropic shim)
    ├── tools/               # Agent tool definitions
    ├── commands/             # Slash command handlers
    ├── services/            # Pure computation (factor, backtest, risk, benchmark)
    ├── data/                # MCP client + data source adapters
    └── storage/             # .ohquant/ file operations
```
