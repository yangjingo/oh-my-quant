---
name: blog-skill
description: Edit, simplify, consolidate, preview, and publish oh-my-quant docs and blogs. Use for text-first design documentation, illustrated articles, bilingual content, and their website update workflows.
---

# Blog Skill

Write for people who want to understand a decision. Apply AGENTS' Keep It Simple and Make Surgical Changes principles to prose without changing AGENTS itself. Keep skill instructions in English and prose in the reader's language.

## Choose Docs or Blog

**Docs** explain the problem, solution structure, and interface boundaries, primarily through text. Explain what each layer receives and delivers, who owns decisions and state, and why responsibilities are divided that way. Make the difficult assumption or failure mode visible, compare meaningful alternatives, and explain the chosen tradeoff. Keep essential evidence and limits. Design prose should not become a command manual, parameter table, file inventory, implementation recipe, or progress log. Retain only short examples and links that clarify a decision; leave detailed schemas and procedures in their existing implementation or operational references. Configuration and operational guides retain the minimal steps readers need. Do not generate illustrations or apply the blog page template by default; add a small diagram only when explicitly requested or necessary to explain a difficult relationship.

**Blogs** explain a concrete problem through alternatives, decisions, evidence, and limits. Add illustrations where they clarify the argument, following the visual references below. Diagrams are not a quota, and a topic does not need a blog merely because its Docs changed.

For both, target a 5–10 minute read, including figures. For a substantial Chinese design document, use roughly 2,000–3,000 prose characters as an editorial guide, allowing fewer for a simple topic and more when the reasoning needs it. English prose usually fits within 1,500 words. These are estimates, not quotas or new CI gates; existing scoped character caps remain ceilings. Do not pad short explanations or remove essential reasoning to hit a count. Cut repetition before splitting into distinct reader questions. Keep one current owner for a topic, using [docs/README.md](../../../docs/README.md#design) for placement. Do not create a new history ledger or hide excess detail in an appendix.

Read and verify the relevant design before editing. Preserve important constraints and distinguish intended behavior from what exists. Evidence supports the reasoning; it need not become a per-sentence traceability exercise.

Add a few primary references where they support a design choice or clarify its limits. Cite them near the relevant argument and use a compact References section when useful. Distinguish external guidance from this repository's decision and actual implementation. Do not turn design documentation into a literature survey or imply that citing a standard establishes compliance.

## Write the argument

Never prefix prose with author-branded analysis labels, including "WhyJ analysis" or its Chinese equivalent. Integrate interpretation naturally into the argument while keeping source attribution clear.

Start with the concrete problem, explain why it matters and what choice followed, then discuss the result and cost. Use only examples and implementation details that make the reasoning clearer. Avoid PR chronology, exhaustive code indexes, verification ledgers, and repeated caveats. Distinguish a proposal from shipped behavior without narrating every delivery stage.

Blogs begin with `TL;DR` and end with `References`; retain useful citations, not a source link for every sentence. Docs use headings appropriate to the reader's question, without a mandatory article outline. Follow [content checks](references/content-checks.md) for citations, consolidation, and translation.

Maintain one primary manuscript. Derive translations and HTML from it; edit sources and rebuild rather than maintaining independent copies. Merge duplicate articles around one argument, preserving important tradeoffs. Respect the user's agreed order for draft review, deleting originals, and updating navigation.

## Blog illustrations and presentation

Use [DESIGN.md](../../../DESIGN.md) and the [accepted HTML template](references/html-template.md). Read only the references needed for the current stage:

| Work | Reference |
| --- | --- |
| Figures, icons, reading layout | [Visual rendering](references/visual-rendering.md) |
| SVG animation, tables, charts | [Interactive visuals](references/interactive-visuals.md) |
| YouTube, Bilibili, other video | [Embedded media](references/embedded-media.md) |
| Preview, publication, rollback | [Vercel publishing](references/vercel-publishing.md) |

Prefer SVG; use English inside figures and give each a visible title and caption. Keep JQ styling professional and minimal. Published HTML tables support column filtering, hiding, and row comparison through compact icons. Preserve accessible, static/print fallbacks. Reference videos are links; body videos use compact covers and summaries with playback on demand.

Keep desktop contents on the left, aligned with the body, with restrained progressive reveal. Show estimated reading time and Lucide share and print/save-PDF controls near the title. Preview these behaviors in a browser; detailed requirements remain in the references.

## Update, preview, and publish Docs or Blogs

Edit the source manuscript first. After consolidation, update affected links, anchors, navigation, and translations; respect any agreed review-before-deletion sequence. Rebuild derived content rather than editing generated pages independently.

For website updates, first locate the actual content source, route, and build in [site/README.md](../../../site/README.md). A repository Docs edit does not automatically create a website page. Use an existing Docs layout for Docs and the accepted article template for Blogs. If no Docs publishing route exists, report that gap rather than silently publishing the document as a blog. Check the affected page in a local preview, then follow the authorized deployment stage and verify its URL.

Local editing does not authorize deployment. Use existing authorization for Preview or Production without asking twice; prepare the reviewable candidate before requesting any missing approval.

For the existing offline collection, run `bun run docs:build` and `bun run check:docs`. Independent website articles use the renderer and build described in [website publishing](../../../docs/blog/website-publishing.md); the collection builder is not a universal renderer.

Report changed files, preview or deployment links, checks actually run, and material limitations briefly. Keep detailed verification receipts in the PR or delivery report; retain evidence and limits necessary to understand the document itself. Do not claim an unrun check passed. Follow [pr-skill](../pr-skill/SKILL.md) when implementing a PR.
