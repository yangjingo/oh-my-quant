# WhyJ Quant — TUI Layout Design

> last-updated: 2026-06-06
> revision: **r2 — full-screen docked layout** (supersedes the Ink-flexbox draft)

Frame-buffer TUI with persistent Portfolio dock. Architecture inspired by deepseek-tui (ratatui).

```
┌ header ───────────────────────────────────────────────────────────────────┐
│ ▌ WhyJ Quant  hunterbown · claude-sonnet-4-6              ◆ ready · v2.0.0 │
├────────────────────────────────────────────────┬──────────────────────────┤
│ conversation (scrolls, bottom-anchored)         │ ╭ Portfolio ──── 3 held ╮│
│   ▏ user message              (gold gutter)     │ │ ▎ Holdings            ││
│   · thinking done 0:14 [-]                      │ │ ─────────────────────  ││
│   ▏ assistant text…                             │ │ 000001 平安银行        ││
│   ✓ run_backtest · 600519.SH · 20/60 [+]        │ │           10.68  0.00% ││
│                                                 │ │ ▎ Watchlist           ││
│                                                 │ │ ▎ Market              ││
├ Composer ──────────────────────── / · ↵ · ^C ───┤ ╰───────────────────────╯ │
│ › analyze 平安银行 risk▏                         │                          │
├───────────────────────────────────────────────────────────────────────────┤
│ WhyJ · claude-sonnet-4-6 · $0.01 · Activity: ready      Cache 97.9% hit    │
└───────────────────────────────────────────────────────────────────────────┘
```

## Implementation

| File | Purpose |
|------|---------|
| `src/tui/buffer.ts` | Cell-grid Buffer with `text`, `box`, `hline`, `vline` primitives + ANSI render |
| `src/tui/utils.ts` | `strWidth` (CJK-aware), `truncate`, ANSI constants |
| `src/tui/styles.ts` | Style presets (`S.gold`, `S.cream`, `S.dim`, etc.), `pctStyle`, format helpers |
| `src/tui/types.ts` | `AppState`, `UIMessage`, `Holding`, `Quote`, `PanelSection`, `Layout` |
| `src/tui/tokens.ts` | Palette, `HEADER_H`, `COMPOSER_H`, `STATUS_H`, `BOX_CHARS` |
| `src/tui/render.ts` | Pure render functions: `drawHeader`, `drawConversation`, `drawPortfolio`, `drawComposer`, `drawStatus`, `layout()` |
| `src/tui/tui.ts` | `QuantTui` class: alt-screen, atomic flush, resize handler, `update(partial)` |

## Layout (layout function)

```
rows (R, cols C):
  header        y=0,                  h=HEADER_H (2)
  main          y=HEADER_H,           h=R - HEADER_H - COMPOSER_H - STATUS_H
     conversation  x=1,        w=C - PANEL_W - 2   (if dock visible)
     portfolio     x=C-PANEL_W, w=PANEL_W          (persistent dock)
  composer      y=R-COMPOSER_H-STATUS_H, h=COMPOSER_H (3)
  status        y=R-1,                h=STATUS_H (1)
```

`PANEL_W = clamp(30, 40, floor(C * 0.26))`. Dock hidden when `C < 78`.

## Key design decisions

- **Alternate screen** (`?1049h`) + **synchronized output** (`?2026h/l`) for tear-free frames
- **Pure render functions** over `(Buffer, Rect, State)` — testable without a terminal
- **Portfolio dock** drawn every frame from `PanelSection[]` — extensible (Holdings, Watchlist, Market, Data, Alerts)
- **CJK-aware** `strWidth` — all alignment uses visual width, not `.length`
- **Title-in-border boxes** via `Buffer.box({title, titleRight})`

## Responsive

| Terminal width | Portfolio dock | Conversation |
|---------------|----------------|--------------|
| `< 78` cols | hidden | full width |
| `≥ 78` cols | `clamp(30,40,⌊w·0.26⌋)` | `w − PANEL_W` |

## deepseek-tui mapping

| deepseek-tui (ratatui, Rust) | WhyJ Quant (TS frame buffer) |
|------------------------------|------------------------------|
| `Layout::default().constraints([...])` split | `layout(C,R): Layout` |
| `Block::default().borders(ALL).title(..)` | `Buffer.box({title, titleRight})` |
| right `Tasks` dock | right `Portfolio` dock (persistent) |
| `Paragraph` + scroll offset | `drawConversation` bottom-anchored wrap |
| bottom `Composer` block | `drawComposer` |
| cache-hit footer | `drawStatus` colored footer |
| `terminal.draw(\|f\| …)` per tick | `renderFrame(buf)` + atomic `flush()` |

## Animation

Spinner/elapsed timer advance via `setInterval` → `tui.refresh()`. Only the affected region re-renders.

## Edge cases

| Case | Behavior |
|------|----------|
| Terminal `< 78` cols | Dock hidden, conversation fills width |
| CJK in names/labels | Counted as 2 cells by `strWidth` |
| Resize mid-stream | `layout()` recomputed, full repaint |
| Holdings overflow | Clipped to rect height |
