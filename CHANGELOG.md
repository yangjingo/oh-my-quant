# Changelog

## [Unreleased]

### Changed

- 恢复原始 `docs/DESIGN.md`，作为未来 UI 规范资产保留，不再视为运行时代码依赖

## [0.2.0] - 2026-05-27

### Changed

- 将仓库收缩为真实可运行的最小量化闭环：`data`、`factor`、`backtest`、`risk`、`dashboard`、`validate`
- A 股价格读取改为更稳定的 `yfinance -> AKShare -> 本地样例` 回退链路
- `dashboard run` 直接对均线交叉策略评分，并写入 `dashboard/results/`
- 打包配置调整为同时包含 `cli`、`skills`、`dashboard`

### Fixed

- 修复回测中 `equity` 列的整数类型问题，避免净值写入时报错
- 修复 benchmark 基准数据读取不稳定的问题
- 修复 wheel 缺少运行时目录导致安装后 CLI 不完整的问题

### Removed

- 自然语言路由入口和多个仅输出提示的占位命令
- 未接入 CLI 的 `research`、`intel`、`consensus` 代码与 skill 文档
- `skills/datasource/scripts/jqdata.py`
- `skills/factor/scripts/analysis.py`
- `skills/risk/scripts/optimize.py`
- `skills/validate/scripts/cross_check.py`
- `skills/datasource/reference/jointquant-api.md`
- `dashboard/data/alpha_manifest.json`
- `dashboard/data/csi300_constituents.csv`
- `dashboard/scripts/dashboard_html.py`
- `dashboard/scripts/kline_chart.py`
- `dashboard/scripts/metric_pages.py`
- `dashboard/metrics/` 下所有生成好的 HTML 文件

### Added

- `ROADMAP.md`，记录未来如果需要恢复的非 CLI 能力

## [0.1.0] - 2026-05-26

### Added

- 初始 CLI 与 skills 仓库结构
