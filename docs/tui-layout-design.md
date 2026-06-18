# WhyJ Quant — TUI Layout Design

> last-updated: 2026-06-17
> revision: **r9 — region split: Analyzing / Overview / Composer / Modal Panels**

This document describes the current frame-buffer TUI layout and interaction model. The code-level guide is `src/tui/README.md`; this file is the visual/layout contract.

## 1. Region Map

The TUI is a fixed shell made of five independent regions:

| Region | Code | Purpose |
|--------|------|---------|
| Header | `drawHeader()` | Brand, version, and activity staircase |
| Analyze display | `drawConversation()` | Main message stream, thinking content, tools, bottom ora/tip |
| Portfolio / Overview dock | `drawPortfolio()` | Portfolio groups, market quotes, source rows |
| Composer input | `drawComposer()` | User input, command suggestions, pending queue/status |
| Status bar | `drawStatus()` | Model, data sources, active portfolio |

Modal panels are separate overlays owned by `PanelController` in `src/tui/src/panel.ts`.

```
┌────────────────────────────────────────────────────────────────────────────┐
│ ▁▃▅▇█ WhyJ Quant  v2.0.5                    │
├───────────────────────────────────────────────┬────────────────────────────┤
│ ╭ ◉ Analyzing ──────────────────────────────╮ │ ╭ ◫ Overview ───────────╮ │
│ │ ▏ user message                            │ │ │ ▎ ▼ Core              │ │
│ │ ● Bash.Read · Get-Content src/app.ts 0:02 │ │ │ 510300  沪深300ETF +0%│ │
│ │   ⎿ read app successfully                 │ │ │ ▎ Market              │ │
│ │ ▏ assistant answer                        │ │ │ 000001  上证指数  +1% │ │
│ │   gray thinking content                   │ │ │ ▎ Source              │ │
│ │ ⠋ Thinking... (10s · 18 tokens)           │ │ │ data    AKShare       │ │
│ │   Tip: "..." — Author                     │ │ ╰──────────────────────╯ │
│ ╰────────────────────────────────────────────╯ │                            │
├────────────────────────────────────────────────────────────────────────────┤
│ ┌─ / Commands ───────────────────────────────────────────────────────────┐ │
│ │ ▶ /config  Settings panel                                             │ │
│ └────────────────────────────────────────────────────────────────────────┘ │
│ ╭ ⌘ Composer ─────────────────────────── ↑↓ select · ↹ accept ─────────╮ │
│ │ /co▏                                                                 │ │
│ ╰────────────────────────────────────────────────────────────────────────╯ │
├────────────────────────────────────────────────────────────────────────────┤
│ ◆ deepseek-v4-pro · llmquant-data · Core                   │
└────────────────────────────────────────────────────────────────────────────┘
```

## 2. Layout Function

`layout(cols, rows, showPortfolioPanel)` is the single source of truth.

Default density is `compact`:

| Constant | Compact | Comfortable | Source |
|----------|---------|-------------|--------|
| `HEADER_H` | `2` | `3` | `src/tui/src/styles.ts` |
| `COMPOSER_H` | `6` | `8` | `src/tui/src/styles.ts` |
| `STATUS_H` | `2` | `2` | `src/tui/src/styles.ts` |

Region formulas:

```text
panelW      = clamp(36, 48, floor(cols * 0.312))
showPanel   = cols >= 78 && showPortfolioPanel !== false
mainH       = rows - HEADER_H - COMPOSER_H - STATUS_H
mainW       = showPanel ? cols - panelW : cols

mainPane    = { x: 0,     y: HEADER_H, w: mainW,     h: mainH }
analyzing   = { x: 1,     y: HEADER_H, w: mainW - 2, h: mainH }
overview    = { x: mainW, y: HEADER_H, w: panelW,    h: mainH }
composer    = { x: 0,     y: rows - COMPOSER_H - STATUS_H, w: cols, h: COMPOSER_H }
statusRow   = rows - 1
```

When the Overview dock is hidden, Analyze fills the full main width. The dock can be hidden by terminal width or `showPortfolioPanel: false`.

## 3. Unified Panel Primitives

There are two panel families:

| Family | Renderer | Use |
|--------|----------|-----|
| Fixed shell panels | `Buffer.box()` through `drawConversation`, `drawPortfolio`, `drawComposer` | Always-visible regions |
| Modal panels | `PanelController.drawPanelFrame()` | Config, resume/session, portfolio picker, help/hotkeys |

Shared rules:

- Every panel has a title in the top border.
- Borders use `S.rule`; titles use cream/gold styles.
- Content is clipped to the panel's inner rectangle.
- Before drawing a region, its rectangle is cleared with `CANVAS` to prevent text bleed from adjacent regions.
- Modal panels are centered and drawn over a dark backdrop.

Modal panel defaults:

```text
PANEL_W = 96
PANEL_H = 22
header info rows = 3
footer rows = 2
```

