# Repository Guidelines

## 1. Principles

### Think Before Coding

State your interpretation and consequential assumptions before editing. Explain meaningful tradeoffs. Ask when guessing creates real risk; otherwise state the assumption and proceed.

### Keep It Simple

Implement the smallest solution that satisfies the request. Avoid unrequested features, premature configuration, abstractions for one caller, and unnecessary dependencies. Prefer direct implementations.

### Make Surgical Changes

Follow local style and change only necessary files. Avoid unrelated formatting, renaming, and reorganization. Remove code made unused by your changes; report unrelated problems separately. Preserve others' uncommitted work.

### Define the Goal and Verify It

Identify the failing case for bugs, observable behavior for features, preserved behavior for refactors, and concrete risks for reviews. Use focused checks during development and complete the release gate before delivery. Report unrun checks and limitations; never present assumptions or historical results as current evidence.

For substantial work, briefly communicate **Assumption**, **Changed**, **Verified**, and **Remaining risk**. Challenge unnecessary scope or inadequate verification and propose a smaller sufficient approach.

## 2. Repository Writing Conventions

### Issues, Pull Requests, and Documentation

- Keep one implementation issue, one primary functional module, and one implementation PR together. Define allowed paths, non-goals, and checkable acceptance criteria.
- Update the relevant current `docs/` pages. README, CHANGELOG, and PR descriptions do not replace module documentation.
- Provide actual screenshots for visible UI changes, with environment and reproduction details. Use recordings for interactions; label mockups separately.
- Tie verification evidence to acceptance criteria and the final revision. Distinguish proposed, implemented, verified, and unverified behavior.
- Final review includes checks triggered by the final PR description, not only the final code SHA. Keep lifecycle-specific verification steps in `pr-skill`.
- For major changes, consider a focused `docs/blog/` article explaining alternatives, decisions, evidence, and limits.

### Writing Style

- Prefer English for Issue/PR titles and descriptions; use another language when the task or audience calls for it. Preserve code identifiers, commands, and quoted errors in their original form. Existing documents keep their established language.
- Aim for no more than 1,000 words per Issue or PR description, counted as English words. This is guidance, not a target, hard limit, or CI gate. Keep necessary evidence and link longer logs or background; do not omit essential reasoning to meet the recommendation.
- Lead with the concrete problem or outcome, then explain the mechanism, reason, and evidence. Use short paragraphs with one main point, precise terms, and observable behavior. Avoid unsupported claims, repeated summaries, and a chronological work diary.
- Use the existing templates and meaningful headings. Remove placeholder instructions, explain inapplicable sections briefly, and avoid deep nesting or decorative formatting. Use tables for comparisons, code fences for commands or short logs, and descriptive links for supporting evidence.

### Skill Index

| Skill | Instructions | Use when |
| --- | --- | --- |
| `issue-skill` | [SKILL.md](.agents/skills/issue-skill/SKILL.md) | Defining issues, scope, and acceptance criteria. |
| `pr-skill` | [SKILL.md](.agents/skills/pr-skill/SKILL.md) | Implementing issues and preparing or reviewing PRs. |
| `review-skill` | [SKILL.md](.agents/skills/review-skill/SKILL.md) | Reviewing correctness, simplicity, integration conflicts, and evidence with convergent feedback. |
| `blog-skill` | [SKILL.md](.agents/skills/blog-skill/SKILL.md) | Consolidating and reviewing blogs, rendering SVG figures, interactive tables and charts, maintaining bilingual pages, and publishing authorized Vercel updates. |

Read applicable skills first; use issue-skill and pr-skill for issue-to-PR work, and review-skill for review. Reuse an existing compliant issue. Drafting and review requests do not authorize publication or implementation.

Maintain finalized procedures in `.agents/skills/<name>/SKILL.md` and their index here. Avoid duplicated rules and active draft skills. Current automation and setup requirements live in [CI and npm Releases](docs/quant-harness/ci-release.md); these instructions alone do not enforce GitHub merge rules.
