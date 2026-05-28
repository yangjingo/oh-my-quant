---
name: portfolio
description: |
  个人基金组合看板。触发场景：我的组合、基金看板、持仓分析、收益追踪。
  抓取基金净值，计算阶段收益，生成 HTML 看板，匹配投资理念。
---

# portfolio

个人基金组合管理与看板生成。

## 工作流

```
AKShare 抓取净值 → 计算阶段收益 → 注入 HTML 模板 → 匹配投资理念 → 输出看板
```

## 使用

```bash
# 抓取最新数据 + 生成看板
python skills/portfolio/scripts/generate.py

# 使用缓存数据重新生成（跳过网络请求）
python skills/portfolio/scripts/generate.py --no-fetch

# 输出到指定路径
python skills/portfolio/scripts/generate.py --output ~/Desktop/portfolio.html
```

## 数据源

| 优先级 | 数据源 | 用途 |
|--------|--------|------|
| 1 | AKShare `fund_open_fund_info_em()` | 基金历史净值（自动计算阶段收益） |
| 2 | 同花顺 `fund.10jqka.com.cn` | 交叉验证 + 季度收益 |
| 3 | 天天基金 `fundf10.eastmoney.com` | 规模、持仓明细 |

## 当前持仓

| 代码 | 基金名称 | 类型 |
|------|---------|------|
| 022364 | 永赢科技智选发起A | 偏股混合 |
| 016372 | 信澳匠心严选一年持有A | 偏股混合 |
| 022184 | 富国全球科技互联网C | QDII股票 |
| 001986 | 前海开源人工智能主题 | 灵活混合 |
| 008021 | 华富人工智能ETF联接C | 指数股票 |
| 673060 | 西部利得景瑞灵活A | 灵活混合 |
| 040015 | 华安动态灵活配置A | 灵活混合 |

## 计算指标

从净值历史自动计算：

| 指标 | 计算方式 |
|------|---------|
| 近 1 周 | 最新净值 / 7 天前净值 - 1 |
| 近 1 月 | 最新净值 / 30 天前净值 - 1 |
| 近 3 月 | 最新净值 / 90 天前净值 - 1 |
| 近 6 月 | 最新净值 / 180 天前净值 - 1 |
| 今年来 | 最新净值 / 当年首日净值 - 1 |
| 近 1 年 | 最新净值 / 365 天前净值 - 1 |

## 投资理念引擎

8 位投资大师理念，根据组合特征自动匹配触发：

| 触发条件 | 匹配理念 |
|----------|---------|
| 单一赛道暴露 > 50% | 芒格 · 能力圈 |
| 防御资产 = 0% | 达里奥 · 全天候 |
| 主动基金占比 > 80% | 博格 · 成本法则 |
| 近 1 年收益 > 100% | 马克斯 · 周期 + 巴菲特 · 安全边际 |
| 近 6 月收益 > 50% | 利弗莫尔 · 趋势跟踪 |
| 始终 | 塔勒布 · 反脆弱 + 林奇 · 了解你持有的 |

## 看板设计

基于 `docs/DESIGN.md` NewForm brutalist 设计系统：
- Hero 区：软奶油底 (`#F7F9F6`) + 56px/800wt 标题
- 数据区：暗色引擎底板 (`#121413`)
- Cyber Mint (`#39E180`) 仅用于负收益和关键信号
- 零阴影，全 1px hairline 分隔
- 涨红跌绿（中国惯例）

## 文件结构

```
skills/portfolio/
├── SKILL.md                  # 本文件
├── portfolio.html            # 看板模板 (DESIGN.md)
├── holdings.json             # 持仓清单
├── quarterly.json            # 季度快照（累积）
├── daily.json                # 每日净值日志（累积）
├── .fund_data_cache.json     # 看板数据缓存
└── scripts/
    ├── generate.py           # 看板生成：抓取 → 渲染 → 输出
    ├── philosophy.py         # 投资理念引擎
    ├── quarterly.py          # 季度采集 + 回顾
    └── daily.py              # 每日净值采集 + 回顾
```

## 关联

- 数据获取: `skills/datasource/SKILL.md`
- 设计系统: `docs/DESIGN.md`
- 数据源路由: `memory/data-source-routing.md`
