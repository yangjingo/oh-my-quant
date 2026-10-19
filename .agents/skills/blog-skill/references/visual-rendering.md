# Figures, icons, and the reading page

Use the [accepted HTML template](html-template.md) as the concrete layout and interaction reference. Its bundled HTML can be served locally; the canonical renderer remains the implementation source.

## Manus and Langfuse editorial reference

The user's references guide prose and illustration choices without replacing the selected JQ brand. These official pages were read and visually inspected on 2026-10-18:

- Manus, [Context Engineering for AI Agents: Lessons from Building Manus](https://www.manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus): concrete team decisions and local mechanisms explain engineering experience. The KV-cache figure compares changing context and cache reuse. Borrow comparable mechanism diagrams, not the site's white background, serif fonts, or brand assets.
- Langfuse, [How we use agents to review production infrastructure](https://langfuse.com/blog/2026-06-05-agentic-setup-for-operational-work): actual review outputs ground the explanation of data, MCP, and repository skills, with a concrete directory view. Prefer inspectable artifacts to broad capability slogans.

The following are this repository's editorial choices, not claims about every article on either site:

1. Start with a specific repository conflict and the assumption a failure overturned. Progress through observation, mechanism, decision, evidence, and cost rather than PR chronology.
2. Use short connected paragraphs and concrete headings, such as "691 tests passed, but the ledger was wrong" or "Make main wait for required checks." Retain dates, inputs, sources, and uncertainty; compress repeated disclaimers and generic conclusions.
3. Give each figure one question. Choose before/after comparisons, responsibility boundaries, data flow, or real directory structures as appropriate. Do not force every topic into the same node diagram. Use comparable scales and meaningful edges.
4. Place figures beside the relevant argument and continue the reasoning afterward. Reduce card frames, repeated large titles, decorative icons, and saturated blocks. Preserve English labels, editable SVG, figure numbers, and sources. Use JQ gold only for the important difference or relationship.
5. Use screenshots when actual product behavior matters. Distinguish reused figures from original drawings; editorial inspiration does not grant image reuse permission. Minimal icon controls are the user's requirement, not a claimed universal pattern of these websites.

## Verify the selected design

Compare DESIGN, current assets, and any user-selected design branch. Distinguish local main, brand proposals, and production. Use the version supported by task context; ask only if the choice cannot reasonably be inferred. Pin the source SHA for an unmerged brand preview without changing production configuration to imply consistency.

Read theme values from that version. Native mechanism figures share canvas, surface, text, muted, divider, and accent tokens. Do not maintain independently approximated colors per figure. Gold is a limited emphasis color; preserve meaningful status/category distinctions.

For long-form reading, reserve bright cream for headings and selective emphasis. This includes a key sentence inside a paragraph: use Markdown `**...**` / HTML `<strong>` with `--ink: #FFF3C4`. Keep surrounding prose warm gray and avoid highlighting whole paragraphs or many consecutive sentences. Use `--reading-text: #B8B4A8` for paragraphs, lists, table values, code, and bibliography text, and `--reading-link: #C4B68E` for underlined prose links. Keep supporting text at `#8F8A7B`, and override reading colors for white-background print output. Expanded tables must retain the same text role. Do not dim the whole article with opacity or recolor diagrams to fix prose brightness.

Matching colors alone does not match illustration style. Inspect brand, functional icons, and content-illustration examples separately. Define each figure's mechanism or idea, composition, lines, and material before choosing SVG or image generation. An independently requested WhyJ hand-drawn style need not inherit a dark website background. If the distinction between JQ branding and WhyJ illustration style remains ambiguous, offer concrete choices.

## Selected JQ technical illustrations

For this Repo Ops article, the user selected technical architecture diagrams with the JQ palette. Reuse that decision unless they change it. Technical relationships determine structure.

- Selected palette: warm black `#0C0C0C`, matte surfaces `#141312` / `#1C1B18`, cream `#FFF3C4`, restrained gold `#C99A2E`, and divider `#3A362C`. Check the actual design revision; changing site CSS does not automatically recolor exported files.
- Prefer two-dimensional architecture, flow, or sequence diagrams. Nodes represent actual components, artifacts, or actors. Edges represent evidenced dependencies, calls, outputs, constraints, or feedback. Distinguish guidance from enforcement, automatic checks from human judgment, and implementation from proposals. Do not draw parallel checks as serial dependencies.
- Use flat layouts, consistent strokes, short labels, and enough space. Do not replace technical relationships with architectural metaphors, perspective, engraving, or decorative gold lines. Define solid/dashed line semantics. Prompts such as "architectural engraving" or "not a flowchart" are inappropriate for these diagrams.
- Prefer editable SVG or generators that read theme tokens. Use English inside figures; both language pages reuse them. Keep original logo assets.
- Examples: `docs/blog/agentic/images/repo-ops-governance.svg` and `repo-ops-merge-flow.svg`; generator: `site/previews/vibe-repo-ops/architecture.ts`. Mobile variants preserve relationships. The two earlier conceptual PNGs were rejected and are not positive examples of this style.

## Brand and functional icons

Use the selected original logo and favicon; do not recreate JQ/Q with similar characters. Functional icons use the site's Lucide source, dimensions, strokes, and license. Fetch additions from the same pinned revision. Do not substitute Unicode arrows, emoji, or another icon set.

Icon-only controls need localized accessible names, hover titles, visible focus, and sufficiently large targets. Do not show a nonfunctional language switch without an English article. Verify real paths, dimensions, colors, resource responses, and mobile rendering, not just SVG element presence.

## Reading layout and article actions

Place desktop contents navigation on the left of the reading column, aligned with the beginning of the article body (TL;DR), not the hero title. Use a shared layout row instead of a fixed top offset so title wrapping and feedback messages preserve alignment. Keep the sidebar sticky as the reader proceeds. Reveal it gradually with a restrained slide/fade as the body enters view; smoothly expand the active section's children instead of abruptly toggling display. Collapsed children must not retain keyboard focus targets. Respect reduced motion with instant visibility and no transitions; no-JS must retain usable contents. On small screens, use a compact disclosure without a side column.

Near the title, show an explicit estimated reading time calculated from the current manuscript. Label it as an estimate and update it after edits. Keep author, publication/revision date, and draft status readable without crowding the heading.

Put minimal Lucide share and print/save-PDF icons near this metadata. Accessible names, tooltips, and concise action feedback must explain their behavior. Prefer native sharing when supported; fall back to copying the canonical public URL. Local drafts share their actual preview URL, never an unrelated production homepage. Treat cancellation as cancellation, not failure; report copy failures truthfully and retain a usable link.

The PDF action opens the browser print dialog for printing or saving as PDF. Do not promise a silent download when only `window.print()` is implemented. Print the complete article, figures, references, and source tables while excluding navigation, toolbars, and embedded players. Verify that hidden/filtered data is restored for print and that reading state remains usable afterward. Without JavaScript, the article and browser's own sharing/printing remain available; do not expose inert custom buttons.

## Choose media by its nature

Prefer editable SVG for architecture, flows, relationships, and sequences. Use suitable raster formats for actual screenshots and photographs; wrapping a bitmap in SVG does not make it editable.

| Type | Treatment |
| --- | --- |
| Original mechanism/flow | Preserve SVG, data, or generator; express meaning through lines, labels, and groups |
| Multiple data series | Keep meaningful distinctions, legends, units, axes, and traceable data |
| Actual screenshot | Preserve colors, state, and ratio; label environment/version; no global recoloring of evidence |
| External/generated image | Identify provenance, applicable reuse permission, or generated nature; never imply real execution |

Do not require one image per section. Illustrate relationships that prose cannot readily convey. Figures and prose use the same revision and terminology; decoration cannot replace a missing explanation.

Every figure needs a visible title, number, descriptive alt text, and explanatory caption. Begin captions with a localized "Figure N | Specific title," then explain relationships and evidence boundaries. A hidden SVG `<title>` does not replace a visible heading; filenames are not alt text.

Use English for internal titles, nodes, edges, legends, notes, source labels, and SVG `<title>` / `<desc>`. Keep code identifiers and mathematical meaning. Localize external titles, captions, and alt text. Prefer English originals for reused figures; adapt only with appropriate provenance and semantic fidelity. If no appropriate English version or adaptation is available, link the source rather than embedding a non-English figure. Do not edit an authentic screenshot into fabricated evidence. Cited video footage and official covers follow the separate media rules.

After translating labels, remeasure nodes, wrapping, and connectors. Prefer concise accurate labels or a better layout over tiny text. Inspect actual generated SVG text, not only filenames or captions.

For external figures, find the original publication, identify the author/institution, title/number, URL, and whether unchanged, cropped, adapted, or newly drawn from sources. Include permission/license details and source links alongside the figure when applicable; do not repeat figure-source explanations in References. If provenance or permission is unclear, use a source link instead of a search thumbnail. Do not recolor evidence or alter the original conclusion for branding. Verify assets at their deployed paths; avoid expiring hotlinks.

## Responsive figures and zoom

- Fit the reading column while preserving ratios; provide real dimensions for images and responsive sources to prevent layout and anchor shifts.
- Derive vertical mobile layouts from the same data for complex wide diagrams. Shrinking a thousand-pixel labeled image to phone width is not sufficient adaptation.
- When horizontal relationships must remain, allow discoverable independent figure scrolling without page overflow.
- Provide originals or zoom. Dialogs support Escape, keyboard focus, and return to the trigger; no-JS still exposes images/original links.
- Inspect actual glyph bounds, arrows, overlap, and clipping. HTTP 200 alone is not a visual check.

## Static build and verification

Use [interactive visuals](interactive-visuals.md) for all HTML tables, SVG animations, and charts. Static SVG and complete semantic tables remain no-JS, print, and failure fallbacks.

Markdown and figure data/generators are sources; HTML is derived. Reuse local fonts, licenses, and icons. Use deployable scripts/styles under the real CSP and verify relative asset paths at the article route. No-JS must preserve prose, tables, images, and links.

Test both embedded SVG and opening the original. An SVG can work as an image while failing as a standalone document under CSP. Presentation attributes avoid reliance on blocked inline styles; do not weaken site-wide CSP to fix a figure.

Inspect wide and 320/390px browser views: heading wrapping, left contents/mobile disclosure, metadata/actions, table scrolling, figure sizing/zoom, anchor navigation, keyboard focus, fonts, console errors, reduced motion, and printing. Inspect screenshots rather than relying on structural checks alone. Store revision/viewport/state evidence under `output/playwright/`, outside published assets.
