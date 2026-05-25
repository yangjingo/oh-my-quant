---
name: oh-my-quant
description: 量化金融 Agent Skills 纯合集——8 个 Claude Code 自定义 skills，覆盖数据、因子、回测、风险、研究、情报和基准评测。
---

# oh-my-quant

量化金融 Claude Code Agent Skills 合集。8 个 skills + `whyj-quant` CLI 入口。

## 项目结构

```
oh-my-quant/
├── CLAUDE.md              # 本文件
├── README.md
├── docs/reference.MD      # 量化资源索引
└── skills/                # 8 个 Agent Skills
    ├── data/              # 数据获取与清洗 + scripts/fetch.py
    ├── factor/            # 因子研究 + scripts/compute.py, analysis.py
    ├── backtest/          # 策略回测 + scripts/metrics.py
    ├── risk/              # 风险管理 + scripts/risk_metrics.py, optimize.py
    ├── research/          # 综合研究入口（编排 data→factor→backtest→risk）
    ├── intel/             # 投资大师观点抓取（手动 + Cron 定期）
    ├── benchmark/         # 策略评测 + scripts/score.py
    └── validate/          # 验证 skills+CLI 工具 + scripts/smoke_test.py, cross_check.py
```

## Skills 体系

| Skill | 触发词 | 功能 |
|-------|--------|------|
| `data` | 数据/行情/下载/清洗 | AKShare/yfinance 数据获取 |
| `factor` | 因子/alpha/IC/选股 | 因子计算→预处理→IC→分层 |
| `backtest` | 回测/backtest/绩效 | 策略回测→绩效报告→可视化 |
| `risk` | 风险/VaR/压力测试/组合优化 | 风险指标+压力测试+优化 |
| `research` | 量化研究/策略研究/完整流程 | 编排上述 4 个 skills |
| `intel` | 巴菲特/Dalio/大师/股东信 | 投资大师观点抓取 |
| `benchmark` | benchmark/评测/对比/排名 | 策略标准化评测（对齐 AI-Trader） |
| `validate` | 验证/validate/测试 skill/回归 | 验证 skills+CLI 工具，cross-check 对账 |

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
