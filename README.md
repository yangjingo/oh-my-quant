# oh-my-quant

量化金融 Agent Skills 合集 — 7 个 Claude Code / Codex 自定义 skills + 1 个 benchmark 模块。

## Skills

| Skill | 用途 |
|-------|------|
| `data` | 数据获取与清洗（AKShare/yfinance） |
| `factor` | 因子研究与 IC 分析 |
| `backtest` | 策略回测与绩效报告 |
| `risk` | 风险管理与组合优化 |
| `research` | 综合研究入口（编排上述 4 个） |
| `intel` | 投资大师观点抓取（10 位大师，手动+Cron） |
| `validate` | 验证 skills & CLI 工具（冒烟 + cross-check） |

## Benchmark 模块

| 组件 | 用途 |
|------|------|
| `benchmark/SKILL.md` | 策略评测 skill（对齐 AI-Trader） |
| `benchmark/scripts/score.py` | 三维评分引擎（收益/风险/稳健性） |
| `benchmark/scripts/dashboard.py` | 统计看板，聚合评测结果 |
| `benchmark/scripts/kline_chart.py` | K 线走势图模板（NewForm 主题） |
| `benchmark/data/` | 评测数据（成分股、alpha 清单） |
| `benchmark/results/` | 评测结果 JSON |
| `benchmark/reports/` | 可视化报告（HTML Dashboard + K-line） |
| `docs/DESIGN.md` | NewForm 设计系统（所有 UI 强制遵守） |

## 项目结构

```
oh-my-quant/
├── skills/                # 7 个 skills，每个含 SKILL.md + scripts/
├── benchmark/             # 评测 skill + 数据 + K 线模板 + 看板
├── src/whyj_quant/        # CLI 入口 (whyj-quant)
├── docs/
│   ├── DESIGN.md           # NewForm 设计系统 (Google Stitch Alpha 规范)
│   └── reference.MD        # 量化资源索引
├── docs/reference.MD      # 量化资源索引
├── CHANGELOG.md
└── CLAUDE.md              # Agent 项目指令
```

## 使用

```bash
uv sync                                   # 安装依赖 + CLI
whyj-quant run -p "回测平安银行均线策略"    # 自然语言入口
whyj-quant validate all                    # 验证全部 skills
whyj-quant dashboard                       # 统计看板
whyj-quant backtest run --symbol 000001    # 单功能命令
```

## 参考

- [AI-Trader](https://arxiv.org/abs/2512.10971) — Agent trading 实时评测基准
- [Vibe-Trading](https://github.com/HKUDS/Vibe-Trading) — 自然语言量化研究 CLI（452 alpha zoo）
- [awesome-trading-agents](https://github.com/LLMQuant/awesome-trading-agents)
- [nof1.ai](https://nof1.ai/) — AI 自主交易
