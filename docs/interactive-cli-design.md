# WhyJ Quant CLI — Design Document (v2, implemented)

> last-updated: 2026-06-06

## 1. Overview

`whyj` is an interactive quantitative analysis terminal built with **Bun + TypeScript + pi Agent**.

Two modes:
- **Slash commands** (`/data download --symbol 000001.SZ`) — deterministic, fast path
- **AI Agent** (natural language) — LLM-driven, calls MCP tools + computation tools

## 2. Tech Stack (actual)

| Layer | Choice |
|-------|--------|
| Runtime | Bun + TypeScript (strict) |
| TUI | Custom frame-buffer (cell-grid, zero-dependency, ratatui pattern) |
| AI Agent | @earendil-works/pi-agent-core + @earendil-works/pi-ai |
| Data | @modelcontextprotocol/sdk (MCP client) + local JSON files |
| Schema | TypeBox (agent tool parameters) |
| Build | `bun build src/index.ts --outdir dist --target bun` |
| Test | `bun test src/` |

## 3. Architecture (actual)

```
┌──────────────────────────────────────────────────────┐
│              QuantTui (frame-buffer)                  │
│  ┌──────────┐  ┌──────────────┐  ┌────────────────┐  │
│  │ Header   │  │ Conversation │  │ Portfolio Dock │  │
│  │(brand+   │  │ (scrollable, │  │ (persistent,   │  │
│  │ status)  │  │  bottom-anch)│  │  data-driven)  │  │
│  └──────────┘  └──────────────┘  └────────────────┘  │
│  ┌──────────────────────────────────────────────────┐ │
│  │ Composer (raw keyboard input, history)           │ │
│  └──────────────────────────────────────────────────┘ │
│  ┌──────────────────────────────────────────────────┐ │
│  │ Status Bar (model, cost, cache hit %)             │ │
│  └──────────────────────────────────────────────────┘ │
│                                                       │
│  app-tui.ts: agent.subscribe() -> tui.update()       │
│              onSubmit() -> slash / agent dispatch     │
│                                                       │
│  Agent Layer: session.ts (pi Agent wrapper)           │
│              context.ts (prompt assembly)              │
│  Tool Layer:  MCP_TOOLS (7) + COMPUTE_TOOLS (5)       │
│  Data Layer:  MCP Client + .ohquant/ local JSON       │
└──────────────────────────────────────────────────────┘
```

## 4. TUI Engine (r2 frame-buffer)

| File | Purpose |
|------|---------|
| `src/tui/buffer.ts` | Cell-grid Buffer + Screen: text, box (title-in-border), ANSI render, atomic flush |
| `src/tui/render.ts` | Pure draw functions: layout(), drawHeader, drawConversation, drawPortfolio, drawComposer, drawStatus |
| `src/tui/tui.ts` | QuantTui class: raw-mode keyboard, history, resize, paint loop |
| `src/tui/styles.ts` | Style presets from DESIGN.md palette |
| `src/tui/types.ts` | AppState, UIMessage, Holding, Quote, PanelSection, Layout |

See `docs/tui-layout-design.md` for full layout spec with ASCII diagram.

### Key animation components

| Component | Pattern | Files |
|-----------|---------|-------|
| `Spinner` | Frame-based setInterval, 9 variants (dots, line, arc, star, bounce, etc.) | `Spinner.tsx` |
| `AnimatedText` | Pulse, ProgressDots, StreamCursor, ElapsedTimer | `AnimatedText.tsx` |
| `ThinkingPanel` | Gold spinner + "thinking" + elapsed timer, auto-collapse on done | `ThinkingPanel.tsx` |
| `ToolCallInline` | Spinner→✓/✗, args preview, collapsible result, elapsed timer | `ToolCall.tsx` |

## 5. MCP Integration (actual)

Data flows: User → Agent → MCP Tool → callTool(server, name, args) → cache locally.

```typescript
// src/data/mcp-client.ts
connectAll()            // Connects to all MCP servers from .ohquant/settings.json
callTool(server, name, args)  // Execute a single MCP tool
getServerStatus()       // [{ name, connected, tools, error }]
```

### MCP-backed Agent Tools

| Tool Name | Server | Purpose |
|-----------|--------|---------|
| `tushare_daily` | tushare | A-share OHLCV bars |
| `tushare_stock_basic` | tushare | Stock search |
| `tushare_fina_indicator` | tushare | Financial indicators |
| `llmquant_price` | llmquant-data | US equity prices |
| `fd_price` | financial-datasets | US equity prices (alt) |
| `fd_snapshot` | financial-datasets | PE/PB/ROE/market cap |
| `fd_company` | financial-datasets | Company facts |

## 6. Session & Context (implemented)

### Session management (from pi harness patterns)

```typescript
// src/agent/session.ts
createAgent()                         // Creates pi Agent with MCP + compute tools
  ├── getApiKey() → loadSettings().env.WHYJ_AUTH_TOKEN  // settings.json only
  ├── transformContext() → token estimation + compaction
  └── saveSession() → .ohquant/sessions/{date}/session-{time}.md

// src/agent/context.ts
buildSystemPrompt()                   // Base template + cached symbols + dynamic extra
injectSessionContext(input, ctx)      // Wraps user input with lastSymbol/lastMarket
```

### Compaction (from pi compaction.ts)

```
estimateTokens(msg)           // chars/4 heuristic
estimateContextTokens(msgs)   // Sum over all messages
compactMessages(msgs)         // Walk backward, cut at user boundary, insert summary
```

Trigger: when context > ~87% of 128k window (111k tokens). Keeps 24k recent tokens.

## 7. Session Context

```typescript
interface SessionCtx {
  lastSymbol: string | null
  lastMarket: string | null
  lastStartDate: string | null
  lastEndDate: string | null
}
```

Updated by slash commands (`--symbol` flag), injected into agent prompts via `injectContext()`.

## 8. Data Flow (slash commands)

```
/data download --symbol 000001.SZ --market A
  → parseCommand("/data download --symbol 000001.SZ --market A")
  → dataHandler(flags, positional)
  → runQuantTool("tushare_daily", { ts_code: "000001.SZ" })
  → callTool("tushare", "daily", { ts_code: "000001.SZ" })
  → saveBars(symbol, "tushare", bars)
  → display result in Conversation
```

## 9. Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| MCP tools as AgentTools, not wrapper | Agent directly calls what it needs; caching happens in execute() |
| Frame-based animation (setInterval) | Pi's Loader pattern; Ink-compatible without extra deps |
| settings.json as single config source | No .env dependency; ConfigPanel writes here, agent reads lazily |
| Agent always boots (no key gating) | Agent = API key at runtime; /config changes picked up on next API call |
| Heuristic compaction (no LLM) | Summarization without extra API cost; structured format (Goal/Progress/Decisions) |
