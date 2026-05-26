# Benchmark Directory

评测数据和结果存储。

## 目录结构

```
benchmark/
├── data/           # 评测输入（价格序列、因子面板、alpha 目录）
│   ├── csi300_constituents.csv      # 沪深 300 成分股 (AKShare)
│   └── alpha_manifest.json          # 452 alpha 因子清单 (Vibe-Trading)
├── results/        # 评测结果（JSON/CSV，按策略+日期组织）
└── reports/        # 生成的评测报告（Markdown/PDF）
```

## 数据来源

参照 [Vibe-Trading](https://github.com/HKUDS/Vibe-Trading) 的数据源体系：

### 行情数据 Loader

| Loader | 覆盖 | 是否免费 | 配置要求 |
|--------|------|---------|---------|
| AKShare (`akshare_loader`) | A 股行情/财务/宏观 | ✅ 免费 | 安装即用，有反爬限制 |
| Yahoo Finance (`yfinance_loader`) | 全球股票/ETF/指数 | ✅ 免费 | 安装即用 |
| CCXT (`ccxt_loader`) | 加密货币 (100+ 交易所) | ✅ 免费 | 安装即用 |
| Tushare (`tushare`) | A 股行情/财务/另类 | ⚠️ 积分制 | 需注册获取 `TUSHARE_TOKEN` |
| Tushare-Fund (`tushare_fundamentals`) | A 股财报/估值/ROE | ⚠️ 积分制 | 同上 |
| Futu (`futu`) | 港股实时行情 | ⚠️ 需开户 | 需 FutuOpenD 客户端 |
| OKX (`okx`) | OKX 交易所数据 | ✅ 免费 | 安装即用 |

### 回测引擎

| 引擎 | 市场 | 支持频率 |
|------|------|---------|
| `china_a` | A 股 | 日线/分钟线 |
| `china_futures` | 中国期货 | 日线/分钟线 |
| `crypto` | 加密货币 | 任意 |
| `forex` | 外汇 | 日线/小时线 |
| `global_equity` | 全球股票 | 日线 |
| `global_futures` | 全球期货 | 日线 |
| `options_portfolio` | 期权组合 | 日线 |
| `composite` | 跨市场混合 | 按市场路由 |

### Alpha Zoo (452 因子)

| Zoo | 数量 | 来源 |
|-----|------|------|
| `qlib158` | 154 | Microsoft Qlib Alpha158 |
| `alpha101` | 101 | Kakushadze 2015 "101 Formulaic Alphas" |
| `gtja191` | 191 | 国泰君安 2014 短周期交易型因子 |
| `academic` | 6 | Fama-French 5 + Carhart 动量 |

> Alpha 清单: `benchmark/data/alpha_manifest.json`

## 数据格式

### 评测结果 `benchmark/results/{strategy}_{date}.json`

```json
{
  "strategy": "sma_cross",
  "date": "2026-05-26",
  "symbol": "000001",
  "total_score": 72.5,
  "grade": "A",
  "return_score": 32,
  "risk_score": 28,
  "robustness_score": 12.5,
  "details": {
    "cagr": 0.12,
    "sharpe": 1.5,
    "max_drawdown": -0.18
  }
}
```

### 评测输入 `benchmark/data/{name}.csv` / `.parquet`

标准化的 OHLCV 或因子值面板，按 `skills/benchmark/scripts/score.py` 的 evaluate() 输入格式。

### Alpha 清单 `benchmark/data/alpha_manifest.json`

```json
[
  {
    "id": "gtja191_001",
    "zoo": "gtja191",
    "theme": ["volume", "reversal"],
    "universe": "equity_cn",
    "decay_horizon": 1,
    "formula_latex": "..."
  }
]
```
