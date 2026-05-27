---
version: alpha
name: WhyJ Quant
description: >
  A stark, high-contrast brutalist canvas for quantitative finance. Pairs a premium
  soft-cream stage with a pitch-black technical engine floor, utilizing high-contrast
  monochrome inline image badges and sparse, high-voltage neon-mint accents.
  All mathematical formulas MUST be rendered with KaTeX (cdn.jsdelivr.net/npm/katex).
colors:
  primary: "#121413"
  accent: "#39E180"
  canvas-light: "#F7F9F6"
  canvas-dark: "#121413"
  surface-card: "#1E2220"
  text-light: "#121413"
  text-dark: "#F7F9F6"
  muted-light: "#707572"
  muted-dark: "#8C9490"
  hairline-light: "#E2E6E3"
  hairline-dark: "#2C302E"
  on-accent: "#121413"
typography:
  display-lg:
    fontFamily: "'Inter', 'Helvetica Neue', Arial, sans-serif"
    fontSize: 56px
    fontWeight: 800
    lineHeight: 1.1
    letterSpacing: "-1.8px"
  heading-md:
    fontFamily: "'Inter', 'Helvetica Neue', Arial, sans-serif"
    fontSize: 24px
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: "-0.5px"
  body-md:
    fontFamily: "'Inter', sans-serif"
    fontSize: 16px
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: "0px"
  code-mono:
    fontFamily: "'SF Mono', Menlo, Monaco, Consolas, monospace"
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "0px"
  button:
    fontFamily: "'Inter', sans-serif"
    fontSize: 14px
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "0.2px"
rounded:
  none: "0px"
  sm: "2px"
  md: "4px"
  lg: "8px"
  pill: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  base: "16px"
  lg: "24px"
  xl: "32px"
  section: "80px"
components:
  hero-section:
    backgroundColor: "{colors.canvas-light}"
    textColor: "{colors.text-light}"
    padding: "{spacing.section} {spacing.xl}"
  content-section-dark:
    backgroundColor: "{colors.canvas-dark}"
    textColor: "{colors.text-dark}"
    padding: "{spacing.section} {spacing.xl}"
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.canvas-light}"
    typography: "{typography.button}"
    rounded: "{rounded.sm}"
    padding: "12px 20px"
  button-accent:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    typography: "{typography.button}"
    rounded: "{rounded.sm}"
    padding: "12px 20px"
  data-card:
    backgroundColor: "{colors.surface-card}"
    textColor: "{colors.text-dark}"
    rounded: "{rounded.sm}"
    padding: "{spacing.lg}"
    border: "1px solid {colors.hairline-dark}"
---

## 6. Overview

NewForm is a design system that feels unapologetically technical, structured, and institutional. It rejects consumer-friendly "softness" (such as heavy drop shadows or plush border radii) in favor of severe editorial layouts and high contrast. The system functions across a dual-atmosphere paradigm: a premium, pristine light floor for hero presentations, which flips instantly into a deep, monolithic dark floor for technical documentation, logs, and interactive code terminals.

**Key Characteristics:**
- **Asymmetrical Dualism:** Split layouts that transition immediately from pure cream `{colors.canvas-light}` to pitch-black `{colors.canvas-dark}`.
- **Graphic Interruption:** Inline monochrome images or data ticker boxes embedded directly into headers to rupture standard text flows.
- **Micro-Dosed High Voltage:** Pure neon mint `{colors.accent}` is the single signal token. It is used strictly for operational statuses, active states, or critical interactive endpoints.
- **Zero Shadow Policy:** Depth is created exclusively via 1px geometric hairlines and absolute color block changes.

---

## 7. System Prose

