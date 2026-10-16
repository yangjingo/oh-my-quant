# WhyJ Quant Design System

Updated: 2026-10-15

This is the visual specification for the website, CLI/TUI, Desktop, and generated reports. It defines the warm palette implemented in the shared theme, website, CLI/TUI, Desktop source, generated reports, and exported JQ assets. The canonical workspace preview is captured from the updated website. Desktop installation and shortcut-icon acceptance remain separate release checks.

## 1. Visual Direction

**A quiet research workspace: warm black, cream text, restrained gold, and generous working space.**

Use the [historical design reference](./docs/assets/workspace-design-reference.png) for color relationships, spacing, and the balance between the research area and the secondary sidebar. This is a design input, not the current workspace preview.

![Current warm workspace preview: JQ identity, Market research, Overview visible, red-up convention, synthetic demonstration data](./docs/assets/workspace-preview.png)

The preview above shows the current website workspace. The linked historical reference is retained only as design input; its staircase logo, version label, example data, and market-color convention are not current product requirements. The current brand mark is JQ.

The single current product preview is [workspace-preview.png](./docs/assets/workspace-preview.png), captured from the website's `#workspace` in English with Market research selected, Overview visible, and the red-up convention. README and presentation materials reuse that exact file. The website's translated, interactive, and responsive states may vary deliberately; they are not independently maintained mockups. Do not label the website preview as a CLI screenshot.

Prioritize the research answer, its evidence, and the next action. Keep chrome quiet. Use alignment and spacing to establish hierarchy before adding containers, borders, or color.

## 2. Design Foundation

Use Google's Material Design 3 as a vocabulary for roles and reusable decisions, adapted to this product's visual identity. This specification does not adopt the default Material palette, Android components, or dynamic wallpaper colors.

