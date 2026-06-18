# Skills

23 built-in skills in `.agents/skills/`. Auto-discovered at runtime via SKILL.md convention.  
Use `/skill` to list, `/skill:name` to invoke.

## References

| Source | URL |
|---|---|
| LLMQuant Skills | <https://github.com/LLMQuant/skills> |
| Claude Trading Skills | <https://github.com/tradermonty/claude-trading-skills> |

---

## LLMQuant (18) — `project` scope

Data-grounded quant workflows. Each is a **router skill**: routes natural-language intent to the correct LLMQuant MCP data primitive.

### Macro + Regime

```
market-environment-analysis ──── global cross-asset environment reporting
llmquant-macro ───────────────── Fed, central-bank, inflation, growth, liquidity
llmquant-market-intelligence ─── sentiment dashboards, event probability signals
macro-regime-detector ────────── structural regime transitions (1-2yr horizon)
```

| Skill | Trigger |
|---|---|
| `market-environment-analysis` | Global markets, risk-on/off, sector analysis, forex, commodities |
| `llmquant-macro` | Macro dashboards, Fed/central-bank previews, inflation, GDP, liquidity |
| `llmquant-market-intelligence` | Market sentiment, event probability, macro views |
| `macro-regime-detector` | Regime shift, concentration/broadening, yield curve, sector rotation |

### Equities + Derivatives

```
llmquant-equities ────────────── stock analysis, comparison, research memos
llmquant-equity-derivatives ──── convertibles, warrants, structured payoffs
llmquant-etfs ────────────────── holdings, overlap, concentration, theme exposure
llmquant-events ──────────────── earnings, M&A, catalysts, regulatory risk
llmquant-options ─────────────── IV rank, Greeks, strategy construction, P&L sim
```

| Skill | Trigger |
|---|---|
| `llmquant-equities` | Stock analysis, equity comparison, merger-arb, sell/take-profit |
| `llmquant-equity-derivatives` | Convertible, warrant, structured payoff, hybrid security |
| `llmquant-etfs` | ETF holdings, overlap, concentration, issuer snapshot |
| `llmquant-events` | Earnings briefs, M&A tracking, catalysts, event calendars |
| `llmquant-options` | IV rank, option scoring, Greeks, vol surface, earnings IV crush |

### Portfolio + Risk

```
llmquant-portfolio ───────────── thesis tracking, watchlists, company profiles
llmquant-portfolio-lab ───────── exposure maps, what-if sims, virtual portfolios
llmquant-risk ────────────────── fear scoring, VIX regime, hedge design
llmquant-credit ──────────────── issuer credit, spreads, high-yield, covenants
```

| Skill | Trigger |
|---|---|
| `llmquant-portfolio` | Thesis tracking, theme research, watchlist monitoring, alerts |
| `llmquant-portfolio-lab` | Exposure maps, what-if simulations, scenario states |
| `llmquant-risk` | Fear scoring, VIX regime, hedge design, research health checks |
| `llmquant-credit` | Credit review, spread regime, high-yield stress, default risk |

### Cross-Asset + Strategy

```
llmquant-crypto ──────────────── token research, perpetual funding, basis
llmquant-commodities ─────────── spot, futures curve, inventory, roll yield
llmquant-rates-fx ────────────── yield curve, duration, FX carry, real-rate
llmquant-prediction-markets ──── event odds, probability gaps, arbitrage
llmquant-data ────────────────── SEC filings, 13F holders, macro snapshots
llmquant-strategies ──────────── L/S, event-driven, macro, quant playbooks
```

| Skill | Trigger |
|---|---|
| `llmquant-crypto` | Crypto regime, token research, funding rate, leverage |
| `llmquant-commodities` | Commodity spot, futures curve, inventory, roll yield |
| `llmquant-rates-fx` | Yield curve, duration, central-bank divergence, FX carry |
| `llmquant-prediction-markets` | Event odds, settlement criteria, probability gaps |
| `llmquant-data` | SEC filings, 13F, macro snapshots, source-grounded briefs |
| `llmquant-strategies` | Equity L/S, event-driven, macro, quant, multi-strategy playbooks |

### Meta

```
llmquant-investor-lenses ─────── reasoning overlays grounded in LLMQuant Data
```

| Skill | Trigger |
|---|---|
| `llmquant-investor-lenses` | Investor-style reasoning overlay, evidence-grounded analysis |

---

## Trading (5) — `project` scope

No paid API required for these five.

### Daily Workflow

```
market-breadth-analyzer ──────── breadth health scoring (0-100 composite)
market-environment-analysis ──── global cross-asset environment (see also LLMQuant section above)
macro-regime-detector ────────── structural regime transitions (1-2yr horizon)
```

| Skill | Trigger | Output |
|---|---|---|
| `market-breadth-analyzer` | Market breadth, participation, advance-decline health | 0-100 composite score across 6 components |
| `market-environment-analysis` | Global markets, risk-on/off, sector rotation | Multi-market environment report |
| `macro-regime-detector` | Regime shift, concentration, yield curve | Regime state classification |

### Trade Planning

```
technical-analyst ────────────── chart-driven TA, trend, support/resistance
position-sizer ───────────────── risk-based size calculation
```

| Skill | Trigger | Output |
|---|---|---|
| `technical-analyst` | Chart images, trend analysis, support/resistance | Scenario plans, probability assessments |
| `position-sizer` | Position sizing, shares to buy, ATR-based sizing | Share count, risk per trade, sector checks |

---

## Skill Graph

```
                    ┌─────────────────────────────┐
                    │   market-environment-analysis │  ← global cross-asset
                    └──────────────┬──────────────┘
                                   │ feeds into
          ┌────────────────────────┼────────────────────────┐
          ▼                        ▼                        ▼
┌─────────────────┐    ┌─────────────────────┐    ┌─────────────────┐
│ macro-regime-   │    │ llmquant-macro      │    │ llmquant-market-│
│ detector        │    │                     │    │ intelligence    │
└────────┬────────┘    └──────────┬──────────┘    └────────┬────────┘
         │                        │                        │
         ▼                        ▼                        ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Portfolio Decision Layer                     │
│  llmquant-portfolio  llmquant-portfolio-lab  llmquant-risk      │
│  llmquant-credit     llmquant-strategies     position-sizer     │
└─────────────────────────────────────────────────────────────────┘
         │                        │                        │
         ▼                        ▼                        ▼
┌─────────────────────────────────────────────────────────────────┐
│                       Execution + Instruments                    │
│  llmquant-equities   llmquant-etfs    llmquant-options          │
│  llmquant-crypto     llmquant-commodities  llmquant-rates-fx    │
│  llmquant-equity-derivatives  llmquant-prediction-markets       │
└─────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
                    ┌─────────────────────────────┐
                    │   llmquant-events           │  ← catalysts + calendar
                    │   llmquant-data             │  ← SEC filings + 13F
                    │   llmquant-investor-lenses  │  ← reasoning overlay
                    └─────────────────────────────┘
```

### Typical invocation chain

```
/skill:market-environment-analysis  →  global posture
/skill:macro-regime-detector        →  regime state
/skill:llmquant-portfolio           →  position review
/skill:position-sizer               →  size next trade
```

### No-API starter path

These five work without paid API keys:

```
market-breadth-analyzer  →  breadth composite (public CSV)
technical-analyst        →  chart-driven TA (user provides images)
position-sizer           →  pure calculation (no data needed)
macro-regime-detector    →  cross-asset ratio analysis
market-environment-analysis →  multi-market reporting (needs web search)
```
