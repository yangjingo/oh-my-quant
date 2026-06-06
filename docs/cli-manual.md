# WhyJ Quant CLI — Command Manual (v2)

> last-updated: 2026-06-06

## Quick Start

```bash
bun install
bun run src/index.ts          # Interactive frame-buffer TUI
whyj -c "/data download --symbol 000001.SZ"   # One-shot
whyj --json doctor             # Config check
```

Global: `npm i -g whyj-quant` then `whyj`

## TUI Layout

Full-screen docked layout (r2 frame-buffer): header, conversation (left), Portfolio panel (right, persistent dock), composer (bottom), status bar. See `docs/tui-layout-design.md`.

## Two Modes

| Mode | How | Example |
|------|-----|---------|
| Slash Command | `/` prefix | `/data download --symbol 000001.SZ` |
| AI Agent | Natural language | `analyze AAPL momentum factor` |

## Slash Commands

### `/data` — Data Download & Info

```
/data download --symbol 000001.SZ [--market A|US|HK]
/data info --symbol CODE
```

- A-share → calls `tushare_daily` via MCP, caches to `.ohquant/data/tushare/{symbol}/`
- US → calls `llmquant_price` via MCP
- Info shows cached bars summary + snapshot from MCP

### `/factor` — Factor Analysis

```
/factor list
/factor analyze --symbol CODE --factor momentum [--period 20]
```

Factors: `momentum`, `reversal`, `volatility`, `volume_ratio`, `rsi`, `sma_deviation`

### `/backtest` — SMA Crossover Backtest

```
/backtest run --symbol CODE [--fast 20] [--slow 60] [--cash 100000]
```

Output: total return, CAGR, Sharpe, max drawdown, win rate, P/L ratio.

### `/risk` — Risk Metrics

```
/risk check --symbol CODE
```

Output: annual vol, VaR(95/99), CVaR(95/99), max drawdown duration, skewness, kurtosis.

### `/benchmark` — Strategy Scoring

```
/benchmark run --symbol CODE [--benchmark-symbol 000300.SH] [--fast 20] [--slow 60]
/benchmark dashboard
```

Scoring: Return 40 + Risk 40 + Robustness 20 = 100. Grades: S≥80, A≥60, B≥40, C≥20, D<20.

### `/skill` — Skill Management

```
/skill                          List all 12 skills
/skill info --name NAME         Show skill details
/skill trigger --name NAME --code CODE   Execute directly
```

Skills include all MCP data tools and computation tools.

### `/claw` — Stock Snapshot

```
/claw --code 000001.SZ [--market A|US]
```

Shows company name, close price, PE, PB, market cap from MCP.

### `/add` `/watch` — Watchlist

```
/add stock --code CODE --name NAME
/add list
/add remove --code CODE
/watch           Show watchlist
/watch CODE      Add to watchlist
```

### System Commands

```
/help      Show command reference
/clear     Clear conversation + reset agent
/exit      Quit
/config    Open settings panel (API keys, model, thinking level)
/mcp       MCP server status
```

## AI Agent (Natural Language)

Type without `/` prefix. Agent has 12 tools available:

**Data tools (7):** `tushare_daily`, `tushare_stock_basic`, `tushare_fina_indicator`, `llmquant_price`, `fd_price`, `fd_snapshot`, `fd_company`

**Computation tools (5):** `compute_factor`, `run_backtest`, `check_risk`, `score_benchmark`, `show_dashboard`

Agent remembers context across turns (last symbol, market). Session saved to `.ohquant/sessions/`.

## Configuration

Single config file: `.ohquant/settings.json`

```json
{
  "env": { "WHYJ_AUTH_TOKEN": "sk-..." },
  "model": "sonnet",
  "thinkingLevel": "off"
}
```

Set API keys via `/config` panel. Keys stored in settings.json, read on every API call.

## Data Flow

```
User input
  ├─ /command → parseCommand() → executeCommand() → display
  └─ NL text → injectContext() → agent.prompt() → MCP tools / compute tools → display + cache

All market data cached: .ohquant/data/{source}/{symbol}/daily.json
Sessions: .ohquant/sessions/{date}/session-{time}.md
Benchmark: .ohquant/benchmark/results/*.json
```

## Tests

```bash
bun test src/     # 33 tests: session, context, commands
```
