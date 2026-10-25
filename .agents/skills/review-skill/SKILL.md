---
name: review-skill
description: Review PRs and their integration with current main, with reproducible findings, simple change boundaries, final-revision evidence, and convergent team feedback. Use for code review or merge-readiness assessment, not implementation or publication.
---

# Review Skill

Make changes easier to understand, verify, and maintain together. Read applicable AGENTS.md, relevant module docs, and [pr-skill](../pr-skill/SKILL.md). Reuse its delivery rules rather than creating another approval or documentation system. Read [methods and tradeoffs](references/methods.md) when explaining or adapting the review process.

## Establish the Review Target

- Record remote base SHA, each PR head SHA, target branch, and observation time. Distinguish local main, remote main, PR branches, and uncommitted changes. If fetching fails, use the remote API where possible and disclose limits; do not present an old ref as current.
- Preserve existing work; use an isolated worktree when needed. Review produces findings and local reproductions. It does not itself authorize fixes, public comments, merging, or branch cleanup.
- State the objective, consequential assumptions, and risks briefly. Review against the issue's behavior and non-goals. A missing issue does not prevent review, but report the gap; a review request does not authorize creating an issue.

## Inspect Scope, Then Verify Behavior

1. **Question the overall change.** Read the full diff, then trace affected inputs, state ownership, persistence, and consumers. Judge scope by behavior: necessary integration can cross directories; independent UI, storage, or public-interface changes need separate scope.
2. **Keep it simple.** Look for duplicated sources of truth, abstractions for one caller, unnecessary configuration or dependencies, and leftover callers of removed features. Explain the concrete maintenance cost; do not request architectural changes or broad cleanup based on taste alone.
3. **Separate three checks.** Use `git merge-tree --write-tree --name-only BASE HEAD` for textual conflicts: exit 0 is clean, 1 means conflicts, other codes mean execution failure. For interacting PRs, inspect shared interfaces and candidate combinations. Then verify final-head CI and required manual acceptance. A clean merge is not correctness, and the presence of checks is not a pass.
4. **Use relevant counterexamples.** Select cancellation, late results, duplicate operations, damaged files, stale edits, recovery, or upgrade cases according to the change. Check reuse of existing storage and lifecycle contracts. Tests should distinguish the failure from intended behavior; do not add tests merely to count them for prose or mechanical changes.
5. **Bind evidence to the revision.** Record commands, environment, results, and SHA. Reproduce with isolated data rather than paid services by default. Follow pr-skill for release gates and UI/installer acceptance. Read-only reviews may reuse verified final-commit CI, stating which checks were run locally. Label candidate combinations, old captures, and author reports separately.

## CI and Integration Evidence

- Record required checks as `workflow/job · event · head/base/tested SHA · environment · status · run link`. Separate success, failure, pending, cancelled, skipped, and missing. Inspect triggers and logs; absent runs and passing PR policy do not prove product behavior.
- Distinguish product regressions, baseline failures, check/infrastructure failures, and unknown causes. Similar errors do not prove a shared cause; a timeout is not automatically a flake. Explain reruns and preserve the original failure.
- Distinguish PR-head, merge-candidate, and post-merge main runs. Apply checks appropriate to the change; report missing evidence without weakening the gate. Actual repository settings enforce merge rules, not skill prose.
- For multiple PRs, establish dependencies and order. After a merge, verify main and refresh the next PR's base. Retain branches and worktrees while dependencies remain; cleanup follows pr-skill. Track post-merge failures separately.

## Report Actionable Findings

Each finding includes `[Priority] Short title → trigger → impact → current-head file/line → reproduction or evidence → smallest sufficient fix`. Explain the repair objective without prescribing an entire implementation.

- P0: widespread severe failure that immediately blocks delivery. P1: high-impact failure under normal use. P2: correctness issue under concrete conditions. P3/Nit: non-blocking maintenance advice. Judge consequences and exposure, not line count or tone.
- Separate defects, integration/verification blockers, pre-existing issues, and unverified suspicions. Check baseline behavior and design intent; intentional feature removal is not automatically a regression.
- Omit purely stylistic comments by default. Group worthwhile non-blocking advice. If no defect is confirmed, say so within the reviewed scope and state verification limits; do not manufacture findings.
- Follow [AGENTS writing conventions](../../../AGENTS.md#writing-style): finding and impact first, then evidence and minimal fix. English preference and description length are guidance, not independent merge blockers.

## Collaboration and Convergence

- Assign a clear repair owner for each behavior. Coordinate shared interfaces; avoid simultaneous edits to the same source of truth. Later PRs verify against the updated main.
- Discuss code and observable consequences, not author ability or motives. Authors may fix or explain why the contract or counterexample does not apply. Resolve disagreement with evidence rather than votes.
- Consolidate related findings in the first pass. Re-review the new diff, affected paths, and prior findings without repeatedly expanding scope absent new evidence. Persistent disagreement calls for a smaller PR or maintainer decision, not automatic approval after a round limit.
- Do not start multiple agents by default. When parallel review is authorized, divide by risk area and use one coordinator to deduplicate and verify findings. AI conclusions are not human approvals.
- Turn recurring confirmed defects into focused regression tests or existing static checks. Keep only stable reusable constraints in skills or module docs; do not append every incident to AGENTS.md.

## Delivery

Lead with findings, then a concise PR summary: head, conflicts against main, final-revision checks, conclusion, and next step. For multiple PRs, include dependency order. Distinguish textual mergeability, verified behavior, and missing delivery evidence.

List unrun checks. Refresh affected evidence when head or base changes; retain the SHA for historical conclusions. Completing review does not complete repair, approval, or merging.
