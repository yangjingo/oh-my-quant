# BaoStock — A 股数据源 (Python SDK)

## 连接

免费使用，无需 token，但需要通过 `login()`/`logout()` 管理会话：

```bash
pip install baostock
```

```python
import baostock as bs
bs.login()
rs = bs.query_history_k_data_plus(...)
df = rs.get_data()
bs.logout()
```

> 本项目已封装 login/logout，直接调用 `skills.datasource.scripts.baostock.*` 即可。

## 数据更新时间

| 数据 | 更新时间 |
|------|---------|
| 日 K 线 | 当日 17:30 |
| 复权因子 | 当日 18:00 |
| 分钟 K 线 | 当日 20:00 |
| 财务数据 | 次日 01:30 |
| 周 K 线 | 周六 17:30 |
| 月 K 线 | 每月 1 号 17:30 |
| 指数成分股 | 每周一下午 |

## 历史数据范围

| 数据类别 | 时间范围 |
|----------|---------|
| 日/周/月 K 线 | 1990-12-19 至今 |
| 分钟 K 线 (5/15/30/60) | 2020-01-03 至今 (近 5 年) |
| 指数日 K | 2006-01-01 至今 |
| 季频财务数据 | 2007 至今 |
| 业绩预告 | 2003 至今 |
| 业绩快报 | 2006 至今 |
| ETF K 线 | 2026-01-05 至今 |

## API 函数

本项目封装了 `skills/datasource/scripts/baostock.py`，以下所有函数自动处理 login/logout：

### K 线数据

| 函数 | 说明 |
|------|------|
| `daily(symbol, start, end, adjust)` | 日 K 线。adjust: "1"=后复权, "2"=前复权, "3"=不复权 |
| `weekly(symbol, start, end, adjust)` | 周 K 线 |
| `monthly(symbol, start, end, adjust)` | 月 K 线 |
| `minute(symbol, freq, start, end)` | 分钟 K 线。freq: "5"/"15"/"30"/"60" |

### 指数

| 函数 | 说明 |
|------|------|
| `index_daily(index_code, start, end)` | 指数日 K。如 `"sh.000300"` 沪深 300 |

> BaoStock 指数代码格式: `sh.000300` (沪深 300), `sh.000016` (上证 50), `sz.399001` (深证成指)

### 基础信息

| 函数 | 说明 |
|------|------|
| `stock_basic(code, code_name)` | 证券基本资料，支持模糊查询 |
| `all_stocks(day)` | 指定日期的所有证券（含上市状态） |
| `stock_industry(code, date)` | 行业分类 |
| `trade_dates(start, end)` | 交易日历 |

### 指数成分股

| 函数 | 说明 |
|------|------|
| `hs300_stocks(date)` | 沪深 300 成分股 |
| `sz50_stocks(date)` | 上证 50 成分股 |
| `zz500_stocks(date)` | 中证 500 成分股 |

### 季频财务数据

| 函数 | 说明 |
|------|------|
| `balance_data(code, year, quarter)` | 偿债能力 |
| `profit_data(code, year, quarter)` | 盈利能力 |
| `cash_flow_data(code, year, quarter)` | 现金流量 |
| `dupont_data(code, year, quarter)` | 杜邦指标 |
| `growth_data(code, year, quarter)` | 成长能力 |
| `operation_data(code, year, quarter)` | 营运能力 |

### 分红 / 业绩预告

| 函数 | 说明 |
|------|------|
| `dividend_data(code, year, year_type)` | 股息分红 |
| `adjust_factor(code, start, end)` | 复权因子 |
| `forecast_report(code, start, end)` | 业绩预告 |
| `performance_express(code, start, end)` | 业绩快报 |

### 宏观数据

| 函数 | 说明 |
|------|------|
| `money_supply(start, end)` | 货币供应量 (M0/M1/M2) |
| `deposit_rate(start, end)` | 存款利率 |
| `loan_rate(start, end)` | 贷款利率 |
| `reserve_ratio(start, end, year_type)` | 存款准备金率 |

## 优势

- **免费无门槛**：无需注册、无 API Key、无积分限制
- **长历史数据**：日线从 1990 年开始，近 35 年
- **专业财务数据**：杜邦分析、成长能力、营运能力等深度财务指标
- **稳定**：服务器由 baostock.com 维护，不受爬虫反爬影响

## 局限

- 必须 login/logout，每次调用都会建立/断开连接
- 全量股票列表查询可能因数据量大超时
- 分钟 K 线仅近 5 年
- 不支持实时行情
- ETF 数据从 2026 年才开始
- 无融资融券、龙虎榜等数据

## 与其他数据源对比

| 维度 | BaoStock | AKShare | Tushare MCP |
|------|:-------:|:-------:|:-----------:|
| 认证 | 无需 | 无需 | token + 积分 |
| 日线起始 | **1990** | 2010± | 2010± |
| 分钟线起始 | 2020 | 2020± | 2017± |
| 财务数据 | ✅ 杜邦/成长 | ✅ 三大表 | ✅ 全覆盖 |
| 指数成分 | ✅ HS300/50/500 | ✅ 多指数 | ✅ 全覆盖 |
| 分红数据 | ✅ | ❌ | ✅ |
| 业绩预告/快报 | ✅ | ❌ | ✅ |
| 宏观利率 | ✅ | ✅ | ✅ |
| 实时行情 | ❌ | ✅ | ❌ |
| ETF 数据 | 2026+ | 完整 | 完整 |

## 测试

```bash
python -m pytest tests/test_baostock_data.py -v
```
