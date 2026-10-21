# Accepted HTML reading template

Use this reference when rendering a blog with the user's approved JQ reading layout. The user accepted the v13 layout on 2026-10-19 and then requested softer body text in v14; this snapshot includes that refinement. This is a concrete visual and interaction reference, not a requirement to reuse its article, data, section counts, or exercise.

- [HTML reference](html-template/index.html): a frozen, generated copy of the accepted page with its local assets.
- [Live article](https://oh-my-quant.vercel.app/blog/vibe-repo-ops/): the published reading page; the local snapshot retains review metadata.
- [Canonical renderer](../../../../site/previews/vibe-repo-ops/build.ts) and [implementation notes](../../../../site/previews/vibe-repo-ops/README.md): edit these sources when changing the implementation.
- [Deployment provenance](../../../../site/DEPLOYMENT.md): source/design revisions, hashes, deployment IDs, and verification scope.

The HTML is an article example in Chinese with English figure labels. Skill instructions remain in English. Its historical repository claims and sample data are not current operational status. The snapshot's HTML SHA-256 is `61f4499cddc0ce466a26379693ac09f07ea1b11def12e2c273e49b097e89d522`.

## Preview locally

From the repository root:

```sh
python -m http.server 4188 --bind 127.0.0.1 --directory .agents/skills/blog-skill/references/html-template
```

Open `http://127.0.0.1:4188/`. Use HTTP for the interactive preview; opening the HTML directly from the filesystem can block module scripts and sharing. The reference bundle includes local CSS, JavaScript, SVGs, fonts, licenses, and the body demonstration video. It contains no credentials, deployment linkage, or browser verification captures. This simple preview server does not reproduce deployment security headers; use the canonical build for CSP validation.

## Preserve the approved form

- Warm black with soft warm-gray body text (#B8B4A8), cream (#FFF3C4) for headings and selective emphasis, including key sentences within paragraphs marked with `**...**` / `<strong>`, and restrained gold; Geist fonts and genuine Lucide icons.
- Left contents aligned with the body, progressive reveal, active subsection expansion, and compact mobile contents.
- Reading time, share, and print/save-PDF actions near the title; no Markdown download.
- TL;DR first; article-owned optional exercise after the argument; one final References heading with a continuous numbered list. No reference subheadings or repeated figure-source explanations.
- Titled English SVG figures with external captions; minimal table/chart controls that reveal options on demand.
- Reference videos as links; compact covers and summaries for body videos, playback on activation.
- Readable no-JS and print output, keyboard operation, and reduced-motion support.

Detailed behavior remains in [visual rendering](visual-rendering.md), [interactive visuals](interactive-visuals.md), [embedded media](embedded-media.md), and [content checks](content-checks.md).

## Reuse and refresh

Use the renderer's layout and components for a new article. Replace article-specific title, metadata, language, links, manuscript, figures, and evidence. Adapt its fixed section, figure, table, and bibliography assumptions instead of padding a new article to match this example. Do not copy the Repo Ops exercise, historical metrics, or recommendations into unrelated articles.

This folder is a frozen generated reference, not a second editorial source. Do not hand-edit its HTML, styles, or scripts. For an approved template revision, edit the canonical renderer/manuscript, rebuild into a fresh directory, verify desktop/mobile and relevant interactions, then replace the reference with only `index.html`, `assets/`, and `images/`. Update the revision, hash, and preview link here. Preserve required asset licenses; exclude `.vercel`, `.env`, logs, screenshots, and deployment configuration. Publication continues to follow the separately authorized deployment stage.
