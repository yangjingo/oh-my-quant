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

| 优先级 | 数据源 | 用途 | 频率限制 |
|--------|--------|------|----------|
| 1 | AKShare `fund_open_fund_info_em()` | 基金历史净值 | 较宽松，单次 0.3-1s |
| 2 | AKShare `fund_individual_basic_info_xq()` | 基金详情（经理、规模、策略） | 宽松 |
| 3 | Tushare `fund_basic` / `fund_nav` / `fund_portfolio` | 官方持仓、规模、净值 | **1次/小时**（免费版） |
| 4 | AKShare `stock_zh_a_hist()` / `stock_zh_a_spot_em()` | 个股行情 | eastmoney 不稳定，易超时 |

### Tushare 调用注意事项

- **免费版频率限制极严**：`fund_basic`、`fund_nav`、`fund_share`、`fund_portfolio` 均为 **1次/小时/接口**，不能批量连续调用
- **MCP 不可用**：MCP 配置中 `${TUSHARE_TOKEN}` 不会被 `.env` 注入，MCP 调用始终缺少 token
- **正确做法**：Python SDK + `.env` 中的 token，调用后必须等 65s 再换接口
- **适用场景**：仅适合偶尔查单只基金持仓/规模，不适合批量或高频查询

### AKShare 调用注意事项

- `stock_zh_a_spot_em()`（全市场快照）经常超时 (15s)，不要用，用 `stock_zh_a_hist()` 按个股查
- `stock_zh_a_hist()` 单只 2-3s，8 只串行约 20s，比全市场快照更稳定
- `fund_open_fund_info_em()` 很稳定，是主力数据源
- Windows 下务必设置 `PYTHONIOENCODING=utf-8`，否则中文打印 crash |

## 文件结构

```
skills/portfolio/
├── SKILL.md
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

> 净值采集: 2026-05-29 16:30 CST | 数据来源: AKShare `fund_open_fund_info_em()` (天天基金)
> 净值日期: 2026-05-28（基金净值有 1 个工作日延迟）
> 基金详情: AKShare `fund_individual_basic_info_xq()` + Tushare `fund_basic`/`fund_portfolio`

| # | 代码 | 名称 | 净值 | 日涨跌 | 类型 | 经理 |
|---|------|------|------|--------|------|------|
| 1 | 022364 | 永赢科技智选发起A | 5.9938 | +2.63% | 偏股混合 | 任桀 |
| 2 | 016372 | 信澳匠心严选一年持有A | 2.5158 | +3.54% | 偏股混合 | 吴清宇 |
| 3 | 016371 | 信澳业绩驱动混合C | 3.0846 | +3.94% | 偏股混合 | 童昌希 |
| 4 | 022184 | 富国全球科技互联网C | 5.6615 | +0.57% | QDII股票 | 赵年珅 |
| 5 | 001986 | 前海开源人工智能主题 | 2.0806 | +4.41% | 灵活混合 | 魏淳/梁策 |
| 6 | 008021 | 华富人工智能ETF联接C | 1.9012 | +1.95% | 指数股票 | 李孝华等 |
| 7 | 020899 | 天弘中证全指通信设备指数发起A | 4.067 | +4.60% | 指数股票 | 张戈 |
| 8 | 673060 | 西部利得景瑞灵活A | 4.414 | +1.19% | 灵活混合 | 张昌平 |
| 9 | 040015 | 华安动态灵活配置A | 5.334 | +1.91% | 灵活混合 | 熊哲颖 |

### 数据采集说明

每次执行 `python skills/portfolio/scripts/daily.py` 时：
1. 调用 AKShare `fund_open_fund_info_em(symbol, indicator="单位净值走势")` 逐只拉取
2. 提取最新一条记录的 `单位净值` 和 `日增长率`
3. 写入 `data/daily.json`，记录 `date`(采集日)、`nav`、`chg_pct`、`nav_date`(实际净值日)

关键约束：
- **净值延迟 1 个工作日**：工作日 T 日采集到的是 T-1 日的净值（基金公司盘后公布）
- **QDII 额外延迟**：022184（富国全球科技）净值额外晚 1-2 天，采集日与净值日可能差 3 天
- **数据源单一**：净值仅从天天基金（via AKShare）获取，无备用源
- **无历史补录**：`daily.json` 只追加当天，不回溯历史缺口

## 看板图表

基于 ECharts (本地 `templates/echarts.min.js`，零 CDN 依赖) + `DESIGN.md` brutalist 设计系统：

| 图表 | 说明 |
|------|------|
| NAV 走势 | 7 基金 + 等权组合，交互式缩放 |
| 回撤曲线 | Underwater plot，灰带标记水下期 |
| 滚动波动率 | 21 日年化，风险 regime 对比 |
| 风险收益散点 | 气泡 = Sharpe ratio |
| 绩效矩阵 | 累计/CAGR/波动/MaxDD/Sharpe 表格 |

## 看板设计

基于 `DESIGN.md` NewForm brutalist 设计系统，模板 CSS 变量映射：

| CSS 变量 | 色值 | DESIGN.md token | 用途 |
|----------|------|-----------------|------|
| `--ink` | `#121413` | primary / canvas-dark | 全局暗底 |
| `--mint` | `#39E180` | accent | 正收益、关键信号 |
| `--cream` | `#F7F9F6` | canvas-light | Hero 区亮底 |
| `--surface` | `#1E2220` | surface-card | 卡片/数据面板 |
| `--hairline` | `#2C302E` | hairline-dark | 1px 分隔线 |
| `--muted` | `#8C9490` | muted-dark | 次级文本/标签 |
| `--text` | `#F7F9F6` | text-dark | 主文本 |

