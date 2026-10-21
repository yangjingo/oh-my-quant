# Content, structure, and bilingual checks

## From a problem to a judgment

Identify one question, then organize observations, conflicts, choices, mechanisms, results, costs, and unresolved issues. Use concrete headings. Preserve established series conventions without forcing a fixed number of sections or figures onto every article.

For each major claim, check:

- Fact: which source revision, log, input, or actual run supports it?
- Interpretation: what did the source author say, and which synthesis should be labeled as WhyJ analysis in the article's language?
- State: distinguish proposed, implemented, candidate-verified, merged, and published.
- Boundary: what does the evidence exclude, and what remains unknown?

Retain original failing inputs and actual outputs. Offline reassessment is not a new model run. Test counts are not overall correctness rates; source links are not execution receipts. Explain counterexamples without requiring private session access. Removing duplicate specifications must not erase unique authorization, privacy, recovery, or data-definition constraints.

## TL;DR and References

Begin each article with a short `TL;DR` covering the problem, principal conclusion, and essential limits. Help readers decide whether to continue; do not merely repeat section titles or turn historical verification into a claim that everything currently passes. Update it after substantive edits or consolidation.

Optional exercises or reflection prompts belong immediately after the main argument and before References. Keep them in the article manuscript, not in the shared HTML footer or renderer. A reusable HTML example demonstrates placement and styling; it must not inject a particular article's exercise into every blog. Do not require an exercise when the article does not benefit from one.

End with `References`, using that spelling. Use one continuous numbered list without topic subheadings or a separate figure-source explanation. Keep figure attribution alongside the figures and claim-level links near the relevant prose. Identify further reading in its entry rather than adding another heading. If the material is entirely repository-derived, identify the actual internal evidence instead of inventing a bibliography.

Video references are linked titles or compact citations, including YouTube and Bilibili. They do not become large poster cards or players merely because a URL is present. Body video previews follow [embedded media](embedded-media.md).

Use a consistent academic-style bibliography: author or responsible organization, linked original title, venue/publisher, and verified publication date or year. For source code, include an immutable commit link and a visible revision. Do not invent authors, dates, conference editions, DOIs, or claim a particular formal citation standard unless its requirements are met. Use one numbered entry per work; a talk and its transcript may share an entry. Keep numbering continuous in a single list. Separate editorial recommendations and evidence limits into a short secondary paragraph; do not mix them into the bibliographic identity. Preserve claim-level source links in the body and identify further reading as such.

Follow the restrained public layout of [Lil'Log References](https://lilianweng.github.io/posts/2023-06-23-agent/#references): plain numbered entries and directly linked titles. Our hanging indentation and quieter annotation paragraph adapt that structure to the selected theme; they are not claims about Lil'Log's implementation or private workflow. Keep source content in Markdown. HTML adds semantic ordered lists, stable anchors, compact spacing, and print-safe wrapping, without cards, video posters, or unnecessary citation controls.

## Identify, consolidate, and clean up duplicate topics

Default scope is blog-related material under `docs/` and its derived assets. A module specification can cover the same topic while remaining the current contract; topical overlap alone is not grounds for deletion.

1. **Inventory.** Read candidate bodies, citations, and revisions. Group by question, conclusion, evidence, applicable period, and audience. Similar titles or keywords only identify candidates.
2. **Choose treatment.** Merge repeated arguments; retain and cross-link distinct mechanisms; mark superseded designs as historical. Resolve conflicting versions against evidence rather than combining incompatible designs into a current plan. Explain specific reasons for keeping, merging, archiving, or removing.
3. **Rebuild the argument.** Organize observed failures, inadequate assumptions, decisions/mechanisms, and results/boundaries. Avoid concatenation and repeated introductions. Temporarily map original sections, unique claims, and figures to their new locations or omission reasons. Preserve counterexamples, tradeoffs, historical states, and citations without creating a permanent duplicate ledger.
4. **Deliver the merged draft.** Provide a readable preview and identify covered originals and independently retained material. If the user requires review before deletion and navigation last, preserve original manuscripts and assets until that condition is met. Existing authorization for complete cleanup does not require another permission request.
5. **Perform authorized cleanup.** Search old paths, slugs, anchors, and asset names across Markdown, build lists, collection HTML, language pages, and routes. Update references/configuration and rebuild. Delete only superseded, unreferenced assets. Redirect published URLs appropriately and check old section deep links. Historical copies must clearly point to the current article.
6. **Close out.** After content approval, update docs and website navigation to one current entry. Rebuild affected collections, pages, and translations; check links, anchors, images, and destinations. Report merged, retained, and removed files and unfinished work. A new draft alone is not completed cleanup.

## Document checks

| Check | Acceptance |
| --- | --- |
| Title and hierarchy | One H1; hierarchy follows the argument; unique, reachable section IDs |
| Summary and references | TL;DR matches the body; References is one numbered list without subheadings or figure-source explanations |
| Facts and status | Dates, SHAs, PRs, and run IDs support claims; history is not presented as current |
| Links | Local paths/anchors exist; public prose does not depend on machine paths, expiring signed URLs, or private logs |
| Assets | Prefer SVG; images decode and have visible titles, numbers, alt text, and captions; citations remain traceable |
| Navigation | Register approved content in docs/site navigation; avoid two apparently current versions |
| Generated fidelity | HTML preserves Markdown prose, code, tables, and citations; UI labels remain separate |
| Interaction and media | All HTML tables have required controls; chart scope and fallbacks agree; reference videos remain links and body previews have covers and summaries |

Existing collection commands, from the repository root:

```sh
bun run docs/blog/build.ts
bun run docs/blog/check.ts
```

Confirm whether updating the collection is in scope. Use the article renderer for an independent draft. Full-directory checks scan new Markdown and figures; if navigation is deferred, report those known omissions while fixing unrelated broken links and structural errors.

## One manuscript, two language views

Use `site/content/messages.json` for short UI strings. Maintain article prose as complete Markdown; associate each translation with its primary source and translate changed passages with surrounding context. Reuse repository terminology. Preserve code, identifiers, numbers, formulas, links, figure numbers, and evidence status.

Track at least source path/hash, source language, target language, translation status, and human revision status. A small manifest is enough; do not introduce a CMS for one article. A written design is not an implemented translation pipeline or stale-translation detector.

Keep translations tied to the same source revision. If one is unfinished, retain the previous published revision or clearly mark it unavailable. Do not silently redirect to a different article or label Chinese prose as an English page. Reuse the page template and English figures; localize external figure titles, alt text, and captions without duplicating diagram generators.

Verify `lang`, title, description, canonical, and `hreflang` against real language pages. Do not invent English alternates. Preserve stable slugs and initial publication dates, track revision dates separately, and implement explicit redirects when URLs change.
