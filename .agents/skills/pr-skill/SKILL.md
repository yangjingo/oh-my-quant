---
name: pr-skill
description: Prepare and review single-issue PRs for oh-my-quant targeting stable iterative main, with testing, documentation, final-commit CI verification, and remote/local cleanup after authorized merges.
---

# PR Skill

## Scope

- Require one implementation issue; use [issue-skill](../issue-skill/SKILL.md) if missing. Continue an existing implementation PR when available.
- Follow the issue's primary module, allowed paths, and acceptance criteria. Split unrelated problems or independent module changes.
- Confirm the base branch and inspect the full diff. Preserve others' uncommitted work.
- Treat `main` as the stable iterative development version and the final integration target, not a scratch branch or a synonym for an npm release. Develop in issue branches; integrate only reviewed changes with the applicable final-revision checks passing. Stacked branches are temporary dependencies and ultimately integrate into `main`.
- Prefer the issue's dedicated branch and worktree for development, verification, commits, and pushes. Record their association with the issue and PR; reuse that worktree for revisions rather than mixing implementation changes into the primary checkout.

## Before Commit and Push

1. Verify every acceptance criterion, including relevant error cases and compatibility. Bug regressions must expose the original failure.
2. Read current `package.json` scripts and workflows. Run `bun run check:release`; confirm coverage of type checking, architecture, test organization, the full test suite, and build. Run documentation checks separately if not included.
3. Add applicable module and end-to-end checks. Desktop changes require desktop typecheck/build; installer changes require actual package verification of paths, shortcuts, upgrade/reinstall behavior, and data retention in an isolated environment.
4. Record commands, environment, results, and evidence. Distinguish synthetic tests from live-service validation. Rerun affected checks after edits; ensure the complete gate remains valid for the final content.
5. Inspect the staged diff and run `git diff --check`. Commit only issue-related files; reject PR verification screenshots, recordings, and browser artifacts from the staged files. Report baseline failures without weakening assertions or claiming success. Push an incomplete WIP/draft only when explicitly requested.
6. Before handoff, inspect tracked and untracked changes for omitted issue work. Commit intended deliverables and explicitly report any preserved unrelated changes; a clean Git status does not prove ignored local data is disposable.

Local checks precede the final commit and push. Before opening a non-Draft PR or marking a Draft ready for review, confirm the complete release gate and applicable local checks passed for the submitted content; after further edits, rerun affected checks and keep the complete gate valid. If checks fail or cannot run, report the exact blocker and missing evidence; use an explicitly requested Draft for early collaboration. Do not weaken assertions to obtain a pass. CI follows the push and must pass before merge readiness; pending CI is not a successful result.

## Documentation

Update the relevant current `docs/` pages in every PR. Explain changed behavior, contracts, boundaries, or verification procedures; avoid cosmetic edits solely to satisfy this requirement. README, CHANGELOG, and PR text are not substitutes.

Prefer existing pages. Update navigation and generated documentation when applicable. Keep commands, links, and evidence aligned with the implementation.

## Visual Evidence

For visible Web, desktop, TUI, or HTML-report changes:

- Provide actual before/after screenshots, or captures of new interfaces. Include recordings or sequential captures for interactions.
- Record the code revision, environment, viewport, state, and reproduction steps. Cover affected normal, empty, loading, and error states; include narrow/wide layouts where relevant.
- Check affected text layout, overflow, keyboard/focus behavior, and runtime errors.
- Label mockups as design intent. Do not substitute generated or outdated images for implementation evidence.
- Keep PR verification screenshots, recordings, and browser artifacts in ignored `output/` directories or an external evidence archive. Never commit them to `docs/assets/`, another tracked asset directory, or a dedicated evidence branch just to embed them in a PR.
- Attach redacted images directly to the GitHub PR description/comment using GitHub-hosted attachments, or link accessible CI artifacts with their run and retention limits. A request to add a final screenshot to a PR authorizes an attachment, not adding an image file to the repository.
- If attachment upload is unavailable, retain the local evidence and report the limitation; do not substitute a committed image or claim that a local path is reviewer-accessible.
- Product assets and deliberately authored documentation/blog illustrations have their own content purpose. A capture made only to prove a PR was checked is review evidence, even if called a final preview or lasting screenshot.
- Link historical failure captures from their original CI artifacts, including retention/access limits. Citing review evidence in a blog does not require copying its screenshots into the repository.

For internal changes, briefly explain why visual evidence is inapplicable.

## Technical Blog: Recommended for Major Changes

For substantial features or non-obvious design decisions, consider a focused article in `docs/blog/`. Explain the problem, prior limitations, alternatives, chosen mechanism, evidence, costs, and remaining limits. Link claims to implementation or verification; distinguish facts from proposals.

Follow the [blog guide](../../../docs/blog/README.md), update navigation/generated pages as needed, and link the article from the PR. Keep it within the same issue. Blogs supplement current module documentation and a self-contained PR description; ordinary fixes do not require one.

## Description

