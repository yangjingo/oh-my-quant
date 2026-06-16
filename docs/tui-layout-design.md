# WhyJ Quant — TUI Layout Design

> last-updated: 2026-06-11
> revision: **r7 — portfolio redesign + slash command UX**

Frame-buffer TUI with persistent Portfolio dock. Architecture inspired by deepseek-tui (ratatui).

```
┌ header ───────────────────────────────────────────────────────────────────┐
│  ▁▃▅▇█  WhyJ Quant                                                       │
│         Research. Backtest. Invest.  v2.0.5                               │
├────────────────────────────────────────────────┬──────────────────────────┤
│ ╭ ◉ Conversation ─────────────────────────────╮ │ ╭ ◫ Overview ────────────╮ │
│   ▏ user message              (gold gutter)     │ │ ▎ ▼ Default             ││
│   ✓ tool_name · args  elapsed                   │ │ ────────────────── 10  ││
│   ▏ assistant text…                             │ │ 022364  永赢科技  -2.05%││
│                                                 │ │ 016372  信澳匠心  -2.50%││
│   ◆ 1. Risk first                               │ │ ▎ Market                ││
│      Principle: 先控制回撤和仓位                 │ │ 000001  上证指数  +0.50%││
│                                                 │ │ ▎ Source                ││
│   ── Loading overlay (when starting/thinking) ─ │ │ 来源    AKShare·东方财富││
│                  ▁▃▅▇█                           │ ╰────────────────────────╯│
├─────────────────────────────────────────────────┴──────────────────────────┤
│ ┌─ / Commands ────────────────┐                                             │
│ │ ▶ /config  Settings panel   │  ← dropdown floats above composer          │
│ └─────────────────────────────┘                                             │
│ ╭ ⌘ Composer ─────────────────────────── ↑↓ select · ↹ accept ────────────╮│
│ │ /co▏                                                                     ││
│ ╰──────────────────────────────────────────────────────────────────────────╯│
├─────────────────────────────────────────────────────────────────────────────┤
│ ◆ deepseek-v4-pro · akshare · 全仓科技成长                                  │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Implementation

| File | Purpose |
|------|---------|
| `src/tui/src/buffer.ts` | Cell-grid Buffer with `text`, `box`, `hline`, `vline`, CJK-aware clipping, ANSI render |
| `src/tui/src/utils.ts` | `strWidth` (CJK-aware), `truncate`, ANSI constants |
| `src/tui/src/styles.ts` | Palette/layout constants, style presets (`S.gold`, `S.cream`, etc.), `pctStyle` (红涨绿跌), format helpers |
| `src/tui/src/types.ts` | `AppState`, `UIMessage`, `Holding`, `Quote`, `PanelSection`, `Layout` |
| `src/tui/src/render.ts` | Pure render functions: `drawHeader`, `drawConversation`, `drawPortfolio`, `drawComposer`, `drawStatus`, `layout()`, `drawLoadingOverlay` |
| `src/tui/src/tui.ts` | `QuantTui` class: alt-screen, atomic flush, resize handler, `update(partial)`, input dispatch |
| `src/tui/src/input.ts` | Raw stdin chunking, CSI keyboard parsing, SGR mouse parsing, panel hit testing, Composer suggestions from `src/cli/catalog.ts` |
| `src/tui/src/watchlist.ts` | Watchlist reader for Composer autocomplete only |

## Layout (layout function)

```
rows (R, cols C):
  header        y=0,                  h=HEADER_H (3)   ← logo + tagline + divider
  main          y=HEADER_H,           h=R - HEADER_H - COMPOSER_H - STATUS_H
     conversation  x=1,        w=C - PANEL_W - 2   (if dock visible)
     portfolio     x=C-PANEL_W, w=PANEL_W          (persistent dock)
  composer      y=R-COMPOSER_H-STATUS_H, h=COMPOSER_H (8)  ← input + vertical suggestions
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

## Overview Dock

### Panel layout

Portfolio rows display as a single 3-column line: **code (8) + name + pct (8 right-aligned)**. No item count in the title bar. Price is not shown.

```
◫ Overview
───
▎ ▼ Default
────────────────────────────────────────── 10
022364  永赢科技智选发起A             -2.05%
016372  信澳匠心严选一年持有A         -2.50%
022184  富国全球科技互联网C           +2.53%

▎ Market
──────────────────────────────────────────
000001  上证指数           3300.00  +0.50%
399001  深证成指          10800.00  -0.30%

▎ Source
──────────────────────────────────────────
来源           AKShare · 东方财富
更新           2026-06-10 23:24
数据           2026-06-10
```

