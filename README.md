# oh-my-quant

一个收缩后的量化工具仓库：保留可执行的核心能力，去掉展示型设计层、占位式 CLI 和未接入 CLI 的 skill 文档。

## 保留内容

- `skills/datasource/scripts`：A 股 `AKShare`、美股 `yfinance` 数据获取
- `skills/factor/scripts`：基础因子计算
- `skills/backtest/scripts`：向量化均线回测与绩效统计
- `skills/risk/scripts`：风险指标与组合优化
- `benchmark/scripts`：策略评分与结果汇总
- `cli/main.py`：最小命令行入口

## CLI

```bash
uv sync
whyj-quant data download --symbol 000001
whyj-quant factor analyze --symbol 000001 --factor-name momentum
whyj-quant backtest run --symbol 000001 --fast 20 --slow 60
whyj-quant risk check --symbol 000001
whyj-quant benchmark run --symbol 000001 --benchmark-symbol 510300.SS
whyj-quant benchmark dashboard
whyj-quant validate all
```

## 项目结构

```text
oh-my-quant/
├── ROADMAP.md
├── cli/
├── benchmark/
│   ├── data/
│   ├── results/
│   └── scripts/
├── skills/
│   ├── datasource/
│   ├── factor/
│   ├── backtest/
│   ├── risk/
│   └── validate/
├── docs/reference.md
└── pyproject.toml
```

## 说明

- `benchmark run` 现在直接对均线交叉策略评分，并把结果写入 `benchmark/results/`
- 数据源现只保留 `akshare` 和 `yfinance` 两条运行路径
- 仓库已删除 HTML 看板和 K 线展示页；`docs/DESIGN.md` 作为未来 UI 规范资产保留
- 未接入 CLI 的 `research`、`intel`、`consensus` 代码和 skill 文档已移除
- 后续可能恢复的方向只保留在 `ROADMAP.md`
