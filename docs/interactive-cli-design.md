# WhyJ Quant CLI — 设计与参考

> 最后更新：2026-06-08
> 合并自 `interactive-cli-design.md` + `cli-manual.md`；CLI 唯一设计/参考文档。

## 目录

1. [概述](#1-概述)
2. [快速开始](#2-快速开始)
3. [两层架构：Shell vs Slash](#3-两层架构shell-vs-slash)
4. [运行模式](#4-运行模式)
5. [架构](#5-架构)
6. [Slash 与 Agent 的边界](#6-slash-与-agent-的边界)
7. [Slash 命令参考](#7-slash-命令参考)
8. [配置与存储](#8-配置与存储)
9. [数据流](#9-数据流)
10. [CLI 设计检查清单](#10-cli-设计检查清单)
11. [安全实施计划](#11-安全实施计划)
12. [关键设计决策](#12-关键设计决策)
13. [测试与相关文档](#13-测试与相关文档)

---

## 1. 概述

`whyj` 是基于 **Bun + TypeScript + pi Agent** 的交互式量化分析终端。

两种输入模式：

| 模式 | 触发方式 | 路径 |
|------|---------|------|
| **Slash 命令** | `/` 前缀 | `src/cli/registry.ts` — 确定性执行，无 LLM |
| **AI Agent** | 自然语言 | `src/agent/src/session.ts` — LLM + skills + data/compute tools |

技术栈：

| 层 | 选型 |
|-------|--------|
| Runtime | Bun + TypeScript (strict) |
| TUI | 自定义 frame-buffer — 见 `src/tui/README.md` 和 `docs/tui-layout-design.md` |
| AI Agent | `@earendil-works/pi-agent-core` + `@earendil-works/pi-ai` |
| 数据 | 本地 data adapter + `.ohquant/` 本地 JSON |
| Schema | TypeBox（agent tool 参数） |
| 构建 | `bun build src/index.ts --outdir dist --target bun` |
| 测试 | `bun test src/` |

---

## 2. 快速开始

```bash
bun install
bun run src/index.ts                              # Interactive TUI
whyj -c "/help"                                  # One-shot local slash
whyj --json doctor                                # Config / auth check
whyj --json -c "/doctor"                          # Same check through slash dispatch
```

全局安装：`npm i -g whyj-quant` 然后 `whyj`。

TUI 布局：header、Analyzing 面板（左侧）、Overview dock（右侧）、composer、status bar。代码指南：`src/tui/README.md`；完整布局规格：`docs/tui-layout-design.md`。

---

## 3. 两层架构：Shell vs Slash

参考 pi `coding-agent`：进程入口与 TUI 内 slash 分层，不混在同一 parser。

| 层 | 位置 | 职责 |
|-------|----------|----------------|
| **Shell 入口** | `src/index.ts` | `whyj`、`-c`、`--json`、`doctor`、exit codes |
| **Slash 命令** | `src/cli/` | `/help`、`/config`、`/doctor`、`/portfolio`、parse + dispatch |

Shell 层只关心生命周期；slash 层只关心业务动作。两者共用 `src/cli/catalog.ts` 作为命令列表真源。

---

## 4. 运行模式

| 模式 | 示例 | 状态 |
|------|---------|--------|
| Interactive TUI | `whyj` | 已实现 |
| One-shot slash | `whyj -c "/help"` | 已实现 |
| JSON envelope | `whyj --json -c "/portfolio"` | 已实现 |
| Doctor | `whyj --json doctor`, `whyj -c "/doctor"` | 已实现 |
| RPC / SDK embed | — | 未计划（见 pi `--mode rpc`） |

JSON envelope（稳定格式）：

```json
{ "ok": true, "command": "portfolio", "message": "...", "data": {} }
{ "ok": false, "command": "portfolio", "error": { "code": "command_failed", "message": "..." } }
```

---

## 5. 架构

```
┌──────────────────────────────────────────────────────┐
│              QuantTui (frame-buffer)                  │
│  Header · Conversation · Overview · Composer · Status │
│                                                       │
│  app-runtime.ts: onSubmit() → slash / agent dispatch  │
│                                                       │
│  CLI Layer:   catalog.ts · types.ts · params.ts       │
│               registry.ts · handlers/*.ts             │
│  Agent Layer: session.ts · context.ts                 │
│  Tool Layer:  DATA_TOOLS (1) + COMPUTE_TOOLS (5) + bash │
│  Data Layer:  data adapters + .ohquant/ local JSON    │
└──────────────────────────────────────────────────────┘
```

### `src/cli/` 模块

| 文件 | 用途 |
|------|---------|
| `catalog.ts` | `COMMAND_CATALOG`、`SLASH_COMMANDS`、`buildCommandHelpText()` |
| `types.ts` | `ParsedCommand`、`CommandResult`、`CommandEffect`、`CommandContext` |
| `doctor.ts` | 共享 doctor 报告、文本格式化、认证来源提示 |
| `params.ts` | `runQuantTool()`、`normalizeToolParams()` |
| `registry.ts` | `parseCommand()`、`executeCommand()`、handler dispatch |
| `handlers/system.ts` | `/help`、`/clear`、`/config`、`/doctor`、`/resume`、`/portfolio`、`/exit` |
| `handlers/workflow.ts` | 仅内部 compare workflow helper |
| `registry.test.ts` | Parser + dispatch 单元测试 |

消费者：

- `src/app-runtime.ts` — 通过 `executeCommand()` 进行 slash dispatch，应用 `CommandEffect`
- `src/tui/src/input.ts` — 从 `COMMAND_CATALOG` 获取 composer autocomplete（subcommands + actions）
- `src/index.ts` — one-shot 模式 + shell `--help` slash list

Composer 自动补全：Level 1/2 来自 `catalog.ts`；flag 值（`--symbol`、`--name`）来自 `input.ts` 中的 watchlist。详见 `docs/tui-layout-design.md`。

Agent / skill / session 内部机制：`docs/agent-system-spec.md`。

### Agent provider 差异在 CLI 层面的影响

CLI 只暴露一个自然语言 agent 入口，但后端模型传输方式对错误处理和文档很重要：

- OpenAI-compatible provider 路径对工具重放和空 assistant turn 更宽容。
- Anthropic provider 路径要求严格的 `tool_use` / `tool_result` 相邻性，这也是某些 400 错误看起来像 "tool_result missing immediately after tool_use" 的原因。
- `/config`、`doctor` 和 TUI settings 面板应展示当前激活的端点模式，以便用户区分模型问题与传输问题。
- 对同一厂商同时提供两套协议的情况，优先按 URL 尾段分流：`/anthropic` 走 Anthropic Messages，`/v1` 走 OpenAI-compatible。

---

## 6. Slash 与 Agent 的边界

| 场景 | CLI slash | Agent |
|----------|-----------|-------|
| 在配置的数据源上运行 factor/backtest/risk/benchmark | — | Agent 调用 `Quant.Factor`、`Quant.Backtest`、`Quant.Risk`、`Quant.Benchmark` |
| 多步骤自然语言分析 | — | `分析平安银行动量+风险` |
| 本地 UI 状态 | `/clear`、`/config`、`/doctor`、`/resume`、`/portfolio` | — |

规则：

- CLI handler 限于本地 UI/session 操作。
- 量化工作流是 agent 工具，不是 slash 命令。
- Portfolio 持仓是 **实时的（live-only）** — 永不缓存到 `.ohquant/portfolio/`。见 `docs/ohquant-storage-policy.md`。

---

## 7. Slash 命令参考

量化分析有意不暴露为 slash 命令。使用自然语言，让 agent 调用内置工具：

```
分析 CODE 的 momentum 因子
对 CODE 做 20/60 双均线回测
检查 CODE 的风险指标
给 CODE 做策略评分并展示 dashboard
```

内置量化工具：

- `Quant.Factor`：momentum、reversal、volatility、volume_ratio、rsi、sma_deviation
- `Quant.Backtest`：SMA crossover backtest
- `Quant.Risk`：年化波动率、VaR/CVaR、最大回撤、偏度、峰度
- `Quant.Benchmark`：策略评分和 dashboard 数据

### `/portfolio` — 本地组合面板

```
/portfolio
```

只读本地组合对比面板。文件编辑由 agent 处理，而非 slash 命令。

### 系统

```
/help      命令参考（来自 catalog）
/clear     清空对话 + 重置 agent
/exit      退出
/config    设置面板（API keys、模型、数据源）
/doctor    运行时、配置、认证来源检查、脱敏值指纹和设置提示
/resume    恢复面板 / 恢复之前的 session
/compact   压缩当前 session
/portfolio 本地组合对比面板
```

### AI Agent（无 `/` 前缀）

本地数据 + 量化工具，加上 `bash` 用于 shell（pi/codex 风格）。Session → `.ohquant/sessions/{date}/session-{time}.md`。详情：`docs/agent-system-spec.md`。

---

## 8. 配置与存储

统一配置：`.ohquant/settings.json`

```json
{
  "env": { "WHYJ_QUANT_AUTH_TOKEN": "sk-..." },
  "model": "sonnet",
  "thinkingLevel": "off"
}
```

密钥和首选数据源通过 `/config` 面板设置；agent 在每次 API 调用时延迟读取。

缓存路径：

- 行情数据：`.ohquant/data/{source}/{symbol}/daily.json`
- Sessions：`.ohquant/sessions/`
- Benchmark：`.ohquant/benchmark/results/*.json`
- Watchlist 自动补全：`.ohquant/watchlist.json`
- Overview symbols：`.ohquant/panel-portfolio.json`

---

## 9. 数据流

```
用户输入
  ├─ /command → src/cli/registry.ts: parseCommand() → executeCommand() → 显示
  └─ 自然语言文本 → injectContext() → agent.prompt() → tools → 显示 + 缓存

Agent fetch_bars("000001.SZ")
  → source adapter (akshare / tushare / llmquant-data / financial-datasets)
  → saveBars → conversation
```

---

## 10. CLI 设计检查清单

参考 pi `coding-agent`（CLI 层）与 `pi-ai`（Tool/LLM 层）。实现 CLI 功能前先对照。

| # | 维度 | 要求 | 状态 |
|---|-----------|-------------|--------|
| 1 | Catalog 单一真源 | help / autocomplete / shell help 同源 | done |
| 2 | Shell vs slash 分离 | `index.ts` vs `src/cli/` | done |
| 3 | Slash vs agent 分离 | `/` → registry; NL → agent | done |
| 4 | 工具复用 | handlers → `runQuantTool()`，与 Agent 相同 | done |
| 5 | SessionCtx 传递 | `--symbol` → `updateSessionCtx` | done |
| 6 | JSON envelope | one-shot `--json` 稳定结构 | done |
| 7 | 存储策略 | 无 portfolio 缓存；file events | partial |
| 8 | 本地命令统一 | `/help`/`/clear`/`/config` 在 registry 中 | done |
| 9 | 类型整合 | 合并 `ParsedCommand` 重复定义 | done |
| 10 | Handler 拆分 | `registry.ts` → `handlers/*.ts` | done |
| 11 | Catalog schema | catalog 中的 subcommands + flags | partial |
| 12 | 忙碌输入队列 | steering/follow-up 如 pi | done |
| 13 | 扩展钩子 | static catalog → registerCommand | future |

pi-ai 边界（CLI 不应触碰）：

- 不直接调用 `stream()` / `complete()` — 除非新增显式 `/agent` 代理命令
- Tool 参数校验走 TypeBox schema；Agent 侧 pi-ai `validateToolCall`
- Streaming 事件仅 Agent 路径；slash 返回同步 `CommandResult`

---

## 11. 安全实施计划

分阶段执行；每阶段独立可验证、可回滚。**先文档、后代码**；每步只改一层。

### Phase 0 — 文档（本次合并）

- [x] 合并 `cli-manual.md` → `interactive-cli-design.md`
- [x] 更新 `CLAUDE.md`、`README.md` 引用
- [x] 移除 `docs/cli-manual.md`

**验证：** grep 无残留 `cli-manual` 引用。

### Phase 1 — 本地命令统一（低风险）

- [x] 将 `/help`、`/clear`、`/config`、`/portfolio` 从 `app-runtime.ts` 移至 `registry.ts`
- [x] `app-runtime.ts` 应用 `CommandResult.effects` + TUI callbacks
- [x] `/exit`/`/quit` 保留为 runtime 的进程级操作

**验证：** `bun test src/app-runtime.test.ts src/cli/registry.test.ts`

### Phase 2 — 类型整合（低风险）

- [x] 添加 `src/cli/types.ts`，包含 `ParsedCommand`、`CommandResult`、`CommandEffect`、`CommandContext`
- [x] 从 `src/types/messages.ts` 重新导出 `CommandResult`
- [x] 移除未使用的 `CommandSpec` / 重复的 `ParsedCommand`

**验证：** `bun run typecheck`

### Phase 3 — Handler 提取（中等风险）

- [x] 将 handler 拆分为 `src/cli/handlers/{system,data,workflow,watchlist,skill}.ts`
- [x] `src/cli/params.ts` 用于 `runQuantTool()` + flag normalization
- [x] `registry.ts` 仅 parse + dispatch

**验证：** 现有测试通过；抽查未知量化 slash 的拒绝和内置 `Quant.Factor` / `Quant.Benchmark` 工具渲染。

### Phase 4 — Catalog schema 增强（中等风险）

- [x] 扩展 `CommandCatalogEntry`，增加 `subcommands`
- [x] 从 catalog subcommands 自动补全 Level 2（`input.ts`）
- [ ] 未来：catalog 中的 flag schema

### Phase 5 — Symbol 重命名（可选，仅文档层面的破坏性改动）

将 `COMMAND_CATALOG` 重命名为 `CLI_CATALOG`，`parseCommand` 重命名为 `parseSlash` 等。

- 与用户约定后统一改；不在 Phase 1–4 混入

**验证：** 完整 `bun test src/`

### 明确不包含（Out of scope）

- RPC 模式、extension registerCommand API
- pi 风格 message queue（steering/follow-up）
- `@file` / `!bash` composer 前缀

---

## 12. 关键设计决策

| 决策 | 理由 |
|----------|-----------|
| 数据工具作为 AgentTools | Agent 直接调用；缓存在工具 execute() 中 |
| Catalog 作为 CLI metadata SSOT | 消除 help/autocomplete/shell 偏移 |
| settings.json 单一配置 | `/config` 写入 `.ohquant/settings.json`；应用从该处读取配置 |
| Agent 始终启动 | API key 在运行时检查，非启动门禁 |
| 启发式 compaction | 上下文修剪不产生额外 LLM 成本 |
| Portfolio live-only | 个人状态不得落入 `.ohquant/` 缓存 |

---

## 13. 测试与相关文档

```bash
bun test src/     # session, context, cli, tui, storage, agent
```

| 文档 | 范围 |
|-----|-------|
| `src/tui/README.md` | TUI 代码地图、运行时交互、测试 |
| `docs/tui-layout-design.md` | Frame-buffer 布局、composer UX |
| `docs/agent-system-spec.md` | Agent、tools、compaction、session |
| `docs/ohquant-storage-policy.md` | 缓存 vs live-only 规则 |
| `docs/source-data-providers.md` | 数据源 provider、Python 库、API 参考 |
| `docs/trader-skills.md` | skill 系统、外部 skill 生态、学习资源 |
| `DESIGN.md` | 视觉设计系统 |
