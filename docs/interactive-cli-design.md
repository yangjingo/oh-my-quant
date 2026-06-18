# WhyJ Quant CLI — Design & Reference

> last-updated: 2026-06-08
> 合并自 `interactive-cli-design.md` + `cli-manual.md`；CLI 唯一设计/参考文档。

## Table of Contents

1. [Overview](#1-overview)
2. [Quick Start](#2-quick-start)
3. [Two Layers: Shell vs Slash](#3-two-layers-shell-vs-slash)
4. [Operating Modes](#4-operating-modes)
5. [Architecture](#5-architecture)
6. [Slash vs Agent Boundary](#6-slash-vs-agent-boundary)
7. [Slash Command Reference](#7-slash-command-reference)
8. [Configuration & Storage](#8-configuration--storage)
9. [Data Flow](#9-data-flow)
10. [CLI Design Checklist](#10-cli-design-checklist)
11. [Safe Implementation Plan](#11-safe-implementation-plan)
12. [Key Design Decisions](#12-key-design-decisions)
13. [Tests & Related Docs](#13-tests--related-docs)

---

## 1. Overview

`whyj` is an interactive quantitative analysis terminal built with **Bun + TypeScript + pi Agent**.

Two input modes:

| Mode | Trigger | Path |
|------|---------|------|
| **Slash command** | `/` prefix | `src/cli/registry.ts` — deterministic, no LLM |
| **AI Agent** | natural language | `src/agent/src/session.ts` — LLM + skills + data/compute tools |

Tech stack:

| Layer | Choice |
|-------|--------|
| Runtime | Bun + TypeScript (strict) |
| TUI | Custom frame-buffer — see `src/tui/README.md` and `docs/tui-layout-design.md` |
| AI Agent | `@earendil-works/pi-agent-core` + `@earendil-works/pi-ai` |
| Data | local data adapters + `.ohquant/` local JSON |
| Schema | TypeBox (agent tool parameters) |
| Build | `bun build src/index.ts --outdir dist --target bun` |
| Test | `bun test src/` |

---

## 2. Quick Start

```bash
bun install
bun run src/index.ts                              # Interactive TUI
whyj -c "/help"                                  # One-shot local slash
whyj --json doctor                                # Config / auth check
```

Global install: `npm i -g whyj-quant` then `whyj`.

TUI layout: header, Analyzing panel (left), Overview dock (right), composer, status bar. Code guide: `src/tui/README.md`; full layout spec: `docs/tui-layout-design.md`.

---

## 3. Two Layers: Shell vs Slash

参考 pi `coding-agent`：进程入口与 TUI 内 slash 分层，不混在同一 parser。

| Layer | Location | Responsibility |
|-------|----------|----------------|
| **Shell entry** | `src/index.ts` | `whyj`, `-c`, `--json`, `doctor`, exit codes |
| **Slash commands** | `src/cli/` | `/help`, `/config`, `/portfolio`, parse + dispatch |

Shell 层只关心生命周期；slash 层只关心业务动作。两者共用 `src/cli/catalog.ts` 作为命令列表真源。

---

## 4. Operating Modes

| Mode | Example | Status |
|------|---------|--------|
| Interactive TUI | `whyj` | implemented |
| One-shot slash | `whyj -c "/help"` | implemented |
| JSON envelope | `whyj --json -c "/portfolio"` | implemented |
| Doctor | `whyj --json doctor` | implemented |
| RPC / SDK embed | — | not planned (see pi `--mode rpc`) |

JSON envelope (stable):

```json
{ "ok": true, "command": "portfolio", "message": "...", "data": {} }
{ "ok": false, "command": "portfolio", "error": { "code": "command_failed", "message": "..." } }
```

---

## 5. Architecture

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

### `src/cli/` module

| File | Purpose |
|------|---------|
| `catalog.ts` | `COMMAND_CATALOG`, `SLASH_COMMANDS`, `buildCommandHelpText()` |
| `types.ts` | `ParsedCommand`, `CommandResult`, `CommandEffect`, `CommandContext` |
| `params.ts` | `runQuantTool()`, `normalizeToolParams()` |
| `registry.ts` | `parseCommand()`, `executeCommand()`, handler dispatch |
| `handlers/system.ts` | `/help`, `/clear`, `/config`, `/resume`, `/portfolio`, `/exit` |
| `handlers/workflow.ts` | internal compare workflow helpers only |
| `registry.test.ts` | Parser + dispatch unit tests |

Consumers:

- `src/app-runtime.ts` — slash dispatch via `executeCommand()`, applies `CommandEffect`
- `src/tui/src/input.ts` — composer autocomplete from `COMMAND_CATALOG` (subcommands + actions)
- `src/index.ts` — one-shot mode + shell `--help` slash list

Composer autocomplete: Level 1/2 from `catalog.ts`; flag values (`--symbol`, `--name`) from watchlist in `input.ts`. See `docs/tui-layout-design.md`.

Agent / skill / session internals: `docs/agent-system-spec.md`.

---

## 6. Slash vs Agent Boundary

| Scenario | CLI slash | Agent |
|----------|-----------|-------|
| Run factor/backtest/risk/benchmark on configured data source | — | Agent calls `Quant.Factor`, `Quant.Backtest`, `Quant.Risk`, `Quant.Benchmark` |
| Multi-step natural language analysis | — | `分析平安银行动量+风险` |
| Local UI state | `/clear`, `/config`, `/resume`, `/portfolio` | — |

Rules:

- CLI handlers are limited to local UI/session operations.
- Quant workflows are agent tools, not slash commands.
- Portfolio holdings are **live-only** — never cached under `.ohquant/portfolio/`. See `docs/ohquant-storage-policy.md`.

---

## 7. Slash Command Reference

Quant analysis is intentionally not exposed as slash commands. Use natural language and let the agent call the built-in tools:

```
分析 CODE 的 momentum 因子
对 CODE 做 20/60 双均线回测
检查 CODE 的风险指标
给 CODE 做策略评分并展示 dashboard
```

Built-in Quant tools:

- `Quant.Factor`: momentum, reversal, volatility, volume_ratio, rsi, sma_deviation
- `Quant.Backtest`: SMA crossover backtest
- `Quant.Risk`: annual vol, VaR/CVaR, max drawdown, skewness, kurtosis
- `Quant.Benchmark`: strategy scoring and dashboard data

### `/portfolio` — Local Portfolio Panel

```
/portfolio
```

Read-only local portfolio comparison panel. File edits are handled by the agent, not slash commands.

### System

```
/help      Command reference (from catalog)
/clear     Clear conversation + reset agent
/exit      Quit
/config    Settings panel (API keys, model, sources)
/resume    Resume panel / restore a previous session
/compact   Compact the current session
/portfolio Local portfolio comparison panel
```

### AI Agent (no `/` prefix)

Local data + quant tools, plus `bash` for shell (pi/codex-style). Session → `.ohquant/sessions/{date}/session-{time}.md`. Details: `docs/agent-system-spec.md`.

---

## 8. Configuration & Storage

Single config: `.ohquant/settings.json`

```json
{
  "env": { "WHYJ_AUTH_TOKEN": "sk-..." },
  "model": "sonnet",
  "thinkingLevel": "off"
}
```

Keys and preferred data source via `/config` panel; agent reads lazily on each API call.

Cache paths:

- Market bars: `.ohquant/data/{source}/{symbol}/daily.json`
- Sessions: `.ohquant/sessions/`
- Benchmark: `.ohquant/benchmark/results/*.json`
- Watchlist autocomplete: `.ohquant/watchlist.json`
- Overview symbols: `.ohquant/panel-portfolio.json`

---

## 9. Data Flow

```
User input
  ├─ /command → src/cli/registry.ts: parseCommand() → executeCommand() → display
  └─ NL text  → injectContext() → agent.prompt() → tools → display + cache

Agent fetch_bars("000001.SZ")
  → source adapter (akshare / tushare / llmquant-data / financial-datasets)
  → saveBars → conversation
```

---

## 10. CLI Design Checklist

参考 pi `coding-agent`（CLI 层）与 `pi-ai`（Tool/LLM 层）。实现 CLI 功能前先对照。

| # | Dimension | Requirement | Status |
|---|-----------|-------------|--------|
| 1 | Catalog single source | help / autocomplete / shell help 同源 | done |
| 2 | Shell vs slash split | `index.ts` vs `src/cli/` | done |
| 3 | Slash vs agent split | `/` → registry; NL → agent | done |
| 4 | Tool reuse | handlers → `runQuantTool()`, same as Agent | done |
| 5 | SessionCtx handoff | `--symbol` → `updateSessionCtx` | done |
| 6 | JSON envelope | one-shot `--json` stable shape | done |
| 7 | Storage policy | no portfolio cache; file events | partial |
| 8 | Local commands unified | `/help`/`/clear`/`/config` in registry | done |
| 9 | Type consolidation | merge `ParsedCommand` duplicates | done |
| 10 | Handler split | `registry.ts` → `handlers/*.ts` | done |
| 11 | Catalog schema | subcommands + flags in catalog | partial |
| 12 | Busy input queue | steering/follow-up like pi | done |
| 13 | Extension hook | static catalog → registerCommand | future |

pi-ai 边界（CLI 不应触碰）：

- 不直接调 `stream()` / `complete()` — 除非新增显式 `/agent` 代理命令
- Tool 参数校验走 TypeBox schema；Agent 侧 pi-ai `validateToolCall`
- Streaming 事件仅 Agent 路径；slash 返回同步 `CommandResult`

---

## 11. Safe Implementation Plan

分阶段执行；每阶段独立可验证、可回滚。**先文档、后代码**；每步只改一层。

### Phase 0 — Documentation (this merge)

- [x] Merge `cli-manual.md` → `interactive-cli-design.md`
- [x] Update `CLAUDE.md`, `README.md` references
- [x] Remove `docs/cli-manual.md`

**Verify:** grep 无残留 `cli-manual` 引用。

### Phase 1 — Local command unification (low risk)

- [x] Move `/help`, `/clear`, `/config`, `/portfolio` from `app-runtime.ts` into `registry.ts`
- [x] `app-runtime.ts` applies `CommandResult.effects` + TUI callbacks
- [x] `/exit`/`/quit` remain process-level in runtime

**Verify:** `bun test src/app-runtime.test.ts src/cli/registry.test.ts`

### Phase 2 — Type consolidation (low risk)

- [x] Add `src/cli/types.ts` with `ParsedCommand`, `CommandResult`, `CommandEffect`, `CommandContext`
- [x] Re-export `CommandResult` from `src/types/messages.ts`
- [x] Remove unused `CommandSpec` / duplicate `ParsedCommand`

**Verify:** `bun run typecheck`

### Phase 3 — Handler extraction (medium risk)

- [x] Split handlers into `src/cli/handlers/{system,data,workflow,watchlist,skill}.ts`
- [x] `src/cli/params.ts` for `runQuantTool()` + flag normalization
- [x] `registry.ts` parse + dispatch only

**Verify:** existing tests pass; spot-check unknown quant slash rejection and built-in `Quant.Factor` / `Quant.Benchmark` tool rendering.

### Phase 4 — Catalog schema enrichment (medium risk)

- [x] Extend `CommandCatalogEntry` with `subcommands`
- [x] Autocomplete Level 2 from catalog subcommands (`input.ts`)
- [ ] Flag schema in catalog (future)

### Phase 5 — Symbol rename (optional, breaking docs only)

Rename `COMMAND_CATALOG` → `CLI_CATALOG`, `parseCommand` → `parseSlash`, etc.

- 与用户约定后统一改；不在 Phase 1–4 混入

**Verify:** full `bun test src/`

### Out of scope (explicit)

- RPC mode, extension registerCommand API
- pi-style message queue (steering/follow-up)
- `@file` / `!bash` composer prefixes

---

## 12. Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| Data tools as AgentTools | Agent calls directly; caching in tool execute() |
| Catalog as CLI metadata SSOT | Eliminates help/autocomplete/shell drift |
| settings.json single config | No `.env` dependency; `/config` panel writes here |
| Agent always boots | API key checked at runtime, not startup gate |
| Heuristic compaction | No extra LLM cost for context trim |
| Portfolio live-only | Personal state must not hit `.ohquant/` cache |

---

## 13. Tests & Related Docs

```bash
bun test src/     # session, context, cli, tui, storage, agent
```

| Doc | Scope |
|-----|-------|
| `src/tui/README.md` | TUI code map, runtime interaction, tests |
| `docs/tui-layout-design.md` | Frame-buffer layout, composer UX |
| `docs/agent-system-spec.md` | Agent, tools, compaction, session |
| `docs/ohquant-storage-policy.md` | Cache vs live-only rules |
| `docs/reference.md` | skills, data APIs, ecosystem links |
| `DESIGN.md` | Visual design system |