Column alignment:
- `code`: left-aligned, 8 chars wide (strips exchange suffix `.SH`/`.SZ` for display)
- `name`: truncated to fill available width
- `pct`: right-aligned with `padStart(8)`, green "+" / red "-" via `pctStyle()`

### Section types

| Kind | Title bar | Row rendering | Cap behavior |
|---|---|---|---|
| `holdings` | `▎ title` + divider | 3-column: code + name + pct | Uncapped (all rows, scroll) |
| `group` | `▎ ▼/▶ title` + divider with count | 3-column rows when expanded | Uncapped |
| `quotes` | `▎ title` + divider | 3-column: code + name + pct | **Always visible** |
| `keyvalue` | `▎ title` + divider | `label ... value` | **Always visible** |

Groups show `▼` (expanded) or `▶` (collapsed). Collapsed groups hide their child rows. Market quotes (`quotes`) and source info (`keyvalue`) always render in full — they are never clipped or capped.

### Data Flow

Overview is runtime-driven. It does **not** scan `.ohquant/data` or build local snapshots.

`AppRuntime` refreshes `panel` from market data:

| Runtime event | Overview behavior |
|---------------|-------------------|
| App init | Fetch market indices and local watchlist quotes |
| Slash command start | `Market Refresh` loading section |
| Slash command result | Refresh market indices and local watchlist quotes |
| Agent tool start | `Market Refresh` loading section |
| Agent tool end / agent end | Refresh market indices and local watchlist quotes |

The market indicators are hard-coded in `AppRuntime` and always appear after portfolio sections. Portfolio symbols and groups are edited in the Config panel (`Ctrl+P`): vertical dropdown picker for group selection, draft input for adding/creating. Persisted to `.ohquant/panel-portfolio.json`. Live quotes on each refresh.

- A-share stocks, ETFs, and indices: AKShare first, then Tushare fallback.
- Non-A symbols: llmquant-data.

### Unified panel interaction

All slash-command panels share a single interaction model via `PanelController`:

| Key | Action |
|-----|--------|
| `↑` `↓` | Navigate items (wraps around) |
| `↵` | Mode-specific action |
| `esc` | Close panel |

Mode-specific `↵` behavior:

| Panel | `↵` action |
|-------|-----------|
| Config | Toggle option (fields with options) or enter edit draft (text/apply fields) |
| Resume | Resume selected session (`/resume <id>`) |
| Portfolio | None (read-only listing) |
| Hotkeys | None (read-only reference) |

All panels share:
- **Container**: `drawPanelFrame()` — centered modal, `PANEL_W=96`, `PANEL_H=22`, dark backdrop
- **Title bar**: Panel name + keyboard hint (e.g. `↑↓ move  ↵ resume  esc close`)
- **Footer**: Status text or hint line
- **Position**: Centered, dims background via `fillRect` before drawing

### Config panel

`Ctrl+P` or `/config` opens the Config panel with fields for Model, Thinking, API keys, data sources, and active portfolio.

Options fields (Model, Thinking, A Source, US/HK Source, Insight, Set active portfolio): `↵` cycles to next value.
Text/apply fields (API Key, A Key, US/HK Key): `↵` opens draft mode; type value then `↵` saves, `esc` cancels.

### Loading state

When `panelLoading` is true, shows a braille spinner + "Waiting for market data..." with gold pulse animation via `stepHex()`.

### Scrolling

The Overview dock renders from a virtual content list instead of clipping early:

- `overviewContentHeight()` computes total section height.
- `overviewMaxScrollTop()` clamps the scroll offset.
- Wheel over the Overview region scrolls the dock.
- Left-button drag inside Overview scrolls line-by-line.
- `Shift + PgUp/PgDown` scrolls by page.

Before drawing, the dock rect is filled with `CANVAS` so streamed Conversation text cannot bleed into blank rows.

All portfolio holdings are displayed in full (no row cap). Market and source sections are always visible. Scroll handles overflow naturally.

## Conversation scroll

Conversation renders from a virtual wrapped message list:

- `conversationMaxScrollUp()` clamps "lines from bottom" scroll state.
- `PgUp/PgDown` scrolls by page.
- Wheel over the Conversation region scrolls the message history.
- Left-button drag inside Conversation scrolls line-by-line.
- Submitting a new user message resets Conversation to the bottom.

