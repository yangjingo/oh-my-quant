# Built-in Quant Tools Design

> last-updated: 2026-06-16

Quant analysis is exposed to the agent as built-in tools, not slash commands. Users should ask in natural language; the agent decides when to call data tools first and then call the relevant Quant tool.

## 1. Boundary

Slash commands are reserved for local UI/session actions such as `/help`, `/config`, `/portfolio`, `/resume`, `/compact`, and `/clear`.

Quant workflows are agent tools:

| Conversation label | Tool name | Purpose |
|--------------------|-----------|---------|
| `Quant.Factor` | `compute_factor` | Compute one technical factor for a symbol. |
| `Quant.Backtest` | `run_backtest` | Run SMA crossover strategy backtest. |
| `Quant.Risk` | `check_risk` | Compute return-distribution and drawdown risk metrics. |
| `Quant.Benchmark` | `score_benchmark` | Score a strategy against a benchmark and save a result artifact. |
| `Quant.Dashboard` | `show_dashboard` | Read saved benchmark artifacts and show ranked summaries. |

The TUI should render these as tool calls in the Conversation panel using the names above, for example:

```text
● Quant.Risk · 000300.SH
  ⎿ Annual vol 18.42% ...
```

## 2. Data Contract

`compute_factor`, `run_backtest`, and `check_risk` require cached daily bars. They call `loadCachedBars(symbol)`, which searches cache sources in this order:

1. `akshare`
2. `tushare`
3. `llmquant-data`
4. `financial-datasets`

If no cached bars exist, the tool returns `DATA_NO_CACHE` and the agent should call `fetch_bars` first. The preferred agent flow is:

```text
fetch_bars -> Quant.Factor / Quant.Backtest / Quant.Risk
```

`score_benchmark` is different: it first uses cached bars when available, otherwise fetches local bars for both strategy symbol and benchmark symbol, aligns dates, evaluates the strategy, and writes a benchmark result artifact.

`show_dashboard` does not fetch market data. It only reads `.ohquant/benchmark/results/*.json`.

## 3. Tool Specs

### `compute_factor`

Inputs:

| Field | Required | Default | Notes |
|-------|----------|---------|-------|
| `symbol` | Yes | - | Market symbol. |
| `factor` | Yes | - | One of `momentum`, `reversal`, `volatility`, `volume_ratio`, `rsi`, `sma_deviation`. |
| `period` | No | `20` | Lookback window. |

Output text:

- symbol and factor window
- cache source
- latest factor value
- historical mean
- percentile rank

Details object includes `symbol`, `factor`, `period`, `last`, `mean`, and `percentile`.

### `run_backtest`

Inputs:

| Field | Required | Default | Notes |
|-------|----------|---------|-------|
| `symbol` | Yes | - | Market symbol. |
| `fast` | No | `20` | Fast SMA window. |
| `slow` | No | `60` | Slow SMA window. |
| `cash` | No | `100000` | Starting cash. |
| `start` | No | - | Reserved for date filtering. |
| `end` | No | - | Reserved for date filtering. |

Precondition: cached bars must contain at least `slow + 10` rows.

Output text:

- total return
- CAGR
- Sharpe
- max drawdown
- win rate
- P/L ratio

Details object includes `symbol` and the report metrics.

### `check_risk`

Inputs:

| Field | Required | Default | Notes |
|-------|----------|---------|-------|
| `symbol` | Yes | - | Market symbol. |
| `start` | No | - | Reserved for date filtering. |
| `end` | No | - | Reserved for date filtering. |

Output text:

- annualized volatility
- downside volatility
- historical and parametric VaR 95
- VaR 99
- CVaR 95
- max drawdown and drawdown duration
- skewness and kurtosis

Details object includes `symbol` and all risk metrics.

### `score_benchmark`

Inputs:

| Field | Required | Default | Notes |
|-------|----------|---------|-------|
| `symbol` | Yes | - | Strategy symbol. |
| `benchmark_symbol` | No | `000300.SH` | Benchmark symbol. |
| `fast` | No | `20` | Fast SMA window. |
| `slow` | No | `60` | Slow SMA window. |
| `cash` | No | `100000` | Starting cash. |
| `label` | No | `sma_<fast>_<slow>` | Artifact strategy label. |

Behavior:

1. Infer market for strategy and benchmark symbols.
2. Fetch local bars for both symbols.
3. Align bars by date.
4. Run SMA strategy.
5. Split data into train/test windows for robustness scoring.
6. Score return, risk, and robustness on a 100-point scale.
7. Save JSON under `.ohquant/benchmark/results/`.

Output text includes grade, total score, component scores, CAGR, Sharpe, max drawdown, and saved filename.

Details object includes `filename` and the benchmark score object.

### `show_dashboard`

Inputs:

| Field | Required | Default | Notes |
|-------|----------|---------|-------|
| `sort_by` | No | - | Reserved: `score`, `cagr`, or `sharpe`. Current implementation ranks by total score. |

Behavior:

1. Read `.ohquant/benchmark/results/*.json`.
2. Build dashboard rows.
3. Compute total evaluations, average score, median score, best strategy, and grade distribution.
4. Display top 10 rows.

If no artifacts exist, the tool returns a natural-language hint asking the user to run a benchmark analysis first.

## 4. Storage Effects

| Tool | Reads | Writes |
|------|-------|--------|
| `compute_factor` | `.ohquant/data/{source}/{symbol}/` | None |
| `run_backtest` | `.ohquant/data/{source}/{symbol}/` | None |
| `check_risk` | `.ohquant/data/{source}/{symbol}/` | None |
| `score_benchmark` | cached bars first, then market data through source adapters | `.ohquant/benchmark/results/*.json` |
| `show_dashboard` | `.ohquant/benchmark/results/*.json` | None |

All local filesystem activity should emit storage file events so the Conversation tool-call stream can display READ/WRITE/MKDIR activity consistently.

## 5. Agent Usage Rules

- Do not expose these tools as slash commands.
- Prefer natural-language prompts for Quant work.
- Fetch bars before factor, backtest, or risk tools when cache is missing or stale.
- Use `score_benchmark` when the user asks for strategy scoring, ranking, grading, or benchmark comparison.
- Use `show_dashboard` when the user asks for saved benchmark results or a strategy leaderboard.
- Keep personal portfolio holdings out of `.ohquant/portfolio/`; portfolio storage rules are separate from Quant tool artifacts.
