# Tushare MCP

## Connection

```bash
claude mcp add --transport http tushare "https://api.tushare.pro/mcp/token=$TUSHARE_TOKEN"
```

Token from: [tushare.pro](https://tushare.pro) → 个人中心 → MCP Server → 复制

## Coverage

A 股行情、财务、指数、基金、期货、期权、港股、美股、宏观经济等全品类金融数据。

## Supported Platforms

- Claude Code / Cursor / CodeBuddy / Trae / Cline / Lingma
- OpenClaw / WorkBuddy / KimiClaw / MaxClaw / CoPaw
- All MCP-compatible clients

## Python SDK (alternative)

```python
import tushare as ts
ts.set_token('YOUR_TOKEN')
pro = ts.pro_api()

pro.daily(ts_code='000001.SZ', start_date='20240101', end_date='20241231')
pro.daily_basic(ts_code='000001.SZ')       # 每日指标
pro.income(ts_code='000001.SZ', period='20241231')      # 利润表
pro.balancesheet(ts_code='000001.SZ', period='20241231') # 资产负债表
pro.index_weight(index_code='000300.SH', start_date='20240101')
```
