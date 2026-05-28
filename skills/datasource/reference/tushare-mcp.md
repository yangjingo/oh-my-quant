# Tushare MCP

## 认证要求

注册 [tushare.pro](https://tushare.pro)，获取 token 并配置积分权限。不同接口有不同积分门槛。

## Connection

```bash
claude mcp add --transport http tushare "https://api.tushare.pro/mcp/token=$TUSHARE_TOKEN"
```

Token from: [tushare.pro](https://tushare.pro) → 个人中心 → MCP Server → 复制

> 当前仓库 **未配置** Tushare token，所有 Tushare MCP 调用返回 `调用工具需要提供 token`。
> 无 token 场景下优先使用 [AKShare](akshare-reference.md) / [JoinQuant](jqdata-reference.md) 作为数据源。

---

## 核心接口 — 行情

### `daily` — A 股日线
```
daily(ts_code="000001.SZ", start_date="20260101", end_date="20260528")
daily(trade_date="20260527")  # 全市场单日行情
→ open, high, low, close, pre_close, change, pct_chg, vol, amount
```

### `weekly` / `monthly` — 周线 / 月线
```
weekly(ts_code="600519.SH", start_date="20240101", end_date="20251231")
→ 每周/每月最后一个交易日 OHLCV
```

### `stk_mins` / `rt_min` — 分时 / 实时
```
stk_mins(ts_code="000001.SZ", freq="5min", start_date="2026-05-27 09:30:00", end_date="2026-05-27 15:00:00")
rt_min(ts_code="600519.SH", freq="1MIN")
```
freq: `"1min"` / `"5min"` / `"15min"` / `"30min"` / `"60min"`

---

## 核心接口 — 财务报表

### `income` — 利润表
```
income(ts_code="600519.SH", period="20251231", report_type="1")
→ revenue, total_cogs, operate_profit, total_profit, n_income, basic_eps, diluted_eps
```
period: 每个季度最后一天 (20251231=年报, 20250630=半年报, 20250930=三季报)

### `balancesheet` — 资产负债表
```
balancesheet(ts_code="000001.SZ", period="20251231")
→ total_assets, total_liab, total_hldr_eqy, money_cap, inventories,
  accounts_receiv, fix_assets, goodwill
```

### `cashflow` — 现金流量表
```
cashflow(ts_code="000001.SZ", period="20251231")
→ n_cashflow_act (经营), n_cashflow_inv_act (投资), n_cash_flows_fnc_act (筹资)
```

### `fina_indicator` — 财务指标 (一站式)
```
fina_indicator(ts_code="600519.SH", start_date="20200101", end_date="20251231")
→ eps, roe, roa, gross_margin, current_ratio, debt_to_assets,
  assets_turn, pe, pb, netprofit_margin, fcff, fcfe
```
> 单次最多 100 条，需按日期多次请求。

---

## 核心接口 — 资金 & 龙虎榜

### `moneyflow` — 个股资金流向
```
moneyflow(ts_code="000001.SZ", trade_date="20260527")
→ buy_sm_vol/amount, sell_sm_vol/amount, buy_lg_vol/amount,
  sell_lg_vol/amount, net_mf_amount (主力净流入)
```

### `moneyflow_hsgt` — 沪深港通资金流向
```
moneyflow_hsgt(start_date="20260101", end_date="20260528")
→ ggt_ss (港股通沪), ggt_sz (港股通深), hgt (沪股通), sgt (深股通),
  north_money (北向), south_money (南向)
```

### `top_list` / `top_inst` — 龙虎榜
```
top_list(trade_date="20260527")
→ ts_code, name, close, pct_change, amount, l_buy, l_sell,
  net_amount, reason (上榜原因)

top_inst(trade_date="20260527")
→ 龙虎榜机构席位成交明细: exalter (营业部), buy, sell, net_buy
```

### `margin` / `margin_detail` — 融资融券
```
margin(trade_date="20260527")           # 市场汇总
margin_detail(ts_code="600519.SH", trade_date="20260527")  # 个股明细
→ rzye (融资余额), rqye (融券余额), rzmre (融资买入额), rzche (融资偿还额)
```

---

## 核心接口 — 基金 & ETF

### `fund_basic` — 基金列表
```
fund_basic(market="E")   # E=场内, O=场外
fund_basic(ts_code="159915.SZ")
→ ts_code, name, fund_type, found_date, management, custodian, invest_type
```

### `fund_nav` — 基金净值
```
fund_nav(ts_code="159915.SZ", start_date="20260101", end_date="20260528")
→ unit_nav, accum_nav, accum_div, adj_nav
```

### `fund_daily` — ETF 日线行情
```
fund_daily(ts_code="510050.SH", start_date="20260101", end_date="20260528")
→ open, high, low, close, vol, amount
```

### `fund_portfolio` — 基金持仓 (季度)
```
fund_portfolio(ts_code="159915.SZ", period="20260331")
→ symbol (持仓股票), mkv (市值), amount, stk_mkv_ratio (占净值比)
```

---

## Tushare 独有 (AKShare 不覆盖)

| 维度 | 典型接口 | 说明 |
|------|---------|------|
| 融资融券 | `margin`, `margin_detail` | 日频，含个股明细 |
| 龙虎榜 | `top_list`, `top_inst` | 买卖席位拆分明细 |
| 股东增减持 | `stk_holdertrade` | 持有人类型 + 变动比例 |
| 北向/南向 | `moneyflow_hsgt`, `hk_hold`, `hsgt_top10` | 十大成交股 + 持股 |
| 港股全覆盖 | `hk_daily`, `hk_fina_indicator`, `hk_income` | 港股行情+财务 |
| 期权 | `opt_basic`, `opt_daily` | 四大交易所期权 |
| 期货 | `fut_daily`, `fut_holding` | 持仓排名 + 仓单 |
| 可转债 | `cb_basic`, `cb_daily`, `cb_share` | 转股+赎回+评级 |
| 股权质押 | `pledge_detail`, `pledge_stat` | 质押明细+汇总 |
| 指数成分权重 | `index_weight` | 月度权重数据 |
| 美股全覆盖 | `us_daily`, `us_adjfactor` | 美港股全覆盖 |
| 筹码分布 | `cyq_chips`, `cyq_perf` | 各价位占比 + 胜率 |

---

## Python SDK (备选)

```python
import tushare as ts
ts.set_token('YOUR_TOKEN')
pro = ts.pro_api()

# 日线
pro.daily(ts_code='000001.SZ', start_date='20240101', end_date='20241231')

# 财务指标
pro.fina_indicator(ts_code='600519.SH', period='20241231')

# 龙虎榜
pro.top_list(trade_date='20240527')

# 指数成分
pro.index_weight(index_code='000300.SH', trade_date='20241231')
```

## Supported Platforms

Claude Code / Cursor / CodeBuddy / Trae / Cline / Lingma / OpenClaw / All MCP-compatible
