---

version: alpha
name: WhyJ-Quant-Design-System
description: An AI-native quantitative research terminal built around a single premium gold accent. Deep-black canvases, geometric sans-serif typography, generous whitespace, and signal-first information architecture create a terminal experience that feels closer to Claude Code, Linear, and Bloomberg than traditional retail trading software. The interface removes decorative finance tropes and focuses on clarity, conviction, and research workflows.

colors:
primary: "#D4AF37"
primary-focus: "#E2BE4D"
primary-on-dark: "#F0D77A"
ink: "#F5F5F5"
body: "#F5F5F5"
body-on-dark: "#F5F5F5"
body-muted: "#A6A6A6"
divider-soft: "#1A1A1A"
hairline: "#242424"
canvas: "#0B0B0C"
surface: "#111111"
surface-elevated: "#171717"
surface-terminal: "#000000"
on-primary: "#0B0B0C"
on-dark: "#F5F5F5"

typography:
hero-display:
fontFamily: "Geist Sans, Inter, system-ui, sans-serif"
fontSize: 56px
fontWeight: 700
lineHeight: 1.05
letterSpacing: -1.2px

display-lg:
fontFamily: "Geist Sans, Inter, system-ui, sans-serif"
fontSize: 40px
fontWeight: 700
lineHeight: 1.1
letterSpacing: -0.8px

display-md:
fontFamily: "Geist Sans, Inter, system-ui, sans-serif"
fontSize: 32px
fontWeight: 700
lineHeight: 1.15
letterSpacing: -0.6px

lead:
fontFamily: "Geist Sans, Inter, system-ui, sans-serif"
fontSize: 24px
fontWeight: 400
lineHeight: 1.4
letterSpacing: 0px

tagline:
fontFamily: "Geist Sans, Inter, system-ui, sans-serif"
fontSize: 18px
fontWeight: 500
lineHeight: 1.4
letterSpacing: 0px

body-strong:
fontFamily: "Geist Sans, Inter, system-ui, sans-serif"
fontSize: 16px
fontWeight: 600
lineHeight: 1.5
letterSpacing: 0px

body:
fontFamily: "Geist Sans, Inter, system-ui, sans-serif"
fontSize: 16px
fontWeight: 400
lineHeight: 1.6
letterSpacing: 0px

caption:
fontFamily: "Geist Sans, Inter, system-ui, sans-serif"
fontSize: 13px
fontWeight: 400
lineHeight: 1.4
letterSpacing: 0px

caption-strong:
fontFamily: "Geist Sans, Inter, system-ui, sans-serif"
fontSize: 13px
fontWeight: 600
lineHeight: 1.4
letterSpacing: 0px

button:
fontFamily: "Geist Sans, Inter, system-ui, sans-serif"
fontSize: 14px
fontWeight: 500
lineHeight: 1
letterSpacing: 0px

nav-link:
fontFamily: "Geist Sans, Inter, system-ui, sans-serif"
fontSize: 13px
fontWeight: 500
lineHeight: 1
letterSpacing: 0px

rounded:
none: 0px
xs: 4px
sm: 8px
md: 12px
lg: 16px
pill: 9999px
full: 9999px

spacing:
xxs: 4px
xs: 8px
sm: 12px
md: 16px
lg: 24px
xl: 32px
xxl: 48px
section: 80px

components:
button-primary:
backgroundColor: "{colors.primary}"
textColor: "{colors.on-primary}"
typography: "{typography.button}"
rounded: "{rounded.pill}"
padding: 10px 18px

button-secondary:
backgroundColor: transparent
textColor: "{colors.primary}"
typography: "{typography.button}"
rounded: "{rounded.pill}"
padding: 10px 18px

terminal-panel:
backgroundColor: "{colors.surface-terminal}"
textColor: "{colors.body}"
rounded: "{rounded.none}"

card:
backgroundColor: "{colors.surface}"
textColor: "{colors.body}"
rounded: "{rounded.lg}"
padding: 24px

card-elevated:
backgroundColor: "{colors.surface-elevated}"
textColor: "{colors.body}"
rounded: "{rounded.lg}"
padding: 24px

navigation:
backgroundColor: "{colors.canvas}"
textColor: "{colors.body}"
typography: "{typography.nav-link}"
height: 48px

portfolio-widget:
backgroundColor: "{colors.surface}"
textColor: "{colors.body}"
rounded: "{rounded.md}"
padding: 20px

command-input:
backgroundColor: "{colors.surface-terminal}"
textColor: "{colors.body}"
rounded: "{rounded.none}"
height: 44px

footer:
backgroundColor: "{colors.canvas}"
textColor: "{colors.body-muted}"
typography: "{typography.caption}"
padding: 48px
-
Wordmark:

WhyJ Quant

Font:

Geist Sans

Weight:

600

Tracking:

-0.02em

Color:

#F5F5F5

Accent:

#D4AF37

Background:

#0B0B0C

## Brand Rules

Only one accent color exists:

{colors.primary}

Never introduce:

* Green
* Red
* Blue
* Purple

as brand colors.

Market movement colors are data visualization concerns and not brand identity.

## Layout Principles

Left aligned.

Whitespace first.

Content over decoration.

Signal over chrome.

Research over excitement.

## Product Motto

Research.
Backtest.
Invest.

Alternative:

Think in Signals.

Alternative:

Research Before Conviction.
