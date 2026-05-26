# JQData (JoinQuant SDK)

## Setup

```bash
pip install jqdatasdk
# C++ 组件缺失: pip install thriftpy2==0.4.20
```

## Auth

```python
from jqdatasdk import auth, get_query_count, logout

auth('手机号', '密码')           # → auth success
get_query_count()               # → {'total': 1000000, 'spare': 996927}
logout()                        # JQData 仅支持 1 连接
```

## Trial Limits

| Item | Trial | Official |
|------|-------|----------|
| Validity | 3 months | 12 months |
| Daily quota | 1M rows | 200M rows |
| Connections | 1 | 3 |
| Data range | 15mo ago ~ 3mo ago | Unlimited |

## API Reference

### Stock OHLCV

```python
from jqdatasdk import get_price

df = get_price('000001.XSHE', start_date='2024-01-01', end_date='2024-12-31',
               frequency='daily', fields=['open','close','high','low','volume'], fq='pre')
```

### Index Weights

```python
from jqdatasdk import get_index_weights
df = get_index_weights('000300.XSHG', date='2024-12-31')
```

### Valuation

```python
from jqdatasdk import get_valuation
df = get_valuation('000001.XSHE', start_date='2024-01-01', end_date='2024-12-31')
```

### Financials (Single/Multi Quarter)

```python
from jqdatasdk import get_fundamentals, query, valuation, income, balance

q = query(valuation, income, balance).filter(
    valuation.code == '000001.XSHE',
    balance.stat_date == '2024q4',
    income.stat_date == '2024q4')
df = get_fundamentals(q, stat_date='2024q4')
```

### Alpha Factors

```python
from jqdatasdk import get_all_alpha_101, get_all_alpha_191, get_index_stocks
stocks = get_index_stocks('000300.XSHG')
df101 = get_all_alpha_101(stocks)
df191 = get_all_alpha_191(stocks)
```

### Futures

```python
from jqdatasdk import get_all_securities
df = get_all_securities(types=['futures'])
```

### Security Lookup

```python
from jqdatasdk import get_all_securities
stocks = get_all_securities(types=['stock'])     # 5508 A-shares
funds  = get_all_securities(types=['fund'])
```

## Ticker Format

| Market | Prefix | Example |
|--------|--------|---------|
| Shenzhen | `.XSHE` | `000001.XSHE` 平安银行 |
| Shanghai | `.XSHG` | `600519.XSHG` 贵州茅台 |
| CSI 300 Index | `.XSHG` | `000300.XSHG` |