### Colors
#### Brand & Accent
- **Primary Block** (`{colors.primary}` — #121413): The solid, anchoring ink color for light surfaces and the background for standard primary buttons.
- **Cyber Mint** (`{colors.accent}` — #39E180): The high-voltage warning/action color. Represents live network states, success signals, and premier transactional actions.
#### Surface
- **Soft Cream Canvas** (`{colors.canvas-light}` — #F7F9F6): The editorial surface for high-level positioning, marketing hero containers, and introduction layouts.
- **Engine Floor** (`{colors.canvas-dark}` — #121413): The dense, dark workspace background where protocol details, charts, and code snippets live.
- **Surface Card** (`{colors.surface-card}` — #1E2220): A slightly lifted charcoal plate nested exclusively inside dark engine floors.
#### Hairlines & Typography
- **Hairlines** (`{colors.hairline-light}`, `{colors.hairline-dark}`): Used for 1px structural grid layout dividers.
- **Typography** (`{colors.text-light}`, `{colors.text-dark}`): High-contrast layout inks. Muted states map to precise secondary grays to ensure accessible text density ratios.

### Typography
#### Principles
Display type must command the canvas with extreme weight (`800`) and ultra-tight negative tracking (`-1.8px`), simulating a physical printing press or high-density newspaper layout. In contrast, body text and mono-code components prioritize strict, un-decorated legibility.
#### Hierarchy Table
- **Display Large:** `56px / 1.1 / -1.8px tracking / Weight 800` (Used for Hero Headlines).
- **Heading Medium:** `24px / 1.3 / -0.5px tracking / Weight 700` (Section Titles).
- **Body Medium:** `16px / 1.55 / 0px tracking / Weight 400` (Technical Prose).
- **Code Mono:** `14px / 1.5 / 0px tracking / Weight 400` (Raw Code & Console Displays).

### Layout
The spacing scale is strictly non-linear and built on multiples of 4px. Section blocks enforce a mandatory `{spacing.section}` (80px) vertical buffer to create monumental breathing space between content transitions.
Grid systems do not use offset gaps; grids are composed of touching panels bounded by 1px solid `{colors.hairline-light}` or `{colors.hairline-dark}` borders.

### Elevation
This system recognizes zero drop shadows. All interface elements exist on flat, absolute dimensional layers defined by background color contrast:
- **Tier 1 (Light Base):** `{colors.canvas-light}` holding dark text elements.
- **Tier 2 (Dark Base):** `{colors.canvas-dark}` holding glowing accent elements.
- **Tier 3 (Elevated Panel):** `{colors.surface-card}` nested inside Tier 2, bounded by a 1px `{colors.hairline-dark}` outline.

---

## 8. Components

**`hero-section`**
The top entry container of any page surface. Enforces a light theme canvas background `{colors.canvas-light}` with `{colors.text-light}` content. Leverages `{spacing.section}` vertical padding to establish a premium, spacious initial impression.

**`content-section-dark`**
The dense technical layout floor. Switches immediately to `{colors.canvas-dark}` background and `{colors.text-dark}` typography. Any code block, data grid, or protocol diagram must reside within this container wrapper.

**`button-primary`**
The heavy geometric utility action. Flat background `{colors.primary}`, text `{colors.canvas-light}`, typography `{typography.button}`. Corner radius is restricted to sharp `{rounded.sm}` (2px). No hover transition or easing effects allowed - state changes must toggle instantly.

**`button-accent`**
The premier system call-to-action reserved for conversions. Utilizes the high-voltage `{colors.accent}` background, `{colors.on-accent}` text, and `{typography.button}`.

**`data-card`**
The structured micro-container for displaying parameters or metrics on dark surfaces. Formed with `{colors.surface-card}` background, bounded by a 1px `{colors.hairline-dark}` border, using a tight sharp profile `{rounded.sm}` (2px), and padded with `{spacing.lg}` (24px).

---

## 9. Operational Guardrails

### Responsive Behavior
| Breakpoint | Window Width | UI Transformation Blueprint |
|---|---|---|
| **Mobile** | `< 768px` | Sections collapse to single-column blocks. `{typography.display-lg}` scales down drastically from `56px` to `36px` to prevent text wrapping clipping. `{spacing.section}` reduces to `48px`. |
| **Desktop** | `≥ 768px` | Standard multi-column layout with 1px hairline dividers. Full scale typography rules apply without truncation. |

### Touch Targets
- All primary and accent action touch targets must occupy a minimum interactive footprint of `44px × 44px` via implicit element padding.
- Inline text links maintain a standard font size footprint but must provide an underline indicator on desktop hover.

### Known Gaps
- **Motion & Easing:** Micro-interactions, transition curves, and timing curves are intentionally un-documented. Agent must default to instantaneous `0ms` hard-state toggles.
- **Form States:** Input validations (warning/error focus borders) are omitted and default to standard system fallback tokens until alpha v2.
- **Dark-Mode Toggle:** There is no universal dark-mode ambient switch. The interface is structurally dualistic - light and dark components coexist permanently on the same timeline.
- **Formula Rendering:** All mathematical formulas MUST use KaTeX (`cdn.jsdelivr.net/npm/katex@0.16.9`). Display mode `$$...$$` for block formulas, inline `$...$` for text-embedded symbols. Auto-render with `renderMathInElement`.