Modal interaction is consistent:

| Key | Action |
|-----|--------|
| `↑` / `↓` | Move selection |
| `Enter` | Toggle, apply, open draft, or run mode-specific action |
| `Esc` | Close draft/picker/panel |

## 4. Analyze Display Panel

The main message panel is always titled:

```text
◉ Analyzing
```

It is still backed by `conversation` naming in code because it renders the conversation history.

### Message Rows

| Role | Render shape |
|------|--------------|
| `user` | `▏ ` + bold cream text |
| `assistant` | `▏ ` + cream text |
| `thinking` | Dim gray content only; no `Thinking` heading or polite label |
| `tool` | `● Namespace.Action · args` plus running elapsed time |
| `tool.result` | `  ⎿ result preview`, dimmed |
| `error` | `▏ ERR ` + gold text |

Thinking behavior:

- Live thinking streams in gray.
- Non-empty thinking remains visible after finalization.
- Empty thinking is removed.
- Thinking text is sanitized, wrapped, and clipped to the Analyze panel.
- The polite heading `✻ Thinking` is intentionally not rendered.

Tool labels use pi-style namespaces from `src/tools/catalog.ts`:

```text
● Bash.Read · Get-Content src/tools/catalog.ts
● Bash.Write · Set-Content out.txt value
● Bash.Update · Get-Content a.ts | Set-Content b.ts
● Bash.Shell · node script.js
● Quant.Risk · 000300.SH
● Quant.Backtest · 000300.SH
● Quant.Factor · momentum
```

### Bottom Activity Area

When activity is not `ready` and messages exist, Analyze reserves two bottom rows:

```text
⠋ Thinking... (10s · 18 tokens)
  Tip: "如果买入前功课做对，正确的卖出时机几乎不存在" — Philip Fisher
```

Rules:

- The ora frame rotates every 80ms.
- The first row uses a bright banner color wave.
- Metadata is elapsed time plus estimated tokens.
- The second row starts with `Tip:`.
- Original error messages and tool error results are quoted in the tip before investment quotes.
- `message_end` sets activity to `ready` before final repaint so the bottom animation does not linger after assistant output completes.

When there are no messages and activity is active, the centered loading overlay is used instead of the bottom activity area.

### Scroll And Selection

Analyze uses a virtual wrapped line list:

- `conversationMaxScrollUp()` clamps scroll from bottom.
- `PgUp` / `PgDown` scroll by page.
- Mouse wheel over Analyze scrolls the history.
- Drag inside Analyze scrolls line-by-line.
- `Shift+drag` selects text.
- `Ctrl+Shift+C` copies the active selection.
- Submitting a new message resets Analyze to the bottom.

## 5. Portfolio / Overview Dock

The right dock title is:

```text
◫ Overview
```

It is rendered only when:

```text
cols >= 78 && showPortfolioPanel !== false
```

The dock contains sections, not arbitrary free text.

| Section kind | Header | Rows | Visibility |
|--------------|--------|------|------------|
| `group` | `▎ ▼/▶ title` + count divider | portfolio holdings | Can collapse |
| `holdings` | `▎ title` + divider | portfolio holdings | Full list, scroll if needed |
| `quotes` | `▎ title` + divider | market quotes | Always visible |
| `keyvalue` | `▎ title` + divider | label/value rows | Always visible |

Portfolio row shape:

```text
CODE(8)  name...                       pct(8)
510300   沪深300ETF                    +0.35%
```

Rules:

- Codes strip `.SH` / `.SZ` for display.
- Names are truncated to fit.
- `pct` is right aligned with sign.
- Positive/negative coloring follows `pctStyle()`.
- The dock clears its full rectangle before draw, preventing Analyze text bleed.
- Overflow scrolls inside the dock; holdings are not row-capped.

Data flow:

- `AppRuntime` owns panel refreshes.
- The dock does not scan `.ohquant/data` directly.
- Portfolio symbols come from local portfolio storage.
- Live quotes are fetched during runtime refresh.
- Market and source sections are appended after portfolio sections.

## 6. Composer Input Box

The Composer is a fixed bottom input surface:

```text
╭ ⌘ Composer ─────────────── Shift+drag copy · / commands · ↵ send ╮
│ › natural language input▏                                        │
╰──────────────────────────────────────────────────────────────────╯
```

Visual modes:

| Mode | Prompt | Style | Right hint |
|------|--------|-------|------------|
| Empty | `›` | dim placeholder | `Shift+drag copy · / commands · ↵ send` |
| Chat | `› text▏` | cream | same |
| Slash | `/cmd args▏` | gold | `↑↓ select · ↹ accept` |
| Queued | input plus queue status | cream/dim | `{n} queued · ↵ send · / commands` |

Composer never owns command execution. It only returns submitted text to `AppRuntime`.

### Suggestions Popup

Slash suggestions are drawn as a floating panel above Composer, not inside Composer.

