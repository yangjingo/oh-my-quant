# Skill 系统

项目 trading skill 安装在 `.ohquant/skills/` 下，通过 `SKILL.md` 约定在运行时自动发现。使用 `/skill` 列出，`/skill:name` 调用。

## 架构

```
src/skill/          ← whyj skill 模块（安装/CLI handler/TUI suggestions）
src/agent/src/      ← 桥接层：discoverSkills() → QuantSkill → AgentHarness
src/agent/src/pi/   ← pi harness 通用引擎：文件加载、验证、formatSkillInvocation
src/tui/src/        ← 对话渲染（⚡ skill:name）和 Composer 建议
```

`src/skill/` 目录：

| 文件 | 职责 |
|---|---|
| `types.ts` | `SkillEntry`（TUI 建议）、`SkillState`（对话展示） |
| `store.ts` | `SKILLS_DIR`、`ensureDefaultSkills()`、`installSkills()` |
| `handler.ts` | CLI 命令：list / info / run / install / `:name` 直接调用 |
| `index.ts` | 公共导出 |

## 生命周期

### 1. 安装

启动时自动安装，无需用户操作：

```
app.ts:startApp()
  → ensureDefaultSkills()
    → git clone --depth 1 LLMQuant/skills           → .ohquant/skills/LLMQuant-skills/
    → git clone --depth 1 tradermonty/claude-trading-skills → .ohquant/skills/tradermonty-claude-trading-skills/
```

- 首次运行 clone，后续跳过（目录已存在）
- 手动安装：`/skill install <owner/repo>`，已存在则 `git pull`
- 路径由 `OHQUANT_SKILLS_DIR` 环境变量覆盖
- 默认安装的两个仓库只暴露 `CORE_SKILL_NAMES` 白名单中的 10 个核心 skill；避免递归扫描仓库示例、模板、元工具或完整 trading skill 集
- 非默认手动安装仓库仍优先加载其 `skills/` 子目录；如果没有 `skills/` 子目录，则加载仓库根目录

### 2. 外部集成开关

WhyJ Quant 默认不加载用户级 Codex/Claude skill，避免 `docx`、`figma`、`deploy` 等通用工作流污染量化 agent 的 system prompt。

配置位置：

```
/config
  → Codex Skills   on/off   # ~/.codex/skills
  → Claude Skills  on/off   # ~/.claude/skills, ~/.agents/skills, ~/.pi/agent/skills
```

对应 `.ohquant/settings.json`：

```json
{
  "skillIntegrations": {
    "codex": false,
    "claude": false
  }
}
```

启用后，这些用户级 skill 会进入 `/skill` 列表和 `<available_skills>`。保持关闭时，只有项目内 `.agents/skills`、`.pi/skills` 和 `.ohquant/skills` 中的量化 skill 可见。

### 3. 发现

AgentHarness 初始化时加载所有 skill：

```
session.ts:initialize()
  → discoverSkills({ cwd, env, extraPaths: skillPaths(), integrations: settings.skillIntegrations })
    → resolveSkillSources()
      默认收集：项目祖先目录的 .agents/skills/、.pi/skills/、extraPaths
      可选收集：~/.codex/skills、~/.claude/skills、~/.agents/skills、~/.pi/agent/skills
    → loadSourcedSkills() → loadSkillsFromDirInternal()
      → 递归遍历目录，读取 SKILL.md
      → 解析 YAML frontmatter（name 必填，description 必填）
      → 校验：name 小写+连字符 ≤64字符，description ≤1024字符
    → 按 name 去重（先到先得）
  → this.skills = QuantSkill[]
  → AgentHarness.resources.skills = QuantSkill[]
```

TUI 独立加载（不依赖 Agent 是否启动）：

```
tui.ts:start() → this.loadSkills()
  → discoverSkills({ extraPaths: skillPaths(), integrations: settings.skillIntegrations })
  → SkillEntry[] → buildSuggestions() 用
```