图表多色板（ECharts brutal 主题）：`#39E180` / `#58a6ff` / `#d2991d` / `#bc8cff` / `#f0883e` / `#56d4dd` / `#8b949e`

排版：Hero 标题 48px/800wt，区域标题 22px/700wt，正文 15px/400，KPI 28px/800wt

零阴影，全 1px hairline 分隔，ECharts 自定义主题注册为 `brutal`

## 投资理念引擎

8 位投资大师理念，根据组合特征自动匹配触发。知识体系见 `docs/notes.md`。

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

## 组合重叠分析

### 分析逻辑

当组合超过 8 只基金时，需要穿透底层持仓检查重叠。分析流程：

```
持仓清单 (holdings.json)
  → AKShare fund_portfolio_hold_em()  逐只拉取前十大重仓
  → Tushare fund_portfolio()           补充官方持仓数据
  → 构建 基金×股票 权重矩阵
  → 识别被 ≥3 只基金共同持有的股票（重叠核心）
  → 计算每对基金的重叠度 = |交集| / |并集|
  → 输出合并建议 + 投资原则匹配
```

### 重叠判定规则

| 重叠度 | 判定 | 操作 |
|--------|------|------|
| 同一股票被 ≥3 只基金持有 | 严重重叠 | 必须审视 |
| 两只基金前十大重叠 > 50% | 高度重叠 | 建议合并，留覆盖面更宽的那只 |
| 两只基金跟踪指数成分有 ≥60% 交集 | 指数重叠 | 留规模更大/费率更低的那只 |
| 同一公司旗下两只同方向主动基金 | 管理重叠 | 合并，避免双倍管理费 |

### 原则匹配引擎

每条合并建议必须关联投资原则（来自 `philosophy.py` 和 `notes.md`）：

| 重叠类型 | 触发原则 | 逻辑 |
|----------|---------|------|
| 同一股票 N 只基金共持 | 芒格·能力圈 | "能力圈不需要 N 张同一方向的门票" |
| 两只基金持仓 > 50% 重合 | 林奇·两分钟测试 | "说不清差异就是不值得持有的冗余" |
| 被动指数与主动基金底层重合 | 博格·成本 | "双重付费买同一篮子 = 浪费" |
| 同一赛道两只同类基金 | 博格·成本 + 芒格·能力圈 | "刚进新领域不需要两把椅子" |
| 权益 100% / 防御 0% | 达里奥·全天候 + 塔勒布·反脆弱 | 结构性风险，优先级高于任何合并 |

### 输出产物

分析结果写入 `skills/portfolio/overlap_analysis.html`，包含：
1. 8 法则评分卡片 + 雷达图
2. 基金×重仓股 热力图
3. CPO 四基金持仓横向对比柱状图
4. 逐条原则驱动的合并建议
5. 合并前后组合对比
6. 季度自检清单（关联 notes.md）

### 数据采集脚本

```bash
# 拉取所有主动基金的前十大持仓（AKShare，约 15s）
python -c "
import akshare as ak
for code in ['022364','016372',...]:
    df = ak.fund_portfolio_hold_em(symbol=code, date='2026')
    latest = df[df['季度']==df['季度'].max()]
    print(latest[['股票代码','股票名称','占净值比例']])
"
```

注意：指数基金（ETF联接）不需要逐只拉持仓，直接查跟踪指数的成分股即可。

## 已知问题

- `daily.py` 中 `HOLDINGS_FILE` 路径曾经指向 `SKILL_DIR / "holdings.json"`，实际文件在 `data/` 子目录下，已修正为 `SKILL_DIR / "data" / "holdings.json"`
- `generate.py` 中 `FUND_LIST` 是硬编码的，新增基金后需同步更新 `holdings.json`、`generate.py`、本 SKILL.md 三处
- Windows 终端中文打印需要 `PYTHONIOENCODING=utf-8`，否则 UnicodeEncodeError
- SST 个股行情 (`sst_stocks.json`, `sst_factors.json`) 的更新脚本目前不存在，需补充
