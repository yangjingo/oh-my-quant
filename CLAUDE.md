---
name: oh-my-quant
description: WhyJ Quant — 量化分析交互终端 (Bun + TypeScript + frame-buffer TUI + AI Agent)
---

# oh-my-quant

## 目标

`whyj` 是一个交互式量化分析终端，提供：

- 股票/基金数据抓取（直连数据源：tushare / financial-datasets / llmquant-data）
- 技术因子计算（动量、反转、波动率、RSI、均线偏离、成交量比）
- 双均线策略回测 + 风险指标（VaR、CVaR、夏普、最大回撤）
- Benchmark 三维度评分（收益/风险/稳健性 100分制）
- AI Agent（自然语言驱动分析，基于 pi agent core + Anthropic SDK）
- 个人投资组合看板

- ## Conversational Style

- Keep answers short and concise
- No emojis in commits, issues, PR comments, or code
- No fluff or cheerful filler text (e.g., "Thanks @user" not "Thanks so much @user!")
- Technical prose only, be direct
- When the user asks a question, answer it first before making edits or running implementation commands.
- When responding to user feedback or an analysis, explicitly say whether you agree or disagree before saying what you changed.

## 结构

```text
oh-my-quant/
├── src/
│   ├── index.ts              # 入口 (interactive REPL 或 one-shot)
│   ├── app.ts                # TUI 启动编排
│   ├── tui/                  # frame-buffer TUI (src/ + test/)
│   ├── agent/                # AI Agent (pi core + Anthropic shim + session)
│   ├── tools/                # AgentTool 定义 (TypeBox schemas)
│   ├── cli/                  # Slash command parser + dispatcher
│   ├── skill/                # Skill 模块 (安装/发现/调用)
│   ├── quant/                # 计算 + 分组对比: factor, backtest, risk, benchmark, comparison
│   ├── source/               # AKShare + direct market data adapters
│   ├── storage/              # .ohquant/ 本地文件读写
│   └── types/                # 共享类型 + 错误系统
├── .ohquant/
│   ├── settings.json         # 应用配置
│   ├── benchmark/results/    # 跑分结果
│   └── data/                 # 市场数据缓存
├── docs/                     # 设计文档 + CLI 手册
├── package.json              # npm: whyj-quant, bin: whyj
├── tsconfig.json             # strict mode
├── bunfig.toml
└── DESIGN.md                 # NewForm brutalist 设计系统
```

## 约定

- **Bun** 作为运行时和包管理，不要用 npm/yarn 安装依赖
- `DESIGN.md` 是项目唯一的 UI 设计系统来源
- `docs/notes.md` 是投资原则和知识体系的唯一真源
- `docs/reference.md` 是量化资源索引
- `.ohquant/` 下所有数据为本地存储，不提交 git；存储策略见 `docs/ohquant-storage-policy.md`
- `.ohquant/data/` 与 `.ohquant/cache/` 只缓存可重取的市场公开数据或派生结果
- portfolio 信息（持仓、净值、仓位、个人组合）是 live-only 私有状态，不允许缓存、推断或读取 `.ohquant/portfolio/`
- `.env` 中存放 API keys，不提交 git
- CLI 只暴露已实现并能运行的命令
- 未实现的功能列在 `ROADMAP.md`
- Push 前先做代码审查
- import 用 `.ts` 扩展名 (verbatimModuleSyntax)
- 文件命名: 源码用 kebab-case，测试用 `*.test.ts`，文档用 kebab-case `.md`


- Read files in full before wide-ranging changes, before editing files you have not fully inspected, and when asked to investigate or audit. Do not rely on search snippets for broad changes.
- No `any` unless absolutely necessary.
- Inline single-line helpers that have only one call site.
- Check node_modules for external API types; don't guess.
- **No inline imports** (`await import()`, `import("pkg").Type`, dynamic type imports). Top-level imports only.
- Never remove or downgrade code to fix type errors from outdated deps; upgrade the dep instead.
- Use only erasable TypeScript syntax (Node strip-only mode) in code checked by the root config (`packages/*/src`, `packages/*/test`, `packages/coding-agent/examples`): no parameter properties, `enum`, `namespace`/`module`, `import =`, `export =`, or other constructs needing JS emit. Use explicit fields with constructor assignments.
- Always ask before removing functionality or code that appears intentional.
- Do not preserve backward compatibility unless the user asks for it.
- Never hardcode key checks (e.g. `matchesKey(keyData, "ctrl+x")`). Add defaults to `DEFAULT_EDITOR_KEYBINDINGS` or `DEFAULT_APP_KEYBINDINGS` so they stay configurable.
- Never modify `packages/ai/src/models.generated.ts` directly; update `packages/ai/scripts/generate-models.ts` instead, then regenerate. Including the resulting `models.generated.ts` diff is always OK, even if regeneration includes unrelated upstream model metadata changes.