### 4. 注入 System Prompt

```
context.ts:buildSystemPrompt()
  → formatSkillsForSystemPrompt(skills)
    → 过滤：排除 disableModelInvocation === true 的 skill
    → 生成 XML：
      <available_skills>
        <skill>
          <name>llmquant-macro</name>
          <description>Fed, central-bank, inflation, growth, liquidity</description>
          <location>.ohquant/skills/LLMQuant-skills/skills/llmquant-macro/SKILL.md</location>
        </skill>
        ...
      </available_skills>
  → 追加到 system prompt 末尾
```

LLM 看到 `<available_skills>` 后按 description 自行决定何时使用。

### 5. 调用（两条路径）

**A. LLM 隐式调用** — 模型从 system prompt 读取 skill 定义，认为相关时自动参考其指令内容。

**B. 显式 `/skill:name` 调用**：

```
Composer 输入 "/skill:llmquant-macro 分析当前宏观环境"
  → parseCommand() → command="skill", positional=["llmquant-macro", "分析当前宏观环境"]
  → app-runtime.ts: isSkillInvoke = true
    → push UIMessage { role: "skill", skill: { name, label, status: "running" } }
    → emitMessages() → TUI 显示 "⚡ skill:llmquant-macro  0.5s"
  → executeCommand() → skillHandler
    → 查找 skill 对象 → agentSession.skill("llmquant-macro", "分析当前宏观环境")
      │
      ▼ AgentHarness.skill(name, extra)
        → 在 this.resources.skills 中按 name 查找
        → 未找到 → throw "Unknown skill"
        → formatSkillInvocation(skill, extra)
          包装为 user message：
          <skill name="llmquant-macro" location=".ohquant/skills/.../SKILL.md">
          References are relative to .ohquant/skills/.../
          {skill.content}
          </skill>

          {extra instructions}
        → executeTurn(turnState, formattedText)
          → LLM 处理 skill 内容 + 额外指令
          → LLM 可调用任何已注册 Tool（fetch_bars, compute_factor, …）
          → LLM 返回分析结果
        → 返回 AssistantMessage
  → finalizeSkillMessage(false) → status: "done"
```

### 6. TUI 渲染

```
对话中：
  ⚡ skill:llmquant-macro  2.1s      ← running 时显示耗时
  ⚡ skill:llmquant-macro             ← done 后显示
  ✗ skill:unknown-skill               ← error

建议栏（/skill 或 /ski）：
  skill:llmquant-macro  [p] Router skill for LLMQuant macro workflows...
  skill:position-sizer  [p] Calculate risk-based position sizes...
  ...
  / Commands (1/23)                    ← 可上下滚动
```

## 与 pi AgentHarness 的关系

- `AgentHarness<TSkill, TPromptTemplate, TTool>` 是泛型类，whyj 实例化：`AgentHarness<QuantSkill, PromptTemplate, AgentTool>`
- Skill **不是可执行函数**，是指令文本 — 通过 `formatSkillInvocation()` 包装后作为 user message 注入 agent turn
- `AgentHarness.skill(name, extra)` 流程：查找 → 格式化 → `executeTurn()`，返回 `AssistantMessage`
- Skill turn 中 LLM 可调用所有 Tool（`equity_historical_prices`、`compute_factor` 等），与普通对话无异
- `disableModelInvocation: true` 的 skill 不会出现在 system prompt，只能通过 `/skill:name` 显式调用
- Skill 发现结果被缓存（`WHYJ_SKILL_CACHE=off` 可禁用，调试用）

## 关键文件

