# SVG animation, interactive tables, and analysis charts

These are delivery requirements and recommendations, not claims that every current renderer supports them. Updating this skill alone does not implement a website feature.

## Professional, minimal interaction

Keep prose as the reading path. Each component answers a question and starts with a meaningful result. Use interaction to compare, explain a mechanism, or inspect evidence; never hide the core conclusion behind controls.

Place components beside the argument they support and explain the resulting judgment. Prefer actual logs, regression counterexamples, and reproducible inputs. Distinguish frozen history, current measurements, and constructed controls. Provide sources, denominators, units, versions, and missing-value rules nearby. Keep static SVG and captions in Markdown. Labeled sample data can demonstrate a style, but a sample gallery at the end is not integration into an article. Do not invent performance curves.

Use JQ typography, space, fine rules, theme tokens, and Lucide. Gold highlights selected states or key relationships while retaining necessary category distinctions. Avoid gradients, glass, 3D charts, persistent flashing, decorative motion, nested cards, scroll hijacking, and dashboard-sized controls.

Chart and animated-diagram titles, axes, legends, nodes, tooltips, and internal controls use English. External descriptions follow the article language. Prose tables keep the article language and must not become a second translated data source merely to satisfy figure-language rules.

**Reading first, controls on demand:** apply this to every table, line/bar chart, and SVG flow. Default to a title, essential legend/state, and a few icons. Table settings reveal search, column filters, and visibility; selection checkboxes appear only in comparison mode. Chart settings reveal metric, denominator, input, and series choices while the active scope remains visible outside. Flow controls use previous/next, play/pause, and reset icons with a current-step label.

Use original SVG icons from a consistent source, approximately 18px visually with targets at least 44px. Provide accurate accessible names, hover titles, focus, and appropriate pressed/expanded state. Escape closes panels and restores trigger focus. Minimal presentation must preserve evidence and required functionality.

## Enhance every published HTML table

Include responsibility matrices, comparisons, metric tables, and reference-project tables. Markdown retains the full semantic source. An overflow wrapper alone is insufficient.

Required capabilities are **per-column filtering, column visibility, and selected-row comparison**; whole-table search is supplemental. Identify filter scope with column names. Use contains matching for text and real types for numeric/date ranges. Keep at least one column visible. Clear or explicitly expose filters from hidden columns so invisible conditions do not silently remove rows.

Build comparisons from original selected cells, preserving links, units, and missing values. A transposed view can place selected items in columns and attributes in rows. Enable comparison after two selections and show the count. State whether comparison uses all selected items or only visible matches. The current example uses all selected items, temporarily disables filtering, and restores conditions afterward. Reset restores all rows/columns and author order. No-JS and print preserve complete source tables.

- Every table has an expand/full-width view and a return action, with clear titles, headers, sources, keyboard access, visible focus, and focus restoration.
- Add sorting, copy/download, or detailed views when useful; controls must actually work and report failures. Numeric/date sorting uses types rather than strings.
- Preserve author order by default, especially steps, priorities, and dependencies. Do not turn null into zero. Show filtered and total counts so partial results do not imply totals.
- Use sticky headers/columns or independent scrolling as needed. Keep field correspondence, links, notes, units, and sources intact on mobile and in expanded views.
- All views and exports use the same data. State whether exports include filtered or complete rows. Do not paginate or virtualize a small table unnecessarily.

Inventory every article table during verification; do not omit prose comparisons or reference-project tables.

## SVG animation and mechanism diagrams

Recommend SVG animation when order, data flow, state changes, or recovery is the point. Keep static diagrams when they explain the relationship adequately.

Derive the static overview, step highlights, and playback from one SVG/data source. Provide previous/next/reset, with play/pause where useful; label the current step. Local node/edge emphasis and restrained opacity changes must represent actual semantics, not invented traffic, real-time activity, or causality. Label simulation and historical replay.

Start static. Continuous playback requires activation; pause offscreen or in background and clear state on resets/scenario changes. Respect `prefers-reduced-motion` with full structure or instant stepping. Print, offline use, and script failure retain static SVG and captions.

