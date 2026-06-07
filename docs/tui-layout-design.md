# WhyJ Quant — TUI Layout Design

> last-updated: 2026-06-06
> revision: **r5 — icon slots + trend-only loading emphasis**

Frame-buffer TUI with persistent Portfolio dock. Architecture inspired by deepseek-tui (ratatui).

```
┌ header ───────────────────────────────────────────────────────────────────┐
│  ▁▃▅▇█  WhyJ Quant                                                       │
│         Research. Backtest. Invest.  v2.0.5                               │
├────────────────────────────────────────────────┬──────────────────────────┤
│ ╭ ◉ Conversation ─────────────────────────────╮ │ ╭ ◫ Overview ─── 3 items ╮│
│   ▏ user message              (gold gutter)     │ │ ▎ Positions            ││
│   ✓ tool_name · args  elapsed                   │ │ ─────────────────────  ││
│   ▏ assistant text…                             │ │ 000001 平安银行         ││
│                                                 │ │           10.68 +0.00% ││
│   ── Loading overlay (when starting/thinking) ─ │ │ ▎ Watchlist            ││
│                  ▁▃▅▇█                           │ │ ▎ Local Cache          ││
│                  ▁▃▅▇█                           │ │ ▎ Market               ││
│       Connecting data sources                   │ │ ▎ Market               ││
│                                                 │ │ ▎ Sources              ││
├ ⌘ Composer ───────────────────── ↹ complete ────┤ ╰───────────────────────╯ │
│ │ /data download --symbol▏                       │                          │
│ │ /data  /factor  /backtest  /risk  /benchmark  │  ← suggestions row       │
├───────────────────────────────────────────────────────────────────────────┤
│ ─────────────────────────────────────────────────────────────────────────  │
│ deepseek-v4-pro · PF A:我的组合                                             │
└───────────────────────────────────────────────────────────────────────────┘
```

## Implementation

| File | Purpose |
|------|---------|
| `src/tui/buffer.ts` | Cell-grid Buffer with `text`, `box`, `hline`, `vline`, `textScale`, ANSI render |
| `src/tui/utils.ts` | `strWidth` (CJK-aware), `truncate`, ANSI constants |
| `src/tui/styles.ts` | Style presets (`S.gold`, `S.cream`, `S.dim`, etc.), `pctStyle` (红涨绿跌), format helpers |
| `src/tui/types.ts` | `AppState`, `UIMessage`, `Holding`, `Quote`, `PanelSection`, `Layout` |
| `src/tui/tokens.ts` | Palette, `HEADER_H`(3), `COMPOSER_H`(4), `STATUS_H`(2), `BOX_CHARS` |
| `src/tui/render.ts` | Pure render functions: `drawHeader`, `drawConversation`, `drawPortfolio`, `drawComposer`, `drawStatus`, `layout()`, `drawLoadingOverlay` |
| `src/tui/tui.ts` | `QuantTui` class: alt-screen, atomic flush, resize handler, `update(partial)`, slash suggestions, Tab/↑↓ autocomplete |
| `src/tui/local-state.ts` | Settings + portfolio config reader: model name, scheme list |
| `src/tui/local-snapshot.ts` | Sync portfolio data loader: holdings, funds, watchlist, market indices, source timestamps |

## Layout (layout function)

```
rows (R, cols C):
  header        y=0,                  h=HEADER_H (3)   ← logo + tagline + divider
  main          y=HEADER_H,           h=R - HEADER_H - COMPOSER_H - STATUS_H
     conversation  x=1,        w=C - PANEL_W - 2   (if dock visible)
     portfolio     x=C-PANEL_W, w=PANEL_W          (persistent dock)
  composer      y=R-COMPOSER_H-STATUS_H, h=COMPOSER_H (4)  ← input + suggestions row
  status        y=R-1,                h=STATUS_H (2)  ← divider + status line
```

`PANEL_W = clamp(36, 48, floor(C * 0.312))`. Dock hidden when `C < 78`.

## Typography And Icons

### Rules

1. Region sizes do not change. Enlarged text is only allowed inside existing content rects.
2. Body text stays 1x. Enlarged text is reserved for one short emphasis line per region.
3. Icons live in fixed slots: panel title left edge, status prefix, and activity mark. They do not enter message flow.

### Icon placement

| Region | Icon slot |
|--------|-----------|
| Conversation panel | `◉` in title bar |
| Overview panel | `◫` in title bar |
| Composer panel | `⌘` in title bar |
| Status row | `◆` before model |
| Activity overlay | `▁▃▅▇█` trend marker |

### Enlargement scheme