| 文件 | 说明 |
|---|---|
| `src/skill/store.ts` | 安装、路径、默认 repo |
| `src/skill/handler.ts` | CLI 命令实现 |
| `src/agent/src/skills.ts` | `discoverSkills()` 桥接函数 |
| `src/agent/src/pi/harness/skills.ts` | pi 通用 loader：`loadSkills()`、`formatSkillInvocation()` |
| `src/agent/src/pi/harness/agent-harness.ts:645` | `AgentHarness.skill()` |
| `src/agent/src/pi/harness/system-prompt.ts` | `formatSkillsForSystemPrompt()` → XML |
| `src/agent/src/context.ts` | `buildSystemPrompt()` 拼装 |
| `src/agent/src/session.ts` | `QuantAgentSession.skill()`、`getSkills()` |
| `src/tui/src/render.ts:595` | skill 消息渲染 |
| `src/tui/src/input.ts:127` | skill 建议生成 |
| `src/app-runtime.ts:253` | `isSkillInvoke` 检测 + `finalizeSkillMessage` |

---

## 技能目录

### 默认安装（10 个核心推荐，首次启动自动 clone）

#### LLMQuant (5)

| Skill | 触发场景 |
|---|---|
| `llmquant-data` | SEC filings, 13F, macro snapshots |
| `llmquant-macro` | Macro dashboards, Fed, inflation, GDP |
| `llmquant-equities` | Stock analysis, equity comparison, merger-arb |
| `llmquant-portfolio` | Thesis tracking, watchlist monitoring, alerts |
| `llmquant-risk` | Fear scoring, VIX regime, hedge design |

#### Trading (5) — 无需 API

| Skill | 触发场景 | 输出 |
|---|---|---|
| `market-breadth-analyzer` | 市场宽度、涨跌比健康度 | 0-100 综合评分 |
| `technical-analyst` | 图表分析、趋势识别 | 多场景概率评估 |
| `position-sizer` | 仓位计算、ATR 止损 | 股数、每笔风险 |
| `macro-regime-detector` | 宏观状态切换、收益率曲线 | 状态分类 |
| `market-environment-analysis` | 全球市场、risk-on/off | 多市场环境报告 |

### 仓库完整目录

`LLMQuant/skills` 仓库包含 18 个 LLMQuant skill（commodities, credit, crypto, data, equities, equity-derivatives, etfs, events, investor-lenses, macro, market-intelligence, options, portfolio, portfolio-lab, prediction-markets, rates-fx, risk, strategies）。WhyJ Quant 默认只暴露核心白名单中的 5 个 LLMQuant skill。

`tradermonty/claude-trading-skills` 仓库包含 50+ trading skill。WhyJ Quant 默认只暴露核心白名单中的 5 个 trading skill；examples、audits、workflows 和非核心 trading skill 不会进入模型可见 skill 列表。

---

## LLMQuant（18 个）— 完整目录

以数据为基础的量化工作流。每个都是 **router skill**：将自然语言意图路由到正确的 LLMQuant MCP 数据原语。

### 宏观 + 市场状态

```
market-environment-analysis ──── 全球跨资产环境报告
llmquant-macro ───────────────── Fed、央行、通胀、增长、流动性
llmquant-market-intelligence ─── 情绪仪表盘、事件概率信号
macro-regime-detector ────────── 结构性市场状态转换（1-2年周期）
```

| Skill | 触发场景 |
|---|---|
| `market-environment-analysis` | 全球市场、risk-on/off、板块分析、外汇、商品 |
| `llmquant-macro` | 宏观仪表盘、Fed/央行前瞻、通胀、GDP、流动性 |
| `llmquant-market-intelligence` | 市场情绪、事件概率、宏观观点 |
| `macro-regime-detector` | 市场状态转换、集中度/扩散、收益率曲线、板块轮动 |

### 股票 + 衍生品

```
llmquant-equities ────────────── 股票分析、对比、研究备忘录
llmquant-equity-derivatives ──── 可转债、权证、结构化收益
llmquant-etfs ────────────────── 持仓、重叠、集中度、主题敞口
llmquant-events ──────────────── 财报、并购、催化剂、监管风险
llmquant-options ─────────────── IV rank、Greeks、策略构建、盈亏模拟
```

