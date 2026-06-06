# WhyJ Quant — TUI Layout Design

> last-updated: 2026-06-06

## 1. Design Tokens (src/tui/tokens.ts)

Single source of truth for all visual constants. All values follow `DESIGN.md`.

### Palette

| Token | Hex | Usage |
|-------|-----|-------|
| `GOLD` | `#D4AF37` | Primary accent: prompts, active states, highlights |
| `GOLD_HIGHLIGHT` | `#E2BE4D` | Hover/active variant |
| `PRIMARY_ON_DARK` | `#F0D77A` | Gold on dark background |
| `INK` | `#F5F5F5` | Primary text |
| `MUTED` | `#A6A6A6` | Secondary text, dimmed |
| `CANVAS` | `#0B0B0C` | Root background |
| `SURFACE` | `#111111` | Card surfaces |
| `SURFACE_ELEVATED` | `#171717` | Elevated surfaces |
| `SURFACE_TERMINAL` | `#000000` | Terminal panels |
| `DIVIDER_SOFT` | `#1A1A1A` | Subtle dividers |
| `HAIRLINE` | `#242424` | Border lines |

### Layout Constants

| Token | Value | Usage |
|-------|-------|-------|
| `SIDEBAR_WIDTH` | 34 | Right sidebar fixed width |
| `DIVIDER_CHAR` | `─` | Horizontal rule character |
| `SECTION_ACCENT` | `▎ ` | Sidebar section header prefix |

## 2. Component Tree

```
<App paddingX={1} paddingY={1}>
  <Box flexDirection="row" flexGrow={1}>

    ┌─ Main Column (left) ─────────────────────────────┐
    │ <Box width={mainWidth} marginRight={showSidebar ? 2 : 0}>  │
    │                                                    │
    │   [ConfigPanel]  (when configOpen)                  │
    │     OR                                             │
    │   [Conversation]  +  [Input]                       │
    │                                                    │
    │   Conversation                                     │
    │     <Message role="user" />       gold "> " prefix  │
    │     <Message role="system" />     text + thinking   │
    │       <ThinkingPanel />           gold spinner,     │
    │                                   elapsed, expand   │
    │     <Message role="tool" />       spinner→✓/✗      │
    │       <ToolCallInline />          status, result    │
    │     <Message role="error" />      gold "ERR" prefix │
    │                                                    │
    │   Input                                            │
    │     "> " prompt  placeholder  "|" cursor            │
    │     [numbered suggestion list]  (when autocomplete) │
    └────────────────────────────────────────────────────┘

    ┌─ Sidebar (right, 34 cols) ────────────────────────┐
    │ (hidden when terminal < 78 cols)                   │
    │                                                    │
    │   ▎ Portfolio  20/20 priced                        │
    │   ──────────────────────────────────────────       │
    │     CODE   NAME        PRICE    CHANGE             │
    │                                                    │
    │   ▎ Data                                          │
    │   ──────────────────────────────────────────       │
    │     tushare 12   akshare 2   llmquant-data 4      │
    └────────────────────────────────────────────────────┘

  </Box>

  ┌─ StatusBar (bottom) ────────────────────────────────┐
  │ ──────────────────────────────────────────────      │
  │   sonnet · portfolio v1/v2-semicon/v2-kc50 · name   │
  └─────────────────────────────────────────────────────┘
</App>
```

## 3. Responsive Layout

### Breakpoint calculation (app.tsx)

```typescript
const terminalWidth = stdout?.columns ?? 100
const rootPaddingX = 2          // App-level horizontal padding
const mainRightMargin = 2       // Gap between main column and sidebar
const minMainWidth = 40         // Minimum usable width for main column

// Sidebar visible when terminal >= 78 cols
const showSidebar = terminalWidth >= rootPaddingX + mainRightMargin + SIDEBAR_WIDTH + minMainWidth
//                  = terminalWidth >= 2 + 2 + 34 + 40 = 78

const mainWidth = Math.max(
  24,  // Absolute minimum
  terminalWidth - rootPaddingX - (showSidebar ? SIDEBAR_WIDTH + mainRightMargin : 0),
)
```

| Terminal Width | Sidebar | mainWidth |
|---------------|---------|-----------|
| < 78 cols | Hidden | terminalWidth - 2 |
| 78+ cols | Visible (34 cols) | terminalWidth - 38 |
| 200 cols (max) | Visible | 162 |

### Why the sidebar hides below 78 cols

The sidebar (34) + gap (2) + padding (2) + minimum usable main (40) = 78. Below this, the sidebar would make the main conversation area unreadable.

## 4. Component Layout Details

### Conversation (flexGrow: 1)

- Takes all available vertical space between header and input
- Messages auto-scroll with `flexDirection: "column"`
- Each message: `marginBottom: 1`

