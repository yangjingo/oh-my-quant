# Changelog

## [2.0.1] - 2026-06-01

### Added

- AKShare bridge for free A-share data (no API key needed)
- Graceful fallback chain: AKShare → tushare MCP → cached data
- Structured error system (12 error codes with problem + cause + fix)
- AI agent with natural language stock analysis (Anthropic SDK + pi agent core)
- Slash commands: `/claw`, `/skill`, `/benchmark`, `/config`, `/add`, `/mcp`, `/help`
- Offline `/claw` with bundled sample data (平安银行 000001.SZ)
- Technical factor computation: momentum, reversal, volatility, RSI, SMA deviation, volume ratio
- Vectorized SMA crossover backtest with full metrics (Sharpe, Sortino, Calmar, max DD)
- Risk metrics: VaR, CVaR, skewness, kurtosis, downside vol
- Three-dimension benchmark scoring (Return 40 + Risk 40 + Robustness 20 = 100)
- `.ohquant/` local storage for settings, cached data, benchmark results
- One-shot mode: `whyj -c "//claw --code 000001.SZ"`

### Changed

- Complete TypeScript rewrite — zero Python code retained
- Tech stack: Bun + TypeScript + Ink 5 + React 18 + Anthropic SDK
- Config in `.ohquant/settings.json` managed via `/config` (replaces `.env`)
- npm package: `whyj-quant` with CLI binary `whyj`

### Removed

- All Python code (cli/, skills/, benchmark/)
- pyproject.toml

## [0.2.0] - 2026-05-27

### Changed

- A 股价格读取改为更稳定的 `yfinance -> AKShare -> 本地样例` 回退链路

### Fixed

- 修复回测中 `equity` 列的整数类型问题
- 修复 benchmark 基准数据读取不稳定
- 修复 wheel 缺少运行时目录

### Removed

- 未接入 CLI 的 `research`、`intel`、`consensus` 代码

## [0.1.0] - 2026-05-26

### Added

- 初始 CLI 与 skills 仓库结构