| Skill | 触发场景 |
|---|---|
| `llmquant-equities` | 股票分析、股票对比、并购套利、卖出/止盈 |
| `llmquant-equity-derivatives` | 可转债、权证、结构化收益、混合证券 |
| `llmquant-etfs` | ETF 持仓、重叠、集中度、发行人快照 |
| `llmquant-events` | 财报简报、并购跟踪、催化剂、事件日历 |
| `llmquant-options` | IV rank、期权评分、Greeks、波动率曲面、财报 IV crush |

### 组合 + 风险

```
llmquant-portfolio ───────────── 论点跟踪、watchlist、公司档案
llmquant-portfolio-lab ───────── 敞口地图、假设模拟、虚拟组合
llmquant-risk ────────────────── 恐慌评分、VIX 状态、对冲设计
llmquant-credit ──────────────── 发行人信用、利差、高收益、条款
```

| Skill | 触发场景 |
|---|---|
| `llmquant-portfolio` | 论点跟踪、主题研究、watchlist 监控、提醒 |
| `llmquant-portfolio-lab` | 敞口地图、假设模拟、情景状态 |
| `llmquant-risk` | 恐慌评分、VIX 状态、对冲设计、研究健康检查 |
| `llmquant-credit` | 信用审查、利差状态、高收益压力、违约风险 |

### 跨资产 + 策略

```
llmquant-crypto ──────────────── 代币研究、永续合约资金费率、基差
llmquant-commodities ─────────── 现货、期货曲线、库存、展期收益
llmquant-rates-fx ────────────── 收益率曲线、久期、外汇 carry、实际利率
llmquant-prediction-markets ──── 事件概率、概率缺口、套利
llmquant-data ────────────────── SEC filings、13F holders、宏观快照
llmquant-strategies ──────────── 多空、事件驱动、宏观、量化 playbook
```

| Skill | 触发场景 |
|---|---|
| `llmquant-crypto` | 加密货币状态、代币研究、资金费率、杠杆 |
| `llmquant-commodities` | 商品现货、期货曲线、库存、展期收益 |
| `llmquant-rates-fx` | 收益率曲线、久期、央行政策分化、外汇 carry |
| `llmquant-prediction-markets` | 事件概率、结算标准、概率缺口 |
| `llmquant-data` | SEC filings、13F、宏观快照、数据源简报 |
| `llmquant-strategies` | 股票多空、事件驱动、宏观、量化、多策略 playbook |

### 元工具

```
llmquant-investor-lenses ─────── 基于 LLMQuant Data 的投资逻辑叠加
```

| Skill | 触发场景 |
|---|---|
| `llmquant-investor-lenses` | 投资风格逻辑叠加、基于证据的分析 |

---

## Trading（5 个）— 完整目录

这五个无需付费 API。

### 日常工作流

```
market-breadth-analyzer ──────── 市场宽度健康评分（0-100 综合）
market-environment-analysis ──── 全球跨资产环境（另见上方 LLMQuant 部分）
macro-regime-detector ────────── 结构性市场状态转换（1-2年周期）
```

| Skill | 触发场景 | 输出 |
|---|---|---|
| `market-breadth-analyzer` | 市场宽度、参与度、涨跌比健康度 | 6 个维度的 0-100 综合评分 |
| `market-environment-analysis` | 全球市场、risk-on/off、板块轮动 | 多市场环境报告 |
| `macro-regime-detector` | 市场状态转换、集中度、收益率曲线 | 市场状态分类 |

### 交易计划

```
technical-analyst ────────────── 图表驱动的技术分析、趋势、支撑/阻力
position-sizer ───────────────── 基于风险的头寸规模计算
```

| Skill | 触发场景 | 输出 |
|---|---|---|
| `technical-analyst` | 图表图片、趋势分析、支撑/阻力 | 情景计划、概率评估 |
| `position-sizer` | 仓位计算、买入股数、ATR 止损 | 股数、每笔风险、板块检查 |

