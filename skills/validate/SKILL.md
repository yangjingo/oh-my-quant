---
name: validate
description: |
  Skills & CLI 工具验证。触发场景：验证、validate、测试 skill、check tool、集成测试、regression test、对账。
  验证已有 skills 和 CLI 工具（Vibe-Trading、AI-Trader 等）是否正确工作，运行集成测试，生成验证报告。
  当用户想确认 skill 是否生效、对比 skill 输出与 CLI 工具输出、或做端到端回归测试时使用。
---

# validate

验证 skills 和 CLI 工具是否正常工作。

## 验证目标

本 skill 验证三类目标：
1. **项目内 skills** — 验证 oh-my-quant 的 7 个 skills 是否能正确完成任务
2. **外部 CLI 工具** — 验证 Vibe-Trading、AI-Trader 等工具是否可调用且输出正确
3. **一致性对账** — 对比同一任务下 skill 输出 vs CLI 工具输出的一致性

## 已知外部工具

| 工具 | CLI | MCP | 用途 |
|------|-----|-----|------|
| Vibe-Trading | `vibe-trading run -p "..."` | `vibe-trading-mcp` | 自然语言回测 + alpha zoo |
| AI-Trader | 注册到 ai4trade.ai | 通过 SKILL.md | Agent 交易信号 |

## 验证工作流

### 模式 1: 单 skill 冒烟测试

验证单个 skill 是否能完成最基本任务。

```
输入: skill 名称 (data / factor / backtest / risk / research / intel / benchmark)
操作: 用该 skill 的最小可行 prompt 测试
输出: pass/fail + 耗时 + token 用量 + 输出摘要
```

测试用例:
- `data`: "下载平安银行 2024 年日线数据"
- `factor`: "计算 000001 的 20 日动量因子"
- `backtest`: "回测平安银行 2024 年 20/60 均线交叉策略"
- `risk`: "计算上证指数 2024 年的 VaR 和最大回撤"
- `intel`: "抓取 Howard Marks 最新一篇备忘录的核心观点"
- `benchmark`: "对沪深 300 买入持有策略进行基准评测"

### 模式 2: Cross-Check 对账

同一任务，分别用 skill 和 CLI 工具执行，对比结果。

```
输入: 任务描述
操作:
  1. 用 oh-my-quant skill 执行
  2. 用 vibe-trading run -p "同样的任务" 执行
  3. 对比关键指标（收益/回撤/夏普）是否在容差范围内
输出: 对比报告 (指标 diff 表 + 一致性结论)
```

容差标准:
- CAGR 差值 < 2%: 一致
- 夏普差值 < 0.2: 一致
- 最大回撤差值 < 5%: 一致

### 模式 3: 全量回归测试

跑全部 skills 的冒烟测试 + 端到端流程。

```
运行 research skill 的端到端流程:
  data → factor → backtest → risk → 综合报告
验证每一步的输出格式和关键指标是否合理
输出: 回归测试报告
```

## 输出格式

```markdown
## 验证报告 — {timestamp}

### 冒烟测试
| Skill | 状态 | 耗时 | 输出摘要 |
|-------|------|------|----------|
| data | ✓ | Xs | 获取 242 行 OHLCV |
| factor | ✓ | Xs | IC Mean=0.03 |
| ... | | | |

### Cross-Check (如有)
| 任务 | Skill 结果 | CLI 结果 | Diff | 一致性 |
|------|-----------|---------|------|--------|
| 均线回测 | CAGR=12% | CAGR=13% | 1% | ✓ |

### 端到端流程 (如有)
- research skill: ✓ 4 步全部通过
- 综合报告: 输出完整

### 总体评分: X/7 通过
```

## scripts/ 工具

- `scripts/smoke_test.py` — 运行单个 skill 冒烟测试
- `scripts/cross_check.py` — 对比 skill 输出与 CLI 输出
