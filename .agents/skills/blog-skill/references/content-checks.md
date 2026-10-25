# Article editing

## Argument and length

Follow [blog-skill](../SKILL.md) for Docs versus Blog scope and reading length. Docs explain intent and motivation primarily through text; Blogs may use illustrations to explain their argument. One page answers one reader question in about 5–10 minutes. Preserve alternatives, decisions, evidence, and limits where they affect understanding; no fixed section count or mandatory implementation index.

Keep only facts and examples needed to understand the decision. Verify factual claims while editing and distinguish observation from interpretation. Identify proposed behavior and uncertain results where they matter. Do not copy run logs, test inventories, commit histories, or a verification matrix into the article. An example must be understandable without access to private outputs.

## TL;DR and References

For Blogs, open with a short `TL;DR`: problem, conclusion, and any essential limitation. Docs use headings suited to their design question and do not require a TL;DR. Optional blog exercises belong after the argument and before `References`, never in the shared HTML footer.

Blogs end with one continuously numbered `References` list, without topic subheadings or a separate figure-source explanation. Docs may use the same compact format when references help. Cite useful original sources near the relevant claim; keep figure attribution alongside the figure. Do not invent a bibliography for an entirely repository-derived article.

Use compact academic-style entries: author or organization, linked title, venue/publisher, and known year or date. Omit unknown metadata. For a version-specific code claim, link the relevant revision; ordinary design explanations need no commit ledger. Mark further reading within its entry. Add an annotation only when it helps readers choose what to read.

Follow the plain linked entries of [Lil'Log References](https://lilianweng.github.io/posts/2023-06-23-agent/#references), with hanging indentation, restrained spacing, and print-safe wrapping. Reference videos are linked titles, including YouTube and Bilibili; body previews follow [embedded media](embedded-media.md).

## Consolidation

Read overlapping articles and choose one central argument. Merge repeated explanations, retain important constraints and genuinely different tradeoffs, and remove superseded detail. Similar titles alone do not justify merging. Keep current design docs separate from historical reflections.

Deliver a coherent draft rather than concatenating originals. Follow existing authorization and any requested review-before-deletion order. During cleanup, update links, anchors, routes, translations, and navigation; remove only superseded, unreferenced assets. Handle published URL redirects where needed. No permanent migration ledger is required.

## Translation and checks

Maintain one primary manuscript and derive the other language view from the same revision. Preserve terminology, identifiers, numbers, links, and figure numbering. Reuse English diagrams and localize external captions. A small translation manifest suffices; use `site/content/messages.json` for short UI labels.

Do not present an unfinished translation as current. Check language metadata, canonical URLs, and real alternate routes. Preserve publication dates and stable slugs; record revisions separately.

Before delivery, read for clarity and duplication, then check links, figures, generated fidelity, and the requested interactions. Use `bun run docs:build` and `bun run check:docs` for the offline collection; use the article renderer for independent previews. Deferred navigation may leave a known coverage failure: report it honestly instead of claiming the whole gate passed.