---

## Skill 图

```
                    ┌─────────────────────────────┐
                    │   market-environment-analysis │  ← 全球跨资产
                    └──────────────┬──────────────┘
                                   │ feeds into
          ┌────────────────────────┼────────────────────────┐
          ▼                        ▼                        ▼
┌─────────────────┐    ┌─────────────────────┐    ┌─────────────────┐
│ macro-regime-   │    │ llmquant-macro      │    │ llmquant-market-│
│ detector        │    │                     │    │ intelligence    │
└────────┬────────┘    └──────────┬──────────┘    └────────┬────────┘
         │                        │                        │
         ▼                        ▼                        ▼
┌─────────────────────────────────────────────────────────────────┐
│                     组合决策层                                    │
│  llmquant-portfolio  llmquant-portfolio-lab  llmquant-risk      │
│  llmquant-credit     llmquant-strategies     position-sizer     │
└─────────────────────────────────────────────────────────────────┘
         │                        │                        │
         ▼                        ▼                        ▼
┌─────────────────────────────────────────────────────────────────┐
│                       执行 + 工具                                 │
│  llmquant-equities   llmquant-etfs    llmquant-options          │
│  llmquant-crypto     llmquant-commodities  llmquant-rates-fx    │
│  llmquant-equity-derivatives  llmquant-prediction-markets       │
└─────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
                    ┌─────────────────────────────┐
                    │   llmquant-events           │  ← 催化剂 + 日历
                    │   llmquant-data             │  ← SEC filings + 13F
                    │   llmquant-investor-lenses  │  ← 逻辑叠加
                    └─────────────────────────────┘
```

### 典型调用链

```
/skill:market-environment-analysis  →  全球态势
/skill:macro-regime-detector        →  市场状态
/skill:llmquant-portfolio           →  持仓审查
/skill:position-sizer               →  下一笔交易规模
```

### 无需 API 的入门路径

以下五个无需付费 API key：

```
market-breadth-analyzer  →  宽度综合评分（公开 CSV）
technical-analyst        →  图表驱动技术分析（用户提供图片）
position-sizer           →  纯计算（无需数据）
macro-regime-detector    →  跨资产比率分析
market-environment-analysis →  多市场报告（需要 web search）
```

---

## 参考

| 来源 | URL |
|---|---|
| LLMQuant Skills | <https://github.com/LLMQuant/skills> |
| Claude Trading Skills | <https://github.com/tradermonty/claude-trading-skills> |

---

## 附录：外部 Skill 生态

以下为社区中的量化/交易 skill 仓库，供学习和扩展参考（WhyJ Quant 未默认安装）。

### 股票研究

