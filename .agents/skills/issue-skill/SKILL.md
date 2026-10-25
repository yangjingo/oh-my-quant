---
name: issue-skill
description: Draft and manage single-module issues for oh-my-quant with explicit scope, acceptance criteria, and one implementation PR.
---

# Issue Skill

## Scope

- One implementation issue, one primary functional module, one implementation PR.
- Keep only one active implementation PR per issue. Document replacements and close abandoned PRs; track new regressions separately.
- Split independent module changes into separate issues. Planning issues may group dependencies but are not implementation PR closing targets.
- List allowed production, test, and documentation paths. Justify essential integration changes outside the primary module.
- Separate changes to another module's behavior, persistence, or public interface. Exclude unrelated fixes, formatting, renaming, dependency upgrades, and cleanup.
- Revise the issue or split dependencies before expanding implementation scope.

## Preparation

1. Confirm the repository, base branch, version, and related issues or PRs. Use `main` as the stable iterative development version and the final integration target; distinguish it from published releases and local changes. Feature branches and temporary prototypes are not alternative stable development lines.
2. Read the [documentation index](../../../docs/README.md), [module architecture](../../../docs/agent-runtime/architecture.md), and relevant module documentation.
3. Separate observed behavior, user reports, and suspected causes. Mark unverified claims explicitly.

## Worktree Handoff

Prefer one dedicated branch and worktree per implementation issue. Start from the latest verified `main`; for an explicitly stacked PR, use its documented dependency branch temporarily and return the final integration target to `main` after the dependency merges. Reuse the issue's existing worktree when continuing its PR, and record the issue, branch, worktree path, and base revision together in the handoff.

Keep implementation changes out of the primary checkout and preserve its existing work. When an authorized PR merge delivers the issue to `main`, finish by deleting the delivered remote branch, local branch, and completed worktree using the checks in [pr-skill](../pr-skill/SKILL.md#post-merge-cleanup). Do not ask again for routine cleanup already covered by that task. An issue assignment alone does not authorize merging or cleanup, and merge authorization does not permit discarding local data. Preserve private state and verification receipts before removal; keep worktrees with unfinished work.

## Description

- Follow [shared writing conventions](../../../AGENTS.md#writing-style) for language, length, and formatting.
- Open with the affected scenario, observed behavior, impact, and intended outcome. Distinguish a reported symptom, a suspected cause, and a confirmed cause; support each claim at its actual certainty.
- Describe a proposed solution separately from the problem, with its mechanism, scope, and relevant tradeoff. Keep acceptance criteria observable; replace vague goals such as "improve stability" with the behavior that must change.
- Maintain one current description as scope evolves. Update affected sections instead of appending contradictory conclusions; keep earlier evidence tied to its revision.

## Issue Template

Title: `[type][module] Observable problem or capability`

Types: `bug`, `feature`, `refactor`, `docs`, `ci`.

~~~markdown
## Problem
Affected user, scenario, current behavior, and intended outcome.

## Evidence
- Version, branch, commit, and environment:
- Minimal reproduction or feature use case:
- Logs, screenshots, or source references:
- Root cause: confirmed or suspected, with supporting evidence.

## Scope
- Primary module:
- Allowed production and test paths:
- Essential integration changes and justification:
- Required docs updates:
- Non-goals and dependencies:

## Acceptance Criteria
- [ ] AC1: Given ..., when ..., then ...
- [ ] AC2: Relevant error or boundary behavior.
- [ ] AC3: Compatibility that must be preserved.

## Verification
Regression cases, full repository checks, build, and documentation checks.
For UI changes: affected states, viewport sizes, and actual screenshot plan.
Identify required live-environment checks and unavailable prerequisites.

## Risks and Rollback
Compatibility, configuration, or data impact; recovery approach.

## Implementation PR
Pending, or the single implementation PR link.
~~~

Each acceptance criterion must specify observable behavior and a verification method. “Tests pass” alone is insufficient.

## Handoff

For draft requests, return the proposed issue without publishing or implementing. Create or update GitHub issues only within the user's authorization, then return the link. Use [pr-skill](../pr-skill/SKILL.md) for implementation and acceptance mapping.

For a completed issue, verify the linked PR actually merged into `main`; closing an issue or closing an unmerged PR is not delivery. Record the merge revision and cleanup outcome: remote branch, local branch, worktree, private archive location if needed, and any retained object with its reason. Keep private archive contents out of GitHub messages.

This skill defines contributor practice; it does not configure GitHub enforcement.