### Input (fixed height, bottom-anchored)

```
┌─ Prompt line ──────────────────────────────────┐
│ > ask a research question or type /          | │
└────────────────────────────────────────────────┘
┌─ Suggestions (conditional, marginTop: 1) ──────┐
│  1. /data   Download data                       │
│  2. /factor List or compute factors              │
└────────────────────────────────────────────────┘
```

- Placeholder text when empty: `"ask a research question or type /"`
- Gold `> ` prefix and `|` cursor
- Suggestions show with numbered selection (1-9), ↑↓ arrow navigation, Tab/Enter to accept
- Escape clears input

### Sidebar (fixed width 34, right-aligned)

Two sections with gold-accented headers:

```
▎ Portfolio  {priced}/{total} priced
  ──────────────────────────────────
  [code] [name]    [price]  [change%]

▎ Data
  ──────────────────────────────────
  {source} {count}  {source} {count}
```

Portfolio rows: 4 columns — code (17), spacer (1), price (7, right-aligned), change (7, right-aligned with color).

### StatusBar (bottom, full width)

```
──────────────────────────────────────────  (w = cols - 2)
{model} · portfolio {v1/v2-semicon} · {active-scheme-name}
```

- Separator: `DIVIDER_CHAR.repeat(w)` in dimmed color
- Active portfolio variant highlighted in GOLD
- Archived portfolio keys shown in dimmed

### Message States

| Role | Prefix | Color | Extras |
|------|--------|-------|--------|
| `user` | `> ` | GOLD, bold | — |
| `system` | — | default | ThinkingPanel above text |
| `error` | `ERR ` | GOLD | ThinkingPanel above text |
| `tool` | spinner/✓/✗ | GOLD (running) | elapsed timer, collapsible result |

## 5. Animation System

### Spinner (src/components/Spinner.tsx)

Frame-based animation from pi's Loader pattern. `setInterval` at configured interval, cycling frame index.

```typescript
// 9 variants, each with frames + interval
SPINNERS = {
  dots:       { frames: ["⠋","⠙","⠹","⠸","⠼","⠴","⠦","⠧","⠇","⠏"], interval: 80 },
  line:       { frames: ["|","/","-","\\"], interval: 120 },
  dots2:      { frames: ["⣾","⣽","⣻","⢿","⡿","⣟","⣯","⣷"], interval: 80 },
  arc:        { frames: ["◜","◠","◝","◞","◡","◟"], interval: 100 },
  star:       { frames: ["✶","✸","✹","✺","✹","✷"], interval: 70 },
  bounce:     { frames: ["⠁","⠂","⠄","⠂"], interval: 120 },
  triangle:   { frames: ["◢","◣","◤","◥"], interval: 100 },
  pipe:       { frames: ["┤","┘","┴","└","├","┌","┬","┐"], interval: 80 },
  simpleDots: { frames: [".  ",".. ","..."], interval: 200 },
}
```

### AnimatedText (src/components/AnimatedText.tsx)

| Component | Effect | Interval |
|-----------|--------|----------|
| `Pulse` | Brightness oscillation (dimColor toggle) | 600ms |
| `ProgressDots` | Trailing dots `""→"."→".."→"..."` | 300ms |
| `StreamCursor` | Blinking `▌` block | 530ms |
| `ElapsedTimer` | MM:SS counter | 1000ms |

### ThinkingPanel

```
[gold spinner] thinking...  0:23  [+]
  dimmed thinking text lines
  last line ▌ (streaming cursor)
```

- Gold spinner (dots variant, 80ms) while thinking
- ProgressDots animation after "thinking"
- ElapsedTimer from panel mount time
- Auto-collapse when `done=true`
- Toggle expand/collapse with [+] / [-]

### ToolCallInline

```
Running:  [gold spinner] tool_name · symbol · 0:05
Done:     ✓ tool_name · symbol  [+]
Error:    ✗ tool_name · symbol  [+]
```

- Spinner → checkmark/cross transition on status change
- Args preview derived from tool arguments (symbol/code/factor/ticker)
- Elapsed timer while running
- Collapsible result text (truncated at 150 chars in preview)

## 6. Edge Cases Handled

| Case | Behavior |
|------|----------|
| Terminal < 78 cols | Sidebar hidden, main fills width |
| Terminal < 24 cols | mainWidth clamped to 24 minimum |
| Agent init not yet complete | "Initializing..." message, no crash |
| API key not configured | Agent boots anyway, error surfaced on first API call |
| Long tool result (> 150 chars) | Truncated with "..." in preview, expandable |
| Thinking content empty | ThinkingPanel returns null |
| Concurrent tool calls | Each gets own message with independent spinner |