```text
┌─ / Commands ─────────────────────────┐
│ ▶ /config     Settings panel         │
│   /resume     Resume session         │
│   /portfolio  Local portfolios       │
└──────────────────────────────────────┘
╭ ⌘ Composer ──────────────────────────╮
│ /co▏                                 │
╰──────────────────────────────────────╯
```

Rules:

- Top-level slash metadata comes from `src/cli/catalog.ts`.
- Watchlist code/name completions come from `src/tui/src/watchlist.ts`.
- Up to 10 suggestion rows are visible.
- If there is not enough vertical space (`ddH < 3`), the popup is hidden.
- `Enter` autocompletes only partial commands; exact commands submit.
- Bare `/` is never submitted.

Input controls:

| Key | Behavior |
|-----|----------|
| `Enter` | Submit or autocomplete partial slash |
| `Tab` | Accept selected suggestion |
| `↑` / `↓` | Suggestion selection, history, or last touched scroll region |
| `Esc` | Clear input/suggestions or close panel |
| `Ctrl+P` | Open config panel |
| `Ctrl+C` | Clear input, or exit when input is empty |
| `Ctrl+D` | Exit |

## 7. Header

Header contains the staircase glyph and brand:

```text
▁▃▅▇█ WhyJ Quant  v...
```

Activity animation:

| Activity | Staircase behavior |
|----------|--------------------|
| `ready` | static gold gradient |
| `starting` | slow wave |
| `thinking` | medium wave |
| `running tool` | fast wave |

## 8. Status Bar

The status bar is the last row plus a divider above it:

```text
◆ model · source · activePortfolio
```

Sources:

- `model`: from settings/runtime bootstrap.
- `A:`: `preferences.aShareSource`.
- `G:`: `preferences.globalSource`.
- portfolio: active local portfolio resolved from settings and local portfolio metadata.

## 9. Raw Input And Mouse

`QuantTui` reads raw `stdin` and normalizes chunks through `nextInputAction()`:

- CSI keyboard sequences: arrows, PageUp/PageDown, Shift modifiers.
- SGR mouse sequences: wheel, press, release, drag.
- Partial mouse fragments are buffered or discarded before they can leak into Composer.

Mouse behavior:

| Mouse action | Region | Behavior |
|--------------|--------|----------|
| Wheel | Analyze | Scroll message history |
| Wheel | Overview | Scroll dock |
| Drag | Analyze/Overview | Scroll line-by-line |
| Shift+drag | Analyze/Overview | Select text |

Hover reporting is intentionally disabled to avoid flooding stdin during animations.

## 10. Responsive Rules

| Condition | Overview dock | Analyze width |
|-----------|---------------|---------------|
| `cols < 78` | hidden | full main width |
| `showPortfolioPanel === false` | hidden | full main width |
| otherwise | `clamp(36, 48, floor(cols * 0.312))` | `cols - panelW` |

`WHYJ_UI_DENSITY=comfortable` increases header/composer vertical space. Compact is the default.

## 11. Animation

The TUI runs an 80ms animation timer, but repaints only when `activity !== "ready"`.

Animated elements:

- Header staircase wave.
- Loading overlay staircase and quote pulse.
- Bottom ora spinner and bright banner color.
- Tool elapsed time while a tool is running.

Ready state pauses animation repaint work.

## 12. Tests

TUI tests are small, deterministic tests rather than full terminal snapshots.

| File | Coverage |
|------|----------|
| `src/tui/test/render.test.ts` | Layout, clipping, fixed `◉ Analyzing`, gray thinking without polite heading, bottom activity rows, tool labels, overview rendering |
| `src/tui/test/input.test.ts` | Raw key/mouse parsing, hit testing, suggestions |
| `src/tui/test/slash-ux.test.ts` | Composer slash UX simulation |
| `src/tui/test/stream_think_test.ts` | Thinking lifecycle and finalization |
| `src/tui/test/panel.test.ts` | Modal panel editing and picker behavior |
| `src/tui/test/selection.test.ts` | Selection and copy extraction |
| `src/tui/test/buffer.test.ts` | Cell buffer and styles |
| `src/tui/test/watchlist.test.ts` | Watchlist loading |

Recommended checks:

```bash
bun test src/tui/test
bun run typecheck
```

## 13. Edge Cases

| Case | Expected behavior |
|------|-------------------|
| Long thinking output | Gray, wrapped, clipped to Analyze, no polite heading |
| Tool result is long | Result preview is truncated |
| Assistant output completes | Bottom ora is cleared before final repaint |
| Overview overflow | Dock scrolls; Analyze cannot bleed into it |
| Small terminal | Overview hidden; suggestion popup hidden if no space |
| CJK text | `strWidth()` counts wide glyphs correctly |
| Bare `/` + Enter | Autocomplete, never submit |
| Windows `\r\n` | No double submit |
| Mouse SGR fragments | Buffered/discarded before Composer text handling |
