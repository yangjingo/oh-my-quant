# Changelog

## [0.1.0] — 2026-05-26

### Added (续)
- `DESIGN.md` — NewForm brutalist 设计系统（Google Stitch Alpha 规范），YAML 结构化 Token
- K-line 走势图 — Plotly 交互式蜡烛图（NewForm 引擎黑主题，MA5/MA20/MA60 + 成交量）
- Benchmark 数据集：沪深 300 成分股 + Vibe-Trading 452 alpha 清单 + INVESTORBENCH
- HTML Dashboard：NewForm 双氛围（奶油白 Hero + 引擎黑数据区），评级分布，策略排名，K 线嵌入

## [0.1.0] — 2026-05-25

### Added

**Skills (8 个)**:
- `data` — A 股/美股数据获取与清洗，支持 AKShare、yfinance，parquet 缓存
- `factor` — 因子计算、MAD 去极值、行业-市值中性化、IC 分析、分层回测
- `backtest` — 策略回测与绩效报告，backtrader/vectorbt 双框架，含向量化简易引擎
- `risk` — VaR/CVaR 计算、历史情景压力测试、组合优化（最大夏普/风险平价/最小方差）
- `research` — 综合研究入口，编排 data → factor → backtest → risk 全流程
- `intel` — 投资大师观点抓取，覆盖 Buffett/Munger/Dalio/Marks/Druckenmiller 等 10 位大师，支持手动 + Cron 定期
- `benchmark` — 策略基准评测，三维评分（收益/风险/稳健性），对齐 AI-Trader [2512.10971] 评测范式
- `validate` — Skills & CLI 验证，支持冒烟测试、cross-check 对账、外部工具检查

**CLI**:
- `whyj-quant` — click-based 命令行入口，`whyj-quant run -p "..."` 自然语言路由到对应 skill

**Docs**:
- `docs/reference.MD` — 量化资源索引：MCP Servers、Agent Skills、Python 库、AI Trading 平台、数据源、学习资料
- `CHANGELOG.md` — 本文件

### Design Decisions
- 纯 skills 合集，代码分散到各 skill 的 `scripts/` 目录，skill 间零代码依赖
- SKILL.md 面向 AI agent 编写（操作指令），非人类教学文档
- 评测基准对齐 HKUDS AI-Trader 论文，风控权重 40%
- 使用 `uv` 管理 CLI 项目依赖
- Push 前强制 `/codex:review`

### References
- [AI-Trader](https://arxiv.org/abs/2512.10971) — Agent trading 实时评测基准
- [Vibe-Trading](https://github.com/HKUDS/Vibe-Trading) — 自然语言量化研究 CLI（452 alpha zoo）
- [awesome-trading-agents](https://github.com/LLMQuant/awesome-trading-agents)
- [nof1.ai](https://nof1.ai/) — AI 自主交易