Use controlled inline SVG for page-level node manipulation, with unique instance IDs for nodes, markers, clip paths, and accessibility labels. An SVG in `<img>` is a static fallback, not a directly manipulable page DOM. Inspect external SVG before reuse; do not loosen site-wide CSP for animation.

## Charts and small analysis interfaces

Determine the question, data revision, metric, unit, denominator, period, missing-value semantics, and uncertainty before choosing controls.

- Trends: optional period/series selection, values, and sample counts; retain baseline/reset and visible selected ranges.
- Comparisons: keep axes, units, and statistical definitions comparable; expose changed conditions. Hiding an unfavorable series must not preserve an unsupported overall-superiority claim.
- Distributions/associations: use category filters, brushing, or zoom when justified; disclose projection, sampling, aggregation, and correlation limits.
- Parameter mechanisms: adjust a small number of meaningful variables; show assumptions/results, constrain valid input, and provide reset. Computed examples are not measurements.

Prefer SVG for ordinary analysis; use Canvas/WebGL for demonstrated scale needs, with text summaries, data views, and static exports. Values must be accessible through focus/click as well as hover. Keep original data unchanged and current filters, units, sources, and scope visible.

Preserve title, figure number, concise conclusion, and provenance beside charts. Provide data or static export when useful. For sharing or publication, export stable SVG/PNG/PDF rather than only a running page.

## Implementation and verification

Use static-deployable HTML/SVG, scoped CSS, and minimal JavaScript, reusing repository components/dependencies. A slider does not justify introducing an application framework. Keep state local, bind listeners once, and support article-subdirectory paths. Third-party examples are reference links, not substitutes for maintainable local components.

Build only public content. Load heavy modules on demand with reserved space. Reading must not wait for chart initialization. Version resources and verify cache changes. Check scripts, data, figures, CSP, and direct article URLs on Vercel Preview when authorized. Follow [publishing](vercel-publishing.md).

Verify:

1. All tables: expand/return, applicable filtering/sorting, empty states, reset, selection/comparison, and any copy/download behavior.
2. Animation: pause, stepping, reset, offscreen/background behavior, and reduced motion.
3. Charts: changed values, units, denominators, conditions, and totals agree with source data.
4. Desktop and 320/390px: touch and keyboard work; panels remain in bounds; no non-English authored figure labels, clipped text, or page overflow.
5. No-JS, resource failure, print, and static exports retain core conclusions, complete tables, and captions; a filtered screenshot is not the full static source.

Report implemented and actually checked behavior separately from plans, prototypes, and screenshots.

## Official examples and local choices

The following official articles were consulted on 2026-10-18. Borrow the relationship between argument and interaction, not branding; do not assume every figure uses SVG. Interactive tables throughout the article are the user's requirement, not a universal rule of these sites.

- Anthropic, [Tracing the thoughts of a large language model](https://www.anthropic.com/research/tracing-thoughts-language-model): mechanism figures beside concrete questions, with links to research; do not describe every static figure as interactive.
- Anthropic, [Economic Index: Tracking AI's role in the US and global economy](https://www.anthropic.com/research/economic-index-geography): prose findings plus an explorable data site and open data.
- OpenAI, [Introducing text and code embeddings](https://openai.com/index/introducing-text-and-code-embeddings/): DBpedia visualization with sampling/PCA explanation. The earlier retrieval/browser inspection did not establish working embedded interaction; retain that limit and local static fallbacks.
- OpenAI, [New ways to learn math and science in ChatGPT](https://openai.com/index/new-ways-to-learn-math-and-science-in-chatgpt/): variable-to-figure feedback. A product capability description is not evidence that each article example was interactively verified.
- Claude / Anthropic, [Claude now creates interactive charts, diagrams and visualizations](https://claude.com/resources/articles/claude-builds-visuals): local exploration alongside explanation. Published blogs still require maintainable assets, stable URLs, and provenance beyond a temporary conversational artifact.

The local interpretation is a single reading column, local interaction, few controls, JQ tokens, English figure labels, traceable data, and durable static fallbacks.
