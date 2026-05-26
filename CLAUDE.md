---
name: oh-my-quant
description: 量化金融 Agent Skills 纯合集——8 个 Claude Code 自定义 skills + 1 个 benchmark 模块，覆盖数据、因子、回测、风险、研究、情报、机构共识和基准评测。
---

# oh-my-quant

量化金融 Claude Code Agent Skills 合集。8 个 skills + 1 个 benchmark 模块 + `whyj-quant` CLI 入口。

> **⛔ PUSH 阻断规则: 每次 push 前必须通过 `/codex:review`，未通过或未执行 = 禁止 push。**
>
> **执行命令**:
> ```
> codex review --base main -c windows.sandbox=unelevated
> ```
> `-c windows.sandbox=unelevated` 是 Windows 下绕过沙箱 `spawn setup refresh` 错误的必要参数。Review 通过后才能 push。

## 项目结构

## 项目结构

```
oh-my-quant/
├── CLAUDE.md              # 本文件
├── README.md
├── CHANGELOG.md
├── docs/reference.MD      # 量化资源索引
├── benchmark/             # 评测 skill + 数据 + 结果
│   ├── SKILL.md           #   策略评测 skill（对齐 AI-Trader）
│   ├── scripts/           #   score.py, dashboard.py, metric_pages.py, kline_chart.py
│   ├── data/              #   评测输入（OHLCV、因子面板，alpha 清单）
│   ├── results/           #   评测结果 JSON/CSV
│   └── metrics/           #   HTML 指标页（6 个 metric + K-line + Dashboard）
├── skills/                # 8 个 Agent Skills
    ├── data/              # 数据获取与清洗 + scripts/fetch.py
    ├── factor/            # 因子研究 + scripts/compute.py, analysis.py
    ├── backtest/          # 策略回测 + scripts/metrics.py
    ├── risk/              # 风险管理 + scripts/risk_metrics.py, optimize.py
    ├── research/          # 综合研究入口（编排 data→factor→backtest→risk）
    ├── intel/             # 投资大师观点抓取（手动 + Cron 定期）
    ├── consensus/         # 顶级基金 13F 共识持仓分析 + scripts/consensus.py
    └── validate/          # 验证 skills+CLI 工具 + scripts/smoke_test.py, cross_check.py
```

## Skills 体系

| Skill | 触发词 | 功能 |
|-------|--------|------|
| `data` | 数据/行情/下载/清洗 | AKShare/yfinance/MCP 数据获取 |
| `factor` | 因子/alpha/IC/选股 | 因子计算→预处理→IC→分层 |
| `backtest` | 回测/backtest/绩效 | 策略回测→绩效报告→可视化 |
| `risk` | 风险/VaR/压力测试/组合优化 | 风险指标+压力测试+优化 |
| `research` | 量化研究/策略研究/完整流程 | 编排上述 4 个 skills |
| `intel` | 巴菲特/Dalio/大师/股东信 | 投资大师观点抓取 |
| `consensus` | 顶级基金/机构共识/13F 共识加仓 | 多管理人持仓共识分析 |
| `benchmark` | benchmark/评测/对比/排名 | 策略评测（对齐 AI-Trader），位于 `benchmark/` 目录 |
| `validate` | 验证/validate/测试 skill/回归 | 验证 skills+CLI 工具，cross-check 对账 |

## UI 设计系统

**所有涉及 UI 的 skill 和脚本必须遵守 [`docs/DESIGN.md`](docs/DESIGN.md)**（NewForm Alpha 规范）：

- 零阴影（Zero Shadow Policy），深度仅通过 1px 发丝线 + 色块切换表达
- 双氛围：奶油白 Hero 区（`#F7F9F6`）+ 引擎黑数据区（`#121413`）
- 单强调色：薄荷绿 `#39E180`，仅用于关键信号/操作端点
- Inter 字体，Display: 800 重 + -1.8px 紧排；Mono: SF Mono
- 动画 0ms 硬切换，圆角 ≤ 2px，间距基于 4px 倍数
- 配色 Token 从 `docs/DESIGN.md` YAML frontmatter 读取，禁止硬编码色值

## 设计原则

- 每个 skill 是可被 agent 直接执行的操作指令，非教学文档
- 代码逻辑分散到各 skill 的 `scripts/` 目录，skill 之间无代码依赖
- 评测基准对齐 [AI-Trader](https://arxiv.org/abs/2512.10971)（实时/最小信息/三大市场）
- 参考 [awesome-trading-agents](https://github.com/LLMQuant/awesome-trading-agents) 生态

## 开发约定

- **每次 push commit 前，必须调用 `/codex:review` 进行代码审查**，检查项包括：
  - SKILL.md 是否面向 agent（非人类教学文档）
  - scripts/ 是否功能完整、无安全漏洞
  - 跨 skill 引用是否一致
  - Python 代码是否符合项目规范
- 审查通过后才能 push
- **每次 push 前必须更新文档**（README.md、CHANGELOG.md、docs/reference.MD），确保与代码同步
- Commit 按功能拆分，一个 commit 只做一个改动
