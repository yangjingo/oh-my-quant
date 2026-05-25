---
name: intel
description: |
  投资大师观点抓取。触发场景：投资大师、巴菲特、股东信、Dalio、芒格、Howard Marks、备忘录、13F、投资哲学、大师观点、投资情报。
  抓取 10 位投资大师（Buffett/Munger/Dalio/Marks/Lynch/Klarman/Druckenmiller/Burry/Jones/Wood）的最新演讲、股东信、访谈和 13F 持仓变化。
  支持手动查询和 Cron 定期自动抓取。
---

# intel

抓取投资大师观点，结构化提取关键信息。

## 追踪清单

| 大师 | 来源 | 方法 |
|------|------|------|
| Warren Buffett | berkshirehathaway.com/letters | WebFetch |
| Charlie Munger | 过往经典（已故） | WebSearch |
| Ray Dalio | LinkedIn / bridgewater.com | WebFetch |
| Howard Marks | oaktreecapital.com/insights/memos | WebFetch |
| Peter Lynch | 经典资料（已退休） | WebSearch |
| Seth Klarman | Baupost 股东信 | WebSearch |
| Stanley Druckenmiller | SEC 13F | MCP / efiance |
| Michael Burry | SEC 13F / X | MCP / WebSearch |
| Paul Tudor Jones | CNBC 访谈 | WebSearch |
| Cathie Wood | ARK Invest / YouTube | WebFetch |

## 手动模式工作流

1. 确定目标（指定大师 or 全部）和时间范围
2. 用 WebFetch / WebSearch / MCP 抓取来源
3. 每条内容提取: 核心主题 + 3-5 关键观点 + 市场判断 + 与历史观点的变化 + 研究启发
4. 输出格式化报告

## 输出格式

```markdown
## 投资大师观点速报 — {日期范围}

### {大师名}
**来源**: {URL/出处}
**核心主题**: 一句话
**关键观点**:
1. ...
2. ...
**市场判断**: ...
**研究启发**: ...

### 13F 持仓变动
| 大师 | 新增 | 增持 | 减持 | 清仓 | 解读 |
|------|------|------|------|------|------|
```

## 多大师共识分析

```markdown
### 当前共识 → 值得关注
| 观点 | 支持者 | 反对者 |
### 当前分歧 → 值得深研
```

## Cron 定期抓取

设置 CronCreate:
- 每周: `"0 9 * * 1"` — 抓活跃大师（Dalio/Marks/Wood）
- 每月: `"0 9 1 * *"` — 全部追踪 + 月度报告
- 每季: `"0 9 15 1,4,7,10 *"` — 13F 深度分析

## 数据保存

```
data/intel/{YYYY-MM}/
  ├── buffett_2026_letter.md
  ├── marks_memo_20260515.md
  └── 13f_q1_2026.md
```
