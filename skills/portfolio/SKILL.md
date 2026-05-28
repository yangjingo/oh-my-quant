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
AKShare 抓取净值 → 写入 data/ JSON → 模板注入 → 生成 portfolio.html → 浏览器打开
```

## 使用

```bash
# 生成看板 HTML
python skills/portfolio/scripts/generate.py

# 直接在浏览器中打开
start skills/portfolio/portfolio.html
```

## 数据源

| 优先级 | 数据源 | 用途 |
|--------|--------|------|
| 1 | AKShare `fund_open_fund_info_em()` | 基金历史净值（自动计算阶段收益） |
| 2 | 天天基金 `fundf10.eastmoney.com` | 规模、持仓明细 |

## 文件结构

```
skills/portfolio/
├── SKILL.md
├── DESIGN.md
├── portfolio.html               # 生成产物：看板页面 (零外部依赖)
├── data/                         # 数据层 (JSON)
│   ├── holdings.json             # 持仓清单
│   ├── quarterly.json            # 季度快照（累积）
│   ├── daily.json                # 每日净值日志（累积）
│   ├── nav_full.json             # 全量净值 (供回测)
│   └── nav_sampled.json          # 降采样净值 (供看板)
├── templates/                    # 前端模板
│   ├── portfolio.html            # 看板模板 (DESIGN.md brutalist)
│   └── echarts.min.js            # ECharts 本地副本 (零 CDN)
└── scripts/
    ├── generate.py               # 看板生成：抓取 → 渲染 → 输出
    ├── philosophy.py             # 投资理念引擎
    ├── quarterly.py              # 季度采集 + 回顾
    └── daily.py                  # 每日净值采集 + 回顾
```

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

## 看板图表

基于 ECharts (本地 `templates/echarts.min.js`，零 CDN 依赖) + `docs/DESIGN.md` brutalist 设计系统：

| 图表 | 说明 |
|------|------|
| NAV 走势 | 7 基金 + 等权组合，交互式缩放 |
| 回撤曲线 | Underwater plot，灰带标记水下期 |
| 滚动波动率 | 21 日年化，风险 regime 对比 |
| 风险收益散点 | 气泡 = Sharpe ratio |
| 绩效矩阵 | 累计/CAGR/波动/MaxDD/Sharpe 表格 |

## 看板设计

基于 `docs/DESIGN.md` NewForm brutalist 设计系统：
- Hero 区：软奶油底 (`#F7F9F6`) + 48px/800wt 标题
- 数据区：暗色引擎底板 (`#121413`)
- Cyber Mint (`#39E180`) 仅用于正收益和关键信号
- 零阴影，全 1px hairline 分隔
- ECharts 自定义主题注册为 `brutal`

## 投资理念引擎

8 位投资大师理念，根据组合特征自动匹配触发： C:\Users\yangjing\Project\oh-my-quant\docs\funder.md

| 触发条件 | 匹配理念 |
|----------|---------|
| 单一赛道暴露 > 50% | 芒格 · 能力圈 |
| 防御资产 = 0% | 达里奥 · 全天候 |
| 主动基金占比 > 80% | 博格 · 成本法则 |
| 近 1 年收益 > 100% | 马克斯 · 周期 + 巴菲特 · 安全边际 |
| 近 6 月收益 > 50% | 利弗莫尔 · 趋势跟踪 |
| 始终 | 塔勒布 · 反脆弱 + 林奇 · 了解你持有的 |

## 计算指标

从净值历史自动计算：

| 指标 | 计算方式 |
|------|---------|
| 累计收益 | 期末净值 / 期初净值 - 1 |
| CAGR | (1 + 日均收益)^252 - 1 |
| 年化波动率 | 日收益 std × √252 |
| 最大回撤 | 滚动峰值到谷底的最大跌幅 |
| Sharpe | (CAGR - 0.02) / 年化波动 |
| 21 日滚动波动率 | 滑动窗口 std × √252 |

## 关联

- 数据获取: `skills/datasource/SKILL.md`
- 高级指标: `benchmark/metrics/`
- 组合预测: `benchmark/metrics/portfolio_predict.py`
- 设计系统: `docs/DESIGN.md`