| 仓库 | 说明 |
|------|------|
| [tradermonty/claude-trading-skills](https://github.com/tradermonty/claude-trading-skills) | 美股全覆盖：市场状态、筛选、期权、Alpaca 组合管理 |
| [himself65/finance-skills](https://github.com/himself65/finance-skills) | 多资产类别：估值、财报、期权、ETF、流动性 |
| [JoelLewis/finance_skills](https://github.com/JoelLewis/finance_skills) | 84 个 skills：投管/合规/顾问/交易 |
| [quant-sentiment-ai/claude-equity-research](https://github.com/quant-sentiment-ai/claude-equity-research) | 买入/卖出/持有报告 |

### 策略编码 / 回测

| 仓库 | 说明 |
|------|------|
| [marketcalls/vectorbt-backtesting-skills](https://github.com/marketcalls/vectorbt-backtesting-skills) | vectorbt 配置、优化、对比模板 |
| [staskh/trading_skills](https://github.com/staskh/trading_skills) | 期权交易 + IBKR/Alpaca 数据能力配对 |

### 加密 / DeFi

| 仓库 | 说明 |
|------|------|
| [okx/onchainos-skills](https://github.com/okx/onchainos-skills) | 钱包、代币发现、DEX 互换 |
| [okx/agent-skills](https://github.com/okx/agent-skills) | 双语 skills + 贡献/安全指南 |

---

## 附录：AI 交易平台与量化生态

### 自主交易 Agent

| 平台 | 说明 |
|------|------|
| [nof1.ai](https://nof1.ai/) | AI 自主交易 agent，实盘驱动，TypeScript 实现。开源复刻：[OpenNof1](https://github.com/OpenNof1)、[alpha-arena-okx](https://github.com/alpha-arena-okx) |
| [TradingAgents](https://github.com/TauricResearch/TradingAgents) | 最受欢迎的 LangGraph 多 agent 框架，含 A 股本地化版本 |
| [ai-hedge-fund](https://github.com/virattt/ai-hedge-fund) | 多人格分析师（Buffett/Munger/Cathie Wood） |
| [AI-Trader](https://github.com/HKUDS/AI-Trader) | agent 原生交易平台，通过 SKILL.md 注册。18.7k stars。论文 [2512.10971](https://arxiv.org/abs/2512.10971)：首个全自动实时金融 agent 评测基准，覆盖美股/A 股/加密三大市场。核心发现：通用智能 ≠ 交易能力，风控能力决定跨市场鲁棒性，高流动性市场比政策驱动型市场更容易获得超额收益 |
| [Vibe-Trading](https://github.com/HKUDS/Vibe-Trading) | 开源量化研究 workspace，自然语言→回测，452 alpha zoo（qlib158/alpha101/gtja191/academic），7 回测引擎。CLI: `vibe-trading run -p "..."`, `vibe-trading alpha bench --zoo gtja191`。PyPI: `vibe-trading-ai` |
| [INVESTORBENCH](https://github.com/felis33/INVESTOR-BENCH) | ACL 2025 论文 [2412.18174](https://arxiv.org/abs/2412.18174)：首个面向 LLM agent 的金融决策评测基准，覆盖股票(BTC/ETH/美股/ETF)，FinMem agent 架构，Qdrant+RAG 记忆。评测 13 个 LLM，包含 warmup→test→eval 三阶段流程 |
| [FinRobot](https://github.com/AI4Finance-Foundation/FinRobot) | 学术级开源金融 AI agent 平台 |

### 量化平台

| 平台 | 说明 |
|------|------|
| [QuantConnect](https://www.quantconnect.com/) | 云端回测 + 实盘，LEAN 引擎 |
| [BigQuant](https://bigquant.com/) | AI 驱动的国内量化平台 |
| [聚宽 (JoinQuant)](https://www.joinquant.com/) | 国内最流行的在线量化平台之一 |
| [米筐 (RiceQuant)](https://www.ricequant.com/) | 专业级量化投研平台 |

### 学习资源

| 类别 | 资源 |
|------|------|
| 经典书籍 | 《量化交易——如何建立自己的算法交易事业》(Ernest Chan)、《算法交易：制胜策略与原理》(Ernest Chan)、《金融计量学——从初级到高级》(Ruey Tsay)、《统计套利》(Andrew Pole)、《主动投资组合管理》(Grinold & Kahn)、《因子投资》(Ang) |
| 论文 | [Quantpedia 论文精选](https://quantpedia.com/academic-papers/)、[SSRN 金融](https://papers.ssrn.com/sol3/DisplayAbstractSearch.cfm) |
| 在线课程 | [Coursera: Financial Engineering & Risk Management](https://www.coursera.org/learn/financial-engineering)、[QuantInsti: EPAT 量化交易课程](https://www.quantinsti.com/epat/)、[WorldQuant University](https://www.wqu.edu/) |
| 社区 | 知乎量化话题、聚宽社区、Quantopian 论坛(归档)、r/quant Reddit、[Quantocracy](https://quantocracy.com/) |
