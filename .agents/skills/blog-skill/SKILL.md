---
name: blog-skill
description: Draft, consolidate, review, and render oh-my-quant blogs with SVG figures, animations, interactive tables and analysis charts; clean up superseded posts, maintain bilingual content, and perform authorized Vercel updates. Use for blog/document-to-website workflows, not general module specification edits.
---

# Blog Skill

Turn a maintainable article with clear evidence boundaries into verifiable website content that follows the selected product design and supports Chinese and English readers. Skill instructions are maintained in English; article language follows the user's request.

## Choose the delivery stage

- Writing or review: read the article, relevant current design, and [editorial notes](../../../docs/blog/editorial-notes.md); use [content checks](references/content-checks.md).
- Duplicate topics: use the consolidation procedure in content checks. Identify overlap and unique evidence, produce a coherent draft, then handle originals, assets, links, and navigation in the authorized order.
- Figures or HTML: start with the [accepted HTML template](references/html-template.md), verify the selected design revision, and read [visual rendering](references/visual-rendering.md). Deliver and inspect an actual browser preview.
- SVG animation, tables, or charts: read [interactive visuals](references/interactive-visuals.md). Every published HTML table needs the required interactions and a static fallback.
- Video, YouTube, or Bilibili: read [embedded media](references/embedded-media.md). Reference-only videos are ordinary links. Body videos show a compact cover and content summary, with playback on demand.
- Translation: follow the primary-source and derived-translation procedure in content checks; do not maintain two independent article structures.
- Upload, update, or rollback: read [Vercel publishing](references/vercel-publishing.md), verify the target and existing authorization, then execute that stage.

A local-draft request authorizes a local draft. A request to upload a Preview authorizes that deployment; an explicit publication request authorizes the corresponding Production update. Do not ask for the same permission twice. Creating a skill, discussing deployment, or rendering local HTML does not authorize uploading. Preserve the user's sequence for deleting originals and updating navigation. Prepare the exact reviewable candidate and checks before requesting any still-needed publication approval.

## Keep one content provenance chain

1. Identify the Markdown source, selected brand/design revision, and source-code or execution evidence. Distinguish this checkout, other branches, live production, and a requested future design.
2. Current Docs define contracts; Blogs explain problems, reasoning, evidence, and tradeoffs. Consolidate by argument, preserving unique constraints, counterexamples, historical failures, and valid citations.
3. Maintain Chinese or the user-selected language as the primary manuscript. Translations, responsive figures, and HTML are derived artifacts tied to a source revision. Keep page chrome separate from article prose.
4. Use a problem-driven causal structure: observed failure, inadequate assumption, decision and mechanism, then results and costs. Do not use PR chronology as the argument or treat passing CI as overall product correctness. See the [Manus / Langfuse editorial reference](references/visual-rendering.md#manus-and-langfuse-editorial-reference).
5. Edit sources or generators, then rebuild. Do not independently edit the same content in Markdown, translations, SVG, and HTML.

## Delivery requirements

- Begin with `TL;DR` and end with `References`. Keep claims and evidence boundaries consistent; cite specific claims locally and collect sources at the end. Use compact, continuously numbered academic-style entries with verified metadata and separate editorial annotations; see content checks.
- Prefer editable SVG for technical figures, using selected JQ theme tokens. Choose suitable raster formats for photographs and actual screenshots.
- Use English inside illustrations and architecture diagrams: titles, nodes, edges, legends, annotations, and SVG accessibility text. Both article languages reuse the same figures; localize external captions and alt text.
- Give every figure a visible title, number, explanatory caption, and alt text. For reused or adapted figures, identify the original creator, source, adaptation, and applicable permission alongside the figure. Do not repeat figure-source explanations in References.
- Keep interactions professional and minimal. All tables support column filters, column visibility, and selected-row comparison. Reveal controls through a few Lucide icons rather than permanent forms. Keep chart scope and units visible. Preserve keyboard access, reduced-motion behavior, and no-JS/print fallbacks.
- Reference videos, including YouTube and Bilibili, use links only: no poster cards, empty player boxes, or embeds in References. Body videos show a compact cover, original title, source, and concise content summary; load or expand playback only on activation.
- Put desktop contents on the left, aligned with the article body rather than the hero title. Reveal it progressively on scroll and smoothly expand the active section, respecting reduced motion. Show estimated reading time and accessible Lucide share and print/save-PDF controls near the article title. Keep a compact mobile contents disclosure. Native sharing may fall back to copying the canonical public URL; draft previews share their actual preview URL. Printing opens the browser dialog and must not be described as an automatic PDF download.

A temporary HTML preview still follows these requirements. Details and acceptance checks live in the references.

## Repository entry points

- [DESIGN.md](../../../DESIGN.md), [site README](../../../site/README.md), `site/public/styles.css`, and `site/public/icons.svg`: compare the current checkout with the user-selected design.
- `docs/blog/build.ts` / `docs/blog/check.ts`: existing twelve-article offline collection and directory checks, not a universal new-article renderer.
- `site/scripts/render.mjs` / `site/scripts/build.mjs` / `site/vercel.json`: production routes, asset allowlist, Node build, and deployment configuration.
- [Long-form preview example](../../../site/previews/vibe-repo-ops/README.md): JQ reading page, Lucide, responsive SVG, captions, and zoom. Its build assumes the Repo Ops manuscript's section and figure counts; adapt those assumptions for other articles.

Do not expand editorial work into runtime upgrades, a full docs reorganization, CI policy changes, or unrelated feature deployment. Continue related work already authorized by the user.

## Report what was verified

Deliver the source/HTML or deployment link, content and design revisions, performed checks, and remaining limits. Report structural checks, browser preview, Preview Ready, and Production domain verification separately.

Retain concrete failure explanations. If navigation updates are deferred, new review drafts may remain outside the full-directory coverage check. Complete article-level checks, but do not claim the repository docs gate passed or remove checks to obtain green results.

For implementation PRs, follow [pr-skill](../pr-skill/SKILL.md) for commits and final-revision verification. Ordinary article review or local rendering does not require creating an Issue to continue.