Text is sanitized and hard-wrapped before rendering. `Buffer.text(..., xEnd)` also clips at the main pane boundary so thinking streams cannot overwrite the Overview dock.

## Composer — slash command system

### Visual modes

| Mode | Prompt | Text color | Hint |
|------|--------|-----------|------|
| Empty | `› write a task…▏` | dim | `Shift+drag copy · / commands · ↵ send` |
| Chat | `› user text▏` | cream | same |
| Command | `/cmd args▏` | gold, `/` bold gold | `↑↓ select · ↹ accept` |

### Dropdown panel

Slash suggestions render as a **floating panel above the Composer**, not inside it. This matches the Codex/PI interaction model.

```
┌─ / Commands ────────────────┐
│ ▶ /config  Settings panel   │
│   /resume  Resume session   │
│   /portfolio Local portfolio│
└─────────────────────────────┘
┌─ ⌘ Composer ────────────────────────────────┐
│ /da▏                                          │
└──────────────────────────────────────────────┘
```

- Gold border, title `/ Commands`
- Maximum 10 visible items, scroll if more
- Highlighted row shows `▶` prefix in gold
- Panel height bounded by available space above composer (minimum 3 rows)
- On small terminals without space, panel is hidden (no crash)

### Enter / Tab behavior

| Input | Suggestions exist? | Enter action | Tab action |
|---|---|---|---|
| `/` | All commands | Auto-completes to 1st command | Selects 1st |
| `/r` | `/resume` | Auto-completes to `/resume` | Fills selected |
| `/config` | none | **Submits `/config`** | Fills command |
| `/resume` | none | **Submits `/resume`** | Fills command |
| `hello` | None | Submits to AI agent | — |

**Rule**: Enter auto-completes only when the suggestion is a different command (fill starts with a different prefix). When fill is a subcommand/arg of the current input (`fill.startsWith(input + " ")`), Enter submits the current input and the dropdown stays visible.

**Safety**: Bare `/` is never submitted — `parseCommand` returns null for empty command, and the submit handler guards `text !== "/"`.

### Autocomplete

Top-level slash command metadata comes from `src/cli/catalog.ts` (`COMMAND_CATALOG`). `src/tui/src/input.ts` maps catalog entries to composer suggestions.

**Level 1**: Partial command name → matching top-level commands with descriptions (e.g. `/c` → `/config  Settings panel`, `/p` → `/portfolio  Local portfolios`)

**Level 2**: Exact command match with actions → action list when the catalog defines local UI actions.

**Level 3**: Exact command match without subcommands → no suggestions, Enter submits directly.

**Navigation**: `↑↓` cycles through the dropdown, `1-9` quick-selects, `Tab` fills the selected suggestion into the input. Typing resets selection to index 0. Escape clears input and suggestions (or exits app if input is empty).

### Raw input

`QuantTui` reads raw `stdin` chunks directly instead of relying on `readline` keypress events. `input.ts` parses:

- CSI keyboard sequences such as arrows, `PgUp`, and `Shift+PgUp`.
- SGR mouse sequences for wheel and drag.
- Partial chunks without leaking `35;135;57...` mouse bytes into Composer.

Mouse mode enables click, drag, and wheel reporting (`1000`, `1002`, `1006`). Hover reporting (`1003`) is intentionally disabled because it floods stdin during loading animations in Cursor/Windows terminals.

## Thinking bar

When agent activity is `"thinking"` or `"running tool"` and conversation has messages, a thin status line appears at the bottom of the conversation area (reserved, not overlapping message content):

```
⠋ "investment quote text" — Author Name
```

The spinner cycles through ora frames (`⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏`) every 80ms via the animation timer. The investment tip rotates every 5s from `getQuotes()` (sourced from `.ohquant/insights.json`, auto-regenerated from `notes/quant/*.md` on startup).

When conversation is empty and agent is active, the full-screen loading overlay shows the spinner + staircase animation + multi-line quote display instead.

## Status bar

Two rows: divider (`STATUS_H = 2`). Shows model name (gold) · A-share data source · active portfolio name.

Format: `◆ model · source · portfolio`

Source is read from `.ohquant/settings.json` → `preferences.aShareSource` (falls back to `globalSource` if A-share unset).

Portfolio name is resolved from `preferences.currentPortfolioFile` via `listLocalPortfolios()`, synced from config panel changes and portfolio panel selections in real-time.