- Follow [shared writing conventions](../../../AGENTS.md#writing-style) for language, length, and formatting. Keep the template's exact English second-level headings and canonical closing line: PR policy parses them even when the explanatory prose uses another language.
- Lead with the concrete problem and resulting behavior; explain the mechanism and why it is sufficient. A before/after example is useful when it clarifies the change. A file list or commit diary does not replace the explanation.
- Map acceptance criteria to commands or procedures, results, and the tested revision. Distinguish passed, failed, pending, and unrun checks; link logs rather than copying them into the description.
- Rewrite the title and affected sections when scope, implementation, or evidence changes. Preserve relevant historical evidence with its revision instead of appending competing "final" summaries.

## PR Template

Title: `<type>(<module>): <behavior change> (#<issue>)`

~~~markdown
Closes #<single-issue>

## Outcome
Problem, before/after behavior, and key design decisions.

## Scope and Documentation
Primary module, justified integration changes, compatibility, and docs links.

## Acceptance
| Criterion | Test or procedure | Result and evidence |
| --- | --- | --- |
| AC1 | ... | ... |

## Verification
Commands, environment, results, final commit SHA, and CI links.
Explicitly list unverified behavior and its impact.

## Visual Evidence
Screenshots or recordings with reproduction details; explain if inapplicable.

## Risks and Rollback
Concrete risks and recovery steps.

## Technical Blog (Optional)
Article link and the design question it explains; omit when unused.
~~~

## Review and Completion

Use [review-skill](../review-skill/SKILL.md) for findings, integration checks, and feedback convergence; this skill remains the source for delivery and cleanup requirements.

- Close only the primary issue; link dependencies without closing them. Add the PR link to the issue.
- Use `gh` to verify applicable workflows against the final head SHA. Trigger available non-publishing checks within existing authorization when needed.
- Finalize the PR description before the final check audit. Body edits can start a new policy run without changing the head SHA; wait for that run too. Record the PR head, tested merge candidate when applicable, and relevant run IDs. A previous green run on the same head does not settle a newer pending check.
- When checks are absent, inspect mergeability first. Resolve conflicts and synchronize the base before expecting `pull_request` checks; do not use empty commits or repeated reruns to replace conflict resolution.
- Inspect failed job logs and fix confirmed causes; repeated reruns are not a substitute. Require all applicable checks and mandatory manual acceptance before declaring merge readiness.
- Refresh descriptions and evidence after changes. Return the PR link, final SHA, results, and outstanding work.
- Treat PR creation, merging, and publishing as separate actions governed by existing authorization.

## Post-Merge Cleanup

When the user authorizes completing a PR merge into `main` or explicitly requests post-merge cleanup, include removal of the delivered remote branch, local branch, and completed worktree in that task unless the user asks to retain them. Proceed after the checks below without asking for the same permission again. A request only to review or report merge status does not authorize cleanup. Keep unmerged, still-under-review, active, or dependent worktrees; a closed-but-unmerged PR is not a merged delivery.

GitHub's automatic branch deletion concerns remote branches only; it does not remove local branches or worktrees. Check actual refs instead of assuming the setting completed cleanup. Never delete `main` or another protected integration branch. A request limited to local cleanup remains limited to local objects.

1. Verify live PR merge status, target branch, exact branch heads, and worktree association. For a stacked PR merged into a dependency branch, verify its merge revision and the dependency's delivery chain have reached `main`; merging into a temporary branch alone is not final delivery. Confirm no undelivered branch-only work remains. Squash/rebase merges require comparing the delivered changes and later commits; ancestry alone cannot establish equivalence. Check whether other open PRs still depend on the branch.
2. Inspect tracked, untracked, and ignored files, and any process using the worktree. Keep worktrees with uncommitted tracked or untracked work. Preserve unique verification receipts and private state, including `.ohquant`, outside the removable worktree; a clean Git status does not make ignored data disposable. Use an established private archive location when available, or a private local archive outside the repository, and report its location. If preservation cannot be completed safely, retain the affected worktree and explain the specific blocker. Never publish private files as cleanup evidence.
3. Recheck the remote branch head immediately before deletion; it must still match the delivered revision with no later work or open dependency. Delete that exact remote ref with an expected-head lease (for example, `git push --force-with-lease=refs/heads/<branch>:<verified-sha> origin :refs/heads/<branch>`); the lease guards a deletion, not permission to overwrite history. If it fails, refresh and retain changed work rather than retrying blindly. An already absent remote ref is complete.
4. Resolve and validate the exact worktree path. From another checkout that contains the verified `main` revision, use normal `git worktree remove`, then delete only the confirmed local branch with `git branch -d`. If safe removal is refused, retain that object and explain why; do not default to `--force`, `-D`, or recursive filesystem deletion. An already absent local object is complete.
5. Synchronize the primary checkout only when its existing work is protected; prefer a fast-forward update without reset or checkout-based discards. Cleanup can run from a separate checkout without updating a dirty primary checkout. Confirm removed paths and local/remote refs are absent, then report removed branches/worktrees, preserved evidence/data locations, and any retained changes or dependencies. Update an issue/PR follow-up only within existing publication authorization.

This skill does not configure branch protection or CI enforcement.