### 实现时先读参考设计

**任何 CLI / UI / 核心逻辑的实现，必须先查阅对应的设计文档，直接复用其中的架构、组件树、数据流和接口定义，不要凭空造。**

| 实现领域 | 必须先读的参考文档 |
|---------|-------------------|
| CLI 架构、slash 命令参考、`src/cli/` 模块、数据流、实施计划 | `docs/interactive-cli-design.md` |
| AI Agent 架构、Tool 系统、System Prompt、数据存储、Session 管理 | `docs/agent-system-spec.md` |
| 颜色、字体、间距、组件样式、品牌规则 | `DESIGN.md` |
| 数据源 API、Python 库速记 | `docs/reference.md` |

**Why:** 这些文档包含了完整的架构决策、组件树、事件流、数据格式和接口签名。绕过它们直接写代码会导致与设计不一致的 API 签名、错误的组件结构、不匹配的颜色方案，以及遗漏关键的架构约束（如双队列系统、缓存优先数据源、事件驱动 UI 更新）。

## 技术栈

| 层 | 选型 |
|---|------|
| Runtime | Bun + TypeScript (strict) |
| TUI | Custom frame-buffer cell grid (详见 docs/tui-layout-design.md) |
| AI Agent | @anthropic-ai/sdk + pi agent core (vendor) |
| 数据 | direct adapters + 本地文件 |
| Schema | TypeBox (agent tools) + Zod |
| 构建 | bun build |

---

## 行为准则

**Tradeoff:** 这些准则偏向谨慎而非速度。对简单任务可自行判断。

### 1. 先想再写

**不要假设。不要隐藏困惑。主动暴露权衡。**

动手之前：
- 明确说出你的假设。不确定就问。
- 如果存在多种理解，全部列出来 — 不要沉默地选一个。
- 如果有更简单的方法，说出来。值得反驳时就反驳。
- 有不清楚的地方就停。说出哪里困惑。问。

### 2. 简单优先

**解决问题的最小代码量。零投机代码。**

- 不写没被要求的功能。
- 不为单次使用创建抽象。
- 不写没被要求的"灵活性"或"可配置性"。
- 不为不可能的场景写错误处理。
- 如果写了 200 行但 50 行就能搞定，重写。

自问: "高级工程师会觉得这是过度设计吗？" 如果是，简化。

### 3. 手术式修改

**只碰你该碰的。只清你造的垃圾。**

编辑已有代码时：
- 不"顺手优化"旁边的代码、注释或格式。
- 不重构没坏的东西。
- 匹配已有风格，哪怕你会用不同的方式。
- 发现无关的 dead code，提一句 — 不要删。

你的改动造成 orphans 时：
- 删除因为你改动而产生的无用 imports/variables/functions。
- 不删除之前就存在的 dead code，除非被要求。

测试标准: 每行改动都能追溯到用户的请求。

### 4. 目标驱动执行

**定义成功标准。循环直到验证通过。**

把任务转化为可验证的目标：
- "加校验" → "写一个测试验证非法输入，然后让它通过"
- "修 bug" → "写一个测试复现它，然后修复"
- "重构 X" → "确保重构前后测试都通过"

多步骤任务，先陈述简短计划：
```
1. [步骤] → verify: [检查方式]
2. [步骤] → verify: [检查方式]
```

强成功标准让你独立循环。弱标准（"让它能用"）则需不断确认。

---

**这些准则在起作用的表现是:** diff 中不必要的改动减少、不会因过度设计而重写、澄清问题在实现之前提出，而非在犯错之后。

## gstack review

本项目只使用 gstack 的 review 类 skills：

- `/review`
- `/design-review`
- `/devex-review`
- `/plan-ceo-review`
- `/plan-design-review`
- `/plan-devex-review`
- `/plan-eng-review`

当用户需求不明确、存在多种解释、实现范围可能漂移，或计划/设计/代码之间不一致时，先运行对应的 review skill 来明确需求，不要直接实现。

需求仍不清楚时，要进行多轮 review：先用 plan review 明确目标、范围和成功标准，再根据任务类型使用 design/devex/code review 复核，直到需求、约束、验收标准和下一步动作都清楚。review 后仍有关键歧义时，停下来向用户提问。