- **Color roles:** distinguish a surface, content placed on that surface, an action, and content placed on that action. Apply intended foreground/background pairs. See [Material color roles](https://m3.material.io/styles/color/roles).
- **Tokens:** name reusable decisions rather than copying hex values into each component. See [Material foundations](https://m3.material.io/foundations/).
- **Typography:** use a small set of display, headline, title, body, and label roles with product-specific fonts. See [Material theming](https://developer.android.com/develop/ui/compose/designsystems/material3) and [applying type](https://m3.material.io/styles/typography/applying-type).
- **Accessibility:** verify contrast, focus, labels, and input behavior in the implemented interface. See [Google's accessibility guidance](https://developer.android.com/guide/topics/ui/accessibility/apps).

Keep three levels of responsibility clear:

| Level | Example | Responsibility |
|---|---|---|
| Reference value | `ref.color.gold = #C99A2E` | A reusable palette value |
| Semantic role | `sys.color.primary = ref.color.gold` | What that value means in the interface |
| Component assignment | `button.primary.background = sys.color.primary` | Where a role is used |

These semantic names describe the design contract; the implementation uses the existing shared token names. The shared implementation owner remains [theme-colors.ts](./src/types/theme-colors.ts).

## 3. Color System

### Reference-derived palette

The following exact colors were sampled from the supplied PNG, excluding antialiased edge pixels:

| Reference color | Value | Visual purpose |
|---|---|---|
| Warm black | `#0C0C0C` | Continuous workspace background |
| Cream | `#FFF3C4` | Important text and the product name |
| Gold | `#C99A2E` | Brand identity and selective emphasis |
| Warm gray | `#8F8A7B` | Supporting text |
| Quiet bronze-gray | `#8C856B` | Low-emphasis labels in the reference |
| Warm divider | `#3A362C` | Subtle separation |

Cream should replace the previous near-white reading tone. Warm gray should replace cool neutral gray. Gold remains the only brand accent; it should not dominate paragraphs or data tables.

### Semantic roles

| Role | Value | Use |
|---|---|---|
| `surface` | `#0C0C0C` | Main canvas and terminal background |
| `surfaceContainer` | `#141312` | Quiet panels, menus, and input regions |
| `surfaceContainerHigh` | `#1C1B18` | Raised controls or overlays when separation is needed |
| `onSurface` | `#FFF3C4` | Primary text and essential values |
| `onSurfaceVariant` | `#8F8A7B` | Supporting text on the three surfaces above |
| `primary` | `#C99A2E` | JQ mark, selected indicator, primary action, and focus ring |
| `onPrimary` | `#0C0C0C` | Text and icons on a gold fill |
| `primaryContainer` | `#2A2416` | Restrained selected or highlighted container |
| `onPrimaryContainer` | `#FFF3C4` | Text inside that highlighted container |
| `outline` | `#817F77` | Control boundaries that must remain identifiable |
| `outlineVariant` | `#3A362C` | Decorative dividers and grouping rules |

The surface ladder, selection container, and role assignments are product design decisions derived from the reference; they are not an automatically generated Material tonal palette. Do not introduce secondary or tertiary brand accents without a concrete information need.

### Pairing and contrast

Use at least 4.5:1 contrast for ordinary text and 3:1 for large text. Measure the actual size, weight, background, and state; Android `sp` values are not CSS pixels or terminal cells. Google documents these text-contrast thresholds in its [accessibility guidance](https://developer.android.com/guide/topics/ui/accessibility/apps#contrast).

Calculated against `surface` (`#0C0C0C`):

| Pair | Contrast |
|---|---|
| Cream text / warm black | 17.58:1 |
| Warm-gray text / warm black | 5.67:1 |
| Gold / warm black, including dark text on gold | 7.59:1 |
| Decorative divider / warm black | 1.62:1 |

The decorative divider must not be the only cue for a control or an important boundary. On selected containers, use `onPrimaryContainer`; warm-gray text on `#2A2416` is only about 4.47:1 and is unsuitable for ordinary text. Avoid opacity-based dimming of essential copy.

### Market and status semantics

Brand, market movement, and operation status are separate responsibilities. Gold does not mean profit, success, or investment quality.

The reference's dark green (`#3D603A`) and dark red (`#713228`) have only about 2.73:1 and 2.04:1 contrast against its canvas. Preserve their restrained character through these more readable domain colors:

| Domain role | Target value | Meaning |
|---|---|---|
| `marketGreen` | `#75A26F` | Green side of the selected market convention |
| `marketRed` | `#D87565` | Red side of the selected market convention |
| `positive` | `#75A26F` | Successful operation or explicitly positive outcome |
| `negative` | `#D87565` | Failed operation or explicitly negative outcome |
| `neutral` | `#8F8A7B` | Flat movement or unavailable value, with distinct labels |

The adjusted green and red exceed 5.4:1 against all three ordinary surfaces. They are product extensions, not colors prescribed by Google or literal samples from the image.

`/config > Market Colors` selects one explicit convention for the entire workspace: `red-up` by default, or `green-up`. Map rise/fall roles through that setting; never switch conventions silently per instrument. Operation success/failure and risk semantics do not flip with market colors.

Keep signs, numbers, labels, and legends visible. Distinguish `0.00%` from `N/A` and `--`. Risk amounts must not become positive simply because they are unsigned. New reports capture the convention used at generation time; historical reports remain unchanged. Changing a visual preference must not trigger an unrelated data request.

## 4. Typography

Use Geist Sans for website copy and graphical chrome. Use Geist Mono for commands, code, prices, dates, and aligned numbers. Keep fonts self-hosted and retain the [Geist license](./docs/assets/geist-license.txt).

The roles follow Material's naming model; the values below are a compact WhyJ scale, not the default Roboto scale.

| Role | Size / line height | Weight | Use |
|---|---|---|---|
| Display | 56 / 64px | 700 | Website hero; reduce to fit narrow screens |
| Headline | 32 / 40px | 600 | Section titles |
| Title | 22 / 28px | 600 | Panel or report titles |
| Body | 16 / 24px | 400 | Reading text and explanations |
| Label | 14 / 20px | 600 | Controls and navigation |
| Supporting | 13 / 20px | 400 | Secondary metadata |
| Data / code | 14 / 20px | 400 | Monospaced values and commands |

Use tabular numbers and right alignment for comparable numeric columns. Keep units, currency, dates, and missing-value conventions explicit. Reading paragraphs should normally stay within 65 characters per line. Use weight and spacing before adding more colors. These choices follow [Material's typography guidance](https://m3.material.io/styles/typography/applying-type).

Terminal font family and physical size belong to the user's terminal. The Desktop host supplies its own terminal font controls. Pixel typography rules do not imply that the CLI can enforce fonts, line height, or rounded shapes. Preserve CJK-aware width calculations and allow localized content to wrap normally.

## 5. Layout, Shape, and Interaction

- Keep the research area primary, Overview secondary, and Composer reachable. On a narrow terminal, hide the secondary pane before sacrificing input or readable research text. The current TUI threshold is 78 columns; it is an implementation rule, not a Material breakpoint.
- Use a spacing scale of `4, 8, 12, 16, 24, 32, 48, 80px` for graphical surfaces. In the CLI, budget rows and columns instead of translating pixels into cells.
- Prefer a continuous canvas, open sections, and a single quiet divider over repeated card borders. Leave working space without hiding useful content or creating artificial empty rows.
- Use square terminal/data regions, 4px compact controls, and up to 12px graphical overlays. Keep pill shapes for the website's primary call to action; do not turn every data region into a rounded card.
- Keep website navigation around 64px high and the Desktop utility bar around 48px. Maintain one clear brand group and stable alignment.
- Use a visible 2px gold focus ring with separation from the component. Focus, selection, and hover must be distinguishable. Every icon-only control needs an accessible name.
- Provide at least 44px graphical pointer targets where practical, and prefer 48px for touch. These are product target sizes, not a conversion of Android density-independent units.
- Keep motion functional: focus, opening, loading, and state feedback. Avoid moving logos, decorative market motion, and repeated entrance effects. Respect reduced-motion preferences.
- Make loading, empty, partial, stale, failed, and completed states explicit. Do not communicate them through color alone.

## Brand Rules

The full product name is **WhyJ Quant**. The mark is the compact **JQ** monogram. The product line is **Research before conviction.**

J sits inside Q and joins its short tail. Keep the approved geometry: a 64-unit viewBox; Q centered at `(31, 31)` with radius `19`; a `13 x 14` tail diagonal and a `3`-unit terminal horizontal. The monochrome, favicon, and application versions share the same geometry.

| Asset | Role |
|---|---|
| [logo-mark.svg](./docs/assets/logo-mark.svg) | Master JQ geometry |
| [logo-wordmark.svg](./docs/assets/logo-wordmark.svg) | Outlined Geist Semibold wordmark |
| [logo-lockup-dark.svg](./docs/assets/logo-lockup-dark.svg) / [logo-lockup-light.svg](./docs/assets/logo-lockup-light.svg) | Dark-background and light-background lockups |
| [logo-lockup-mono.svg](./docs/assets/logo-lockup-mono.svg) | Single-color lockup |
| [app-icon.svg](./docs/assets/app-icon.svg) | Application container source |
| [app-icon.ico](./docs/assets/app-icon.ico) | Seven Windows icon sizes, 16 through 256px |
| [icons/](./docs/assets/icons/) | PNG exports named `16x16.png` through `1024x1024.png` |
| [Asset preview](./docs/assets/index.html) | Actual exported variants and downloads |

Use lowercase kebab-case filenames based on asset role: `logo-mark` for the JQ symbol, `logo-wordmark` for the product name, `logo-lockup-{dark,light,mono}` for symbol-and-name combinations, and `app-icon` for the application container. The dark/light suffix identifies the intended background. Keep the nine raster exports as `icons/widthxheight.png`; `workspace-preview.png` is current, while `workspace-design-reference.png` is historical. The website retains the conventional public name `favicon.svg`, copied from `app-icon.svg`. Preserve the existing [ZCode naming reference](https://github.com/zai-org/ZCode/tree/main/public/logo/icons).

Use the same SVG in website and Desktop chrome. Use ASCII `JQ` in terminal headers and loading copy. Retain the existing self-hosted Lucide family for interface controls. Do not reintroduce feather, W, or staircase alternatives as active brand marks.

## 6. Implementation and Verification

The warm palette is implemented across the [shared theme](./src/types/theme-colors.ts), [website tokens](./site/public/styles.css), [Desktop chrome](./desktop/src/style.css), active report renderers, and SVG masters. The PNG icons and Windows ICO are exported from the same JQ geometry and colors.

| Area | Implemented roles |
|---|---|
| Canvas and panels | `#0C0C0C`, `#141312`, `#1C1B18` |
| Primary and supporting text | `#FFF3C4`, `#8F8A7B` |
| Brand and focus | `#C99A2E` |
| Decorative dividers | `#3A362C` |
| Domain green / red | `#75A26F` / `#D87565` |
| Current product preview | One website capture reused by README and slides |

Preserve semantic mappings, explicit market conventions, and immutable historical reports. These changes affect newly generated reports; saved historical reports retain their original bytes. The historical reference remains unchanged and is labeled as design input. Never create a second current palette in a report template or a client-specific patch.

Maintain the committed assets directly. When a master changes, update its SVG variants, website/Desktop copies, size-named PNGs, and Windows ICO together. Keep the PNG set only in `docs/assets/icons/`; Desktop consumes its committed `app-icon.ico` and `logo-mark.svg`. Builds use those files directly, without a separate brand-generation script. Verify both the color assignments and the rendered result.

For visual acceptance and subsequent changes, verify:

- Shared tokens, graphical surfaces, reports, and brand exports use the same role assignments.
- Reading text, numeric values, focused controls, and error states meet contrast requirements on their actual backgrounds.
- Small JQ icons remain recognizable at 16/24/32px in dark and light contexts.
- The website works on narrow screens and with keyboard navigation; CLI regions remain usable at small character-grid sizes.
- Desktop resource loading, window icons, and installer/shortcut icons are checked in the built application. A successful build is not installation proof.
- Synthetic illustrations and historical references remain labeled; they do not become evidence of live data, model performance, or deployment.