Model is provided by `createInitialAppState()` / `AppRuntime.bootstrap()` from `.ohquant/settings.json` → `env.WHYJ_DEFAULT_SONNET_MODEL`, falling back to `deepseek-v4-pro`.

## Font support

All emphasis now stays on native terminal glyphs. There is no custom bitmap font layer.

## Responsive

| Terminal width | Portfolio dock | Conversation |
|---------------|----------------|--------------|
| `< 78` cols or `showPortfolioPanel: off` | hidden | full width |
| `≥ 78` cols and `showPortfolioPanel: on` | `clamp(36,48,⌊w·0.312⌋)` | `w − PANEL_W` |

The `showPortfolioPanel` toggle is in config (default: on). Independent from the Insight setting.

## Animation

Animation timer (`setInterval 80ms`) fires when `activity !== "ready"`, triggering repaints for:
- Staircase wave in header
- Loading overlay staircase + text pulses + ora spinner rotation
- Thinking bar spinner rotation at conversation bottom
- Tool elapsed timers in conversation

Once `activity === "ready"`, the timer pauses to save CPU.

## Tests

TUI tests follow the pi harness style: cover lifecycle boundaries and regressions with small pure tests rather than snapshotting full terminal frames.

| File | Tests | Coverage |
|------|-------|----------|
| `src/tui/test/slash-ux.test.ts` | 21 | Slash command complete UX simulation: auto-complete, Enter/Tab, subcommand dropdown, bare `/`, escape, backspace, history, number quick-select, ctrl+p, panel intercept |
| `src/tui/test/render.test.ts` | 29 | Layout, text/wrap/clip, scroll bounds, panel isolation, `capSections` (holdings cap, market/source always visible, group cap), portfolio display (3-column row, group fold, quotes, keyvalue, loading, section header) |
| `src/tui/test/input.test.ts` | 10 | Raw key parsing, mouse SGR parsing, leaked mouse fragment handling, region hit testing, Composer suggestions (commands, subcommands, watchlist) |
| `src/tui/test/panel.test.ts` | 3 | Add symbol, create group, picker dropdown navigation |
| `src/tui/test/buffer.test.ts` | 2 | Cell grid operations |
| `src/tui/test/selection.test.ts` | 3 | Text selection, copy from conversation |
| `src/tui/test/watchlist.test.ts` | 3 | Watchlist CRUD |

### UX simulation test design

`slash-ux.test.ts` directly exercises `QuantTui.handleKeyAction()` with synthetic `InputAction` objects. A `submitHandler` spy captures submitted text. Tests verify:

- **State transitions**: inputBuf after each keystroke, suggestionIdx after navigation
- **Auto-complete logic**: partial command → fill, exact command → submit, subcommand → skip auto-complete
- **Guard conditions**: bare `/` never submitted, escape clears input, panel intercepts keys
- **Edge cases**: wrap-around in suggestion list, empty input backspace, history after submit

### Portfolio display test design

`render.test.ts` portfolio tests render into a `Buffer(120, 32)` and inspect the plain-text output via `buf.toPlain()`:

- **Column alignment**: verify `code.padEnd(8)` and `pct.padStart(8)` produce correctly aligned rows
- **Section invariants**: group headers show `▼`/`▶`, collapsed groups hide rows, market always visible
- **capSections**: pure function tested separately with various section combinations

## Edge cases

| Case | Behavior |
|------|----------|
| Terminal `< 78` cols | Dock hidden, conversation fills width |
| Small terminal (dropdown overflow) | Slash dropdown hidden when `ddH < 3` (no crash) |
| CJK in names/labels | Counted as 2 cells by `strWidth` |
| Resize mid-stream | `layout()` recomputed, full repaint |
| Holdings overflow | Overview scrolls within the fixed dock rect; all rows rendered |
| Market data unavailable | Shows `Market / data: unavailable` keyvalue row |
| Long thinking output | Sanitized, hard-wrapped, and clipped to the main pane |
| Mouse SGR chunks | Buffered and parsed before Composer sees text |
| Bare `/` then Enter | Never submitted — auto-completes to first command |
| `\r\n` double Enter (Windows) | Second Enter processes normally, no double-submit |
| No `.ohquant/settings.json` | Model defaults to `deepseek-v4-pro` |
| No portfolio data | Empty Overview with "no data" title hint |
| Data backend unavailable | startup errors are tolerated, TUI still starts |
| Panel picker open + Escape | Picker closes, returns to field navigation |