| Use case | Method | Constraint |
|----------|--------|------------|
| Loading trend | native glyph icon | 1 row only |
| Brand/activity mark | native glyph icon | 1 row only |
| Body/result text | normal text | never scaled |

## Header — golden staircase

The `▁▃▅▇█` staircase serves dual purpose as brand mark AND activity indicator:

| Activity | Staircase behavior |
|----------|-------------------|
| `ready` | Full gold gradient (dark → light), static |
| `starting` | Slow wave (500ms), one lit step sweeps back and forth |
| `thinking` | Medium wave (300ms) |
| `running tool` | Fast wave (200ms) |

Color: `stepColor()` blends from `#D4AF37` (dark gold) to `#F0D77A` (light gold). Non-ready states use dim `#3C3730` for inactive steps.

## Loading overlay

When `msgs.length === 0 && activity !== "ready"`, the conversation area shows a centered loading panel:

- **Icon**: `▁▃▅▇█` trend marker centered above the helper lines
- **Helper lines**: normal-size gold lines below for secondary context
- **Reason**: minimal emphasis without duplicated glyph artifacts

## Portfolio dock

### Sections

| Section | Kind | Source |
|---------|------|--------|
| Positions | `holdings` | `.ohquant/data/{source}/{code}/` bar files |
| Funds | `quotes` | `.ohquant/portfolio/holdings_{variant}.json` |
| Watchlist | `quotes` | `.ohquant/watchlist.json` |
| Market | `quotes` | Named index codes (000300, 399001, HSI, etc.) |
| Sources | `keyvalue` | `loadSourceTimestamps()` — latest mtime per data source |

### Color convention

**Chinese market convention**: 红涨绿跌 (red = up, green = down).

- `pctStyle()`: positive → `#CF5B4A` (red), negative → `#6FB06A` (green)
- Source timestamps formatted as `YYYY-MM-DD HH:mm`

### Loading state

When `panelLoading` is true, shows a braille spinner + "Fetching positions..." with gold pulse animation via `stepHex()`.

## Composer — slash command system

### Visual modes

| Mode | Prompt | Text color | Hint |
|------|--------|-----------|------|
| Empty | `› write a task…▏` | dim | `/ commands · ↵ send · ^C quit` |
| Chat | `› user text▏` | cream | `/ commands · ↵ send · ^C quit` |
| Command | `/cmd args▏` | gold, `/` bold gold | `↹ complete` |

### Autocomplete

Two-level suggestion tree defined in `CMD_TREE`:

```
/data      → download, info
/factor    → analyze, list
/backtest  → run
/risk      → check
/benchmark → run, dashboard
/add       → stock, list, remove
/skill     → list, info, trigger
/watch     → remove
/mcp       → connect
```

**Level 1**: Partial command name → matching top-level commands (e.g. `/d` → `/data`)
**Level 2**: After `<cmd> ` → sub-commands (e.g. `/data ` → `download`, `info`)

**Navigation**: `↑↓` and `Tab` cycle through matches, auto-filling the input. Typing resets selection. Suggestions render below the input line in the composer box.

## Status bar

Two rows: divider (`STATUS_H = 2`). Left side shows model name (gold) + PF scheme `label:name` (dim).

Model reads from `.ohquant/settings.json` → `env.WHYJ_DEFAULT_SONNET_MODEL` (same contract as `loadLocalModel()`), falls back to `deepseek-v4-pro`.

## Font support

All emphasis now stays on native terminal glyphs. There is no custom bitmap font layer.

## Responsive

| Terminal width | Portfolio dock | Conversation |
|---------------|----------------|--------------|
| `< 78` cols | hidden | full width |
| `≥ 78` cols | `clamp(36,48,⌊w·0.312⌋)` | `w − PANEL_W` |

## Animation

Animation timer (`setInterval 80ms`) fires when `activity !== "ready"`, triggering repaints for:
- Staircase wave in header
- Loading overlay staircase + text pulses
- Portfolio spinner pulse

Once `activity === "ready"`, the timer pauses to save CPU.

## Edge cases

| Case | Behavior |
|------|----------|
| Terminal `< 78` cols | Dock hidden, conversation fills width |
| CJK in names/labels | Counted as 2 cells by `strWidth` |
| Resize mid-stream | `layout()` recomputed, full repaint |
| Holdings overflow | Clipped to rect height |
| No `.ohquant/settings.json` | Model defaults to `deepseek-v4-pro` |
| No portfolio data | Shows "No portfolio data yet." hint |
| MCP not connected | `connectAll()` silently catches, TUI still starts |
