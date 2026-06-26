# TUI

WhyJ Quant's TUI is a zero-dependency frame-buffer terminal UI. It renders a fixed app shell:

- Header: animated WhyJ Quant mark and version.
- Main: `◉ Analyzing` message stream, with an optional right-side `◫ Overview` dock.
- Composer: natural-language input and a compact slash-command suggestion list rendered inside Composer.
- Status: active model, A-share source, global source, and active local portfolio.

The layout spec lives in `docs/tui-layout-design.md`. This README is the code map for working in `src/tui`.

## Module Map

| File | Role |
|------|------|
| `src/tui.ts` | `QuantTui` lifecycle, alt-screen setup, repaint loop, keyboard/mouse dispatch, scroll state, panel routing |
| `src/render.ts` | Pure renderers: layout, header, analyzing panel, overview dock, composer, status bar |
| `src/render-lines.ts` | Structured message-line renderer for assistant/tool text: compact tables, sparkline/K-line/bar blocks, semantic cell styling |
| `src/buffer.ts` | Cell-grid buffer, box drawing, CJK-aware text clipping, ANSI flush |
| `src/input.ts` | Raw input parser, CSI keys, SGR mouse events, hit testing, slash/watchlist suggestions |
| `src/panel.ts` | Modal panels for config, resume/session, local portfolios, help |
| `src/selection.ts` | Selection hit testing, highlighting, copy extraction |
| `src/clipboard.ts` | Clipboard write helper |
| `src/styles.ts` | Palette, density constants, percent coloring, style presets |
| `src/types.ts` | `AppState`, `UIMessage`, `ToolState`, `PanelSection`, `Layout` |
| `src/watchlist.ts` | Watchlist loading for composer autocomplete |
| `src/banner.ts` | Startup banner |

## Runtime Boundary

`QuantTui` does not execute slash commands, call the agent, or read market data directly. It receives `AppState` patches from `AppRuntime`:

```ts
tui.update({ messages, activity, panel, panelLoading, activePortfolio });
```

User input flows the other way:

```ts
tui.onSubmit((text) => runtime.submit(text));
```

This keeps rendering deterministic and makes most behavior testable with `Buffer` snapshots or focused state assertions.

## Rendering Rules

The main panel title is always `◉ Analyzing`.

Message rows are intentionally compact:

| Role | Rendering |
|------|-----------|
| `user` | `▏ ` gutter + bold cream text |
| `assistant` | `▏ ` gutter + cream text |
| `thinking` | gray content only; no `Thinking` heading or polite label |
| `tool` | pi-style `● Namespace.Action · args`, optional `⎿ result` preview |
| `error` | `▏ ERR ` prefix |

Assistant and tool-result text passes through `render-lines.ts` before drawing:

- Markdown pipe tables and double-space aligned text tables are normalized into no-pipe three-line tables.
- A header is only treated as a header when the next row is a divider; plain aligned data rows do not make the first row bold.
- Standalone divider rows such as `---` or `───` are absorbed into the table block and re-rendered at the same width as the content rows.
- Positive market values use `MARKET_UP` (red for A-share convention); negative market values use `MARKET_DOWN` (green).
- Sparkline, K-line, bar/exposure, and benchmark comparison glyphs are colored through semantic chart tokens in `styles.ts`.

Thinking content is preserved after finalization when non-empty, but empty thinking blocks are removed. The bottom activity bar is separate from thinking content:

```text
⠋ Thinking... (10s · 18 tokens)
  Tip: "..." — Author
```

`AppRuntime` sets activity to `ready` before emitting the final assistant message so this bottom animation does not linger after output completes.

## Layout Behavior

`layout(cols, rows, showPortfolioPanel)` computes stable regions:

- Header: fixed top rows.
- Main pane: left analyzing area plus optional right overview dock.
- Composer: fixed bottom input surface; slash suggestions open inside Composer, below the input row, as a compact inline list.
- Status: final row with a divider above.

The Overview dock is hidden when the terminal is narrower than 78 columns or when settings disable it. Text has terminal control codes stripped, then is wrapped and clipped to region boundaries so streamed thinking cannot bleed into the dock. Slash suggestions stay inside Composer so they do not overlap the `◉ Analyzing` panel or the TUI activity rows above it. In compact density, Composer is tall enough to show 5 slash suggestion rows by default.

## Input Model

`QuantTui` reads raw stdin chunks and uses `nextInputAction()` to produce normalized key or mouse actions.

Important interactions:

- `Enter`: submit natural language or exact slash command; partial slash input first autocompletes.
- `Tab`: accept selected suggestion.
- `Up/Down`: move suggestions, history, or the last touched scroll region.
- `PgUp/PgDown`: scroll Analyzing; `Shift+PgUp/PgDown` scrolls Overview.
- Mouse wheel: scrolls the region under the cursor.
- Mouse drag: scrolls, or selects text when Shift is held.
- `Ctrl+Shift+C`: copy current selection.
- `Ctrl+P` or `/config`: open the config panel.
- `Esc`: clear input/suggestions or close active panel.

Slash suggestions come from `src/cli/catalog.ts`; top-level command matches use the longer `help` text rather than the short label. Symbol/name suggestions come from the local watchlist.

## Panels

Panels are owned by `PanelController` and draw as centered modals over the app:

- Config: model, thinking level, API keys, data sources, active portfolio, Overview toggle.
- Resume/session: local session list and resume actions.
- Portfolio: local portfolio list and selection.
- Help: read-only command and key reference.

Panel key handling intercepts input before Composer behavior. Most panels use `Up/Down`, `Enter`, and `Esc`.

## Tests

Run focused TUI tests:

```bash
bun test src/tui/test
```

Common targeted suites:

```bash
bun test src/tui/test/render.test.ts
bun test src/tui/test/input.test.ts
bun test src/tui/test/slash-ux.test.ts
bun test src/tui/test/stream_think_test.ts
```

What they cover:

- `render.test.ts`: layout, clipping, panel isolation, fixed `◉ Analyzing` title, gray thinking without polite heading, tool labels, structured table/chart lines, overview rows, status line.
- `stream_think_test.ts`: thinking lifecycle and finalized gray content.
- `input.test.ts`: raw key/mouse parsing and suggestions.
- `slash-ux.test.ts`: full composer slash UX simulation.
- `panel.test.ts`: config/local portfolio panel behavior.
- `selection.test.ts`: selection mapping and extraction.
- `buffer.test.ts`: cell-grid behavior.
- `watchlist.test.ts`: watchlist loading.

Use `bun run typecheck` after changing public TUI types or app-state wiring.
