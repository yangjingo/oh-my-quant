---
name: consensus
description: |
  机构共识持仓分析。触发场景：顶级基金共同买了什么、机构共识、13F 共识加仓、哪些股票被一批基金一起加仓、新进入榜单、退出榜单、共识强度变化、基金抱团、smart money consensus。
  汇总多家顶级 13F 管理人的持仓，输出共识加仓 Top 20、榜单进出、强度变化、近期市场表现、行业主题总结和 13F 风险提示。
---

# consensus

不要把这个 skill 用在“某一家基金买了什么”这种单管理人问题上。它回答的是：**一批顶级基金共同买了什么，哪些股票正在形成机构共识。**

## 优先数据源

优先使用结构化 MCP，不要手工爬网页：

1. `financial-datasets`
   - `get_institutional_investors` — 找 top filers / 确认 `filer_cik`
   - `get_institutional_holdings` — 拉 13F 持仓，按 `filer_cik` 或 `ticker`
   - `get_company_facts` — 补 sector / industry
   - `get_stock_prices` — 补 5d / 20d / 60d 市场表现
2. `llmquant-data`
   - `sec_13f_list_top_managers`
   - `sec_13f_list_manager_holdings`
   - `sec_13f_list_ticker_holders`
   - `equity_historical_prices`

如果两个 MCP 都不可用，直接说明数据源缺失，不要伪造共识结论。

## 标准工作流

### 1. 对齐范围

默认设置：
- 市场：美股 13F
- 管理人范围：Top 30 机构（可按用户要求改成 20 / 50）
- 比较区间：最新季度 vs 上一季度
- 输出榜单：Top 20

如果用户没有给季度，使用最新可用季度，并明确写出两个季度标签。

### 2. 拉取原始持仓

对每个管理人至少保留这些字段：

`ticker, issuer, manager_name, manager_rank, market_value_usd, shares, report_period`

可选增强字段：

`sector, theme, ret_5d, ret_20d, ret_60d, put_call`

把当前季度和上一季度各自整理为一个平面表，再运行：

```bash
python skills/consensus/scripts/consensus.py \
  --current data/consensus/current.csv \
  --previous data/consensus/previous.csv \
  --output data/consensus/report.md \
  --top-n 20
```

## 共识定义

脚本会按股票聚合出：

- `holder_count`：持有该股票的顶级管理人数
- `weighted_holder_score`：按管理人排名加权后的共识强度
- `total_value_usd`：合计持仓市值

排序原则：

1. `holder_count`
2. `weighted_holder_score`
3. `total_value_usd`

“本季共识加仓 Top 20”优先看：

1. `holder_delta`
2. `weighted_score_delta`
3. `current_holder_count`

## 输出格式

```markdown
# 13F 机构共识报告：{current_period} vs {previous_period}

## 本季共识加仓 Top 20
| Ticker | Name | Holders | ΔHolders | Weighted Score | ΔScore | Value |

## 新进入榜单
| Ticker | Name | Current Rank | Prev Rank | Holders |

## 退出榜单
| Ticker | Name | Prev Rank | Current Rank | Prev Holders |

## 共识强度变化
### 上升最快
### 下降最快

## 近期市场表现
| Ticker | 5D | 20D | 60D |

## 行业和主题总结
### 行业
### 主题

## 13F 风险提示
```

## 行业 / 主题处理规则

- 如果有 `sector` / `theme` 字段，直接做聚合统计。
- 如果只有 `sector`，主题可基于 Top 20 名单做人工归纳，但必须标注“主题为推断”。
- 如果两者都没有，先尝试 `financial-datasets.get_company_facts` 补全；补不全就明确写“行业主题数据不足”。

## 13F 风险提示

每次都提醒用户：

1. 13F 有披露滞后，不代表机构当前仓位。
2. 只能看到多头持仓，看不到完整对冲、空头和场外衍生品。
3. 季内交易路径不可见，新增不等于当前仍在持有。
4. 共识来自样本内 top managers，存在样本选择偏差。
5. 大市值热门股天然更容易形成“人数共识”，不要直接等同于 alpha。

## 结论要求

- 先给“共识正在增强的票”和“共识正在削弱的票”。
- 再给行业 / 主题归纳。
- 最后给风险提示。
- 不要把“机构共识”写成“机构确定性机会”。
