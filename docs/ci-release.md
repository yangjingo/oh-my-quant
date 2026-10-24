# CI and npm Releases

Automation is maintained in [issue #17](https://github.com/yangjingo/oh-my-quant/issues/17). The npm package is `whyj-quant`; its executable is `whyj`.

The [product scope](./prd.md#scope) has two forms: Desktop for Windows/macOS users and CLI/TUI for Linux professionals. Existing Linux/Windows root CI protects the shared foundation and CLI compatibility; current Desktop packaging and installer checks cover Windows. macOS build, native dependencies, signing/notarization, installation, and upgrade acceptance remain future delivery work, not checks already provided by this workflow. A shared Web UI is not a separate product release. Product targeting does not authorize removing existing cross-platform CI coverage.

## Issues and Pull Requests

Use the [implementation issue form](../.github/ISSUE_TEMPLATE/implementation.yml) to define one module and checkable acceptance criteria, then complete the [PR template](../.github/pull_request_template.md). Keep exactly one standalone `Closes #<issue>` line. Link dependencies without closing them. Follow [AGENTS.md](../AGENTS.md) and its Issue/PR skills.

Follow the shared [writing conventions](../AGENTS.md#writing-style): prefer English and aim for at most 1,000 words per Issue/PR description, with a clear problem, solution, and evidence. These language and length preferences are not CI gates. Preserve the PR template's English headings because policy parses them. Before opening a non-Draft PR or marking it ready, complete the local checks in [pr-skill](../.agents/skills/pr-skill/SKILL.md#before-commit-and-push). Keep evidence aligned with the submitted content, and recheck policy runs triggered by the final description as well as CI for the final code revision.

`main` is the stable iterative development version and the final integration target. It is not a scratch branch, and its current revision need not equal the latest published npm release. Develop changes in issue branches and merge reviewed, verified revisions into `main`; stacked PRs are temporary dependencies, not permanent alternative integration branches.

Prefer a dedicated issue worktree: [Issue worktree handoff](../.agents/skills/issue-skill/SKILL.md#worktree-handoff) records the branch, path, and verified base; [PR post-merge cleanup](../.agents/skills/pr-skill/SKILL.md#post-merge-cleanup) defines delivery checks and removal. When carrying out an authorized merge into `main`, finish by removing the delivered remote branch, local branch, and completed worktree after preserving private state and verification receipts. Keep unfinished or dependent work and report any cleanup blocker. Recheck remote heads and use an expected-head lease for deletion so concurrent updates survive. These are contributor procedures, not background automation or GitHub enforcement. GitHub's automatic branch deletion affects remote branches only. Merging does not authorize discarding ignored evidence or private state; a closed-but-unmerged issue or PR is not a merged delivery.

[PR policy](../.github/workflows/pr-policy.yml) checks out the trusted `pull_request_target` event's `github.sha`, matching its default-branch workflow revision rather than the potentially stale PR payload `base.sha`. It never executes PR code. For an open PR it checks an open issue rather than a PR number, completed sections, a non-deleted Markdown change under `docs/`, and other open PRs using the canonical closing format. Examples inside comments or code do not count. Scope, evidence quality, UI captures, and whether documentation reflects behavior remain review responsibilities.

The check runs on PR creation, body edits, pushes, reopening, and readiness changes. It reads fresh PR state before and after validation: ended PRs are no longer subject to open-issue requirements; changed head/base/body/file count is retried up to three snapshots before failing explicitly. Stable open-PR failures still fail. It does not reconcile later issue-only changes or provide atomic enforcement across concurrent PRs. A PR changing trusted policy must test the proposed script separately: its target check still executes default-branch code until merge.

Finalize the PR description before the last check audit. A body edit can trigger another policy run without changing the head SHA; wait for that run too. Record head SHA, tested merge candidate where applicable, workflow event, run ID and attempt. If ordinary PR checks are absent, inspect merge conflicts and base synchronization before retrying. A successful rerun does not erase its first failed attempt.

Run policy and documentation-link regression cases with `bun run check:quality`. The [technical article](./blog/agentic/vibe-repo-ops.md) explains the design and external references.

## Continuous Integration

PR review uses [review-skill](../.agents/skills/review-skill/SKILL.md) to distinguish code defects, merge conflicts, and final-revision verification. Record the remote base and head SHAs, inspect interacting changes, and separate confirmed findings from optional suggestions. An old green check or a clean textual merge does not establish readiness of the latest integrated revision. This is a contributor procedure, not an additional configured GitHub rule. The [review section of the repository infrastructure article](./blog/agentic/vibe-repo-ops.md#review) explains the observed cases and tradeoffs.

For each applicable check, record its workflow/job, trigger event, PR head/base and actual tested revision, environment, status, and run link. Keep failed, pending, cancelled, skipped, and absent checks distinct from success. Inspect triggers and logs before classifying a failure as a product regression, a baseline failure, an infrastructure problem, or unresolved. Preserve the first failure when rerunning and explain what the rerun establishes; a timeout alone does not establish flakiness.

[CI](../.github/workflows/ci.yml) runs on pull requests, pushes to `main`, manual dispatch, and calls from the release workflow. Both Windows and Linux use Bun 1.3.14 and Node 24:

```sh
bun install --frozen-lockfile
bun run check:release
```

The release gate covers types, architecture, quality-policy regressions, test organization, all automated tests, the CLI build, and documentation build/checks. Linux additionally builds the localized website with `node site/scripts/build.mjs`. CI then packs the npm artifact, installs it outside the checkout, and checks its version using Node. Install scripts are disabled for this smoke test. It proves package startup, not live providers, interactive behavior, website deployment, or every supported Node version. Missing ignored `output/` receipts are reported as unavailable historical evidence; source, current docs, navigation, and anchors remain strict.

`Windows desktop` now runs `Desktop required` for every PR and main push, including documentation changes: shared CLI/runtime changes can affect the shipped app. It independently typechecks Desktop, prepares pinned runtimes, packages, and runs installation/upgrade/interaction acceptance in the disposable Windows runner. Local root checks do not replace this job. Manual Desktop dispatch reuses the full two-platform CI rather than maintaining a partial copy; PR/push already have independent root CI. Desktop publication requires both the reused checks and installer job, plus main and matching stable CLI/Desktop versions.

CI/Desktop concurrency cancels outdated PR runs only; main/manual runs are not automatically interrupted. CI groups include the caller workflow name so reusable invocations do not cancel another workflow. Release gate output is retained as a per-platform artifact for 14 days, including failure when the log exists; Desktop preserves its existing screenshots and installer artifacts. No artifact does not mean success.

All-PR Desktop coverage intentionally costs more than path-filtered execution; any future optimization must preserve a consistently reported gate and account for shared dependencies.

## Desktop Release and Website Handoff

A package version, a Git tag, a successful Actions artifact and a published GitHub Release are separate states. PR/main Desktop checks build and exercise the installer but deliberately skip publication. Even a manual run leaves `publish` skipped unless `publish_release=true`. A successful workflow therefore does not by itself make a new public download available.

1. Merge and verify the intended application revision on `main`; root and Desktop stable versions must match. Inspect any existing `v<version>` tag, including the peeled commit of an annotated tag. Publication rejects a tag that resolves to a different commit from the tested build; lookup failures also stop publication. Do not move existing tags automatically. Normally use a new version; an unpublished-tag correction needs an explicit maintainer decision and an expected-old-head lease.
2. Prepare and review the [release notes](#desktop-release-notes), then dispatch `gh workflow run desktop.yml --ref main -f publish_release=true`. Verify the run's actual `headSha`, both reused CI platforms, installer checks and the **publish** job. The workflow publishes only the installer tested in that run, with its checksum and run link; `--target` does not move an already-existing tag.
3. Inspect the GitHub Release, resolved tag commit and assets. Download the EXE and `SHA256SUMS.txt` and compare SHA-256, filename, architecture and byte size. A missing Release, pending upload, checksum mismatch or source mismatch blocks the website update. Never overwrite a published installer to silently change a version.
4. Update `site/content/downloads.json` from those verified assets: version, verification date, release page, checksum link and Windows asset size/URL. The asset URL is verification metadata; the public download action uses the versioned **Release page**, not the EXE URL. Update both languages and preview the site. Do not replace verified values with the source package version before assets exist.
5. Deliver the website change through its issue/PR and publish the verified full site to Vercel using the [website publishing procedure](./blog/website-publishing.md). Check Production in both languages: displayed version/size, primary button destination, checksums and legacy download routes. Git merge does not automatically deploy this project. Record the release source/run, asset hash, site revision and Production ID separately.

On 2026-10-21, main `4a83606` already declared 1.4.0, but public Latest and website metadata remained 1.3.1. Previous successful manual runs had skipped publication. The existing 1.4.0 tag pointed to older commit `3ff6b7a`, so simply publishing current-build assets under it would misrepresent their source. The maintainer explicitly authorized correcting that unpublished-release tag to `4a83606` before [release run 39576756091](https://github.com/yangjingo/oh-my-quant/actions/runs/39576756091). This dated correction is not a general policy to rewrite release tags. Subsequent website delivery is tracked in [issue #67](https://github.com/yangjingo/oh-my-quant/issues/67).

### Desktop Release Notes

This is the authoritative Desktop release-note contract. [pr-skill](../.agents/skills/pr-skill/SKILL.md#documentation) routes release work here; [desktop/RELEASE-NOTES.md](../desktop/RELEASE-NOTES.md) contains the current version's actual publication body. Keep AGENTS.md as the general entry point rather than copying this procedure into it or creating a separate release skill.

Use **English** for every Desktop GitHub Release title, heading, change description and workflow-generated footer. Preserve product names, code identifiers and file paths. Write for someone deciding whether to install or upgrade: explain observable changes and their limits rather than reproducing a commit log.

The format adapts the highlights, linked changes and artifact/upgrade guidance in [vLLM v0.32.0](https://github.com/vllm-project/vllm/releases/tag/v0.32.0) and [SGLang v0.5.22](https://github.com/sgl-project/sglang/releases/tag/v0.5.22). Reuse the organization, not their project-specific categories, claims or contributor counts.

Use this order, omitting empty optional change groups:

1. `# WhyJ Quant Desktop <version>` and a one-sentence release summary.
2. `## Highlights`: a few user-facing changes, each with a linked PR.
3. `## What's Changed`: concise groups such as Desktop and Installation, Runtime and Research, Fixes, and Documentation and Maintenance. Link each substantive change to its implementation PR using an absolute URL. If a historical change landed directly, say so and link its commit; never invent a PR association.
4. `## Installation and Upgrade`: actual assets/platforms, required actions, data retention and migration or breaking changes when applicable. State prerequisites without advertising an unpublished asset.
5. `## Known Limitations`: relevant unresolved behavior, signing status and external-service boundaries. Omit only when there are no known limitations to report.
6. `## Verification`: tested source and candidate-specific checks, with explicit unverified/manual boundaries. The workflow appends its English run link only after required checks pass. Do not prewrite success for a pending run or reuse an older version's evidence.
7. `## Full Changelog`: a link comparing the previous published Desktop tag with this release tag. For a first release, link the tag's commit history instead and say there is no prior Desktop release.

Before publication, compare the previous published Desktop tag to the exact candidate SHA (or this release's resolved tag if already published), not to a moving `main`. Verify each referenced PR is merged and its delivered changes are in that range; for merge commits check ancestry, and for squash/rebase delivery verify the resulting commit/diff. A merged PR on newer main is not evidence that an older installer includes it. Separate source-only, website or planning changes from features available in the packaged application. In 1.4.0, for example, #27 adds a separate Web workspace; it does not deliver the Electron workspace host planned in #47/#48.

For each new version, update the body alongside the package version, verify links and the compare range, and review the final rendered GitHub body. Generated GitHub notes may help enumerate candidates, but require curation and source-membership checks. This editorial contract is a contributor/reviewer requirement, not a new language or semantic CI gate; existing CI does not prove that prose is English or a release claim is true.

For an authorized correction to an already published description, preserve the previous body and tag/source/asset metadata, prepare an English notes file, then use `gh release edit v<version> --notes-file <file>`. Retain the original successful publication run link, read the body back, and verify tag target, asset IDs, sizes and digests are unchanged. Update the repository body through a normal PR. Do not rerun publication, move the tag, rebuild or replace assets to correct prose. The corrected note's repository commit may be newer than the installer; its feature claims must still describe the original released source.

## Main Branch Protection

Workflow files and a job name ending in `required` do not configure GitHub enforcement. In **Settings → Branches → main protection rule**, require pull requests and select the actual check names `CI required` and `PR policy`. After the all-PR Desktop workflow reaches the default branch, also require `Desktop required`; update older PR branches so they produce that check. Do not use workflow titles (`CI`, `Windows desktop`) or manual-only publishing jobs as required check names. Select GitHub Actions as the expected source where available.

Enable **Require branches to be up to date before merging**, conversation resolution, and enforcement for administrators; keep force pushes and branch deletion disabled. Save the rule and read back its check names and `strict` value. Requiring an absent check can leave PRs waiting indefinitely. Review-count and signing requirements are separate decisions: a solo maintainer can require PRs without requiring another approving reviewer; signed commits require a working signing setup and verified commits, not merely SSH push authentication.

The 2026-10-17 audit found main unprotected. At 2026-10-18 00:45 Asia/Shanghai, a follow-up API audit confirmed classic protection was enabled, administrators were included, conversations had to be resolved, and force pushes/deletion were disabled. However, `required_status_checks.contexts` and `checks` were empty, and `strict` was false. One approving review and signed commits were required. PR #41 reported `REVIEW_REQUIRED` with no reviews; its then-head `ae684b1` was unsigned. This is a dated snapshot, not a claim that the incomplete settings remain current. The [blog](./blog/agentic/vibe-repo-ops.md) explains the distinction between configured protection and enforced CI.

At 01:03 the maintainer's saved configuration was confirmed: `CI required` and `PR policy`, both sourced from GitHub Actions (app ID 15368), with `strict=true`. `Desktop required` was not yet required; approval and signature requirements remained enabled. See the blog's [learning references](./blog/agentic/vibe-repo-ops.md#15-references分支设计与-agent-repo-ops-的学习路径) for branch-design material, five source projects, and four talks; recommendations there are not newly installed repository automation.

The maintainer subsequently chose zero mandatory approving reviews and no mandatory commit signatures for the current solo/agent workflow, while retaining required CI checks, strict base synchronization, and administrator enforcement. This is the chosen configuration, not proof that every setting has been saved; read back live values before evaluating merge readiness. Agents can sign commits once signing is configured, and CI/review remain distinct from signature verification.

Read-only verification commands (requires repository access):

```sh
gh api repos/yangjingo/oh-my-quant/branches/main/protection
gh api 'repos/yangjingo/oh-my-quant/rulesets?includes_parents=true'
gh pr view 41 --repo yangjingo/oh-my-quant --json reviewDecision,mergeStateStatus,statusCheckRollup
```

An empty ruleset list does not negate classic branch protection. Verify ruleset details too if rulesets are later introduced. Check configuration and actual PR blocking reasons separately; a blocked PR does not establish that CI is the blocker. A controlled failing-check acceptance test remains unperformed; do not test main protection with a destructive push.

Desktop now covers every PR and main push; inspect the actual trigger and revision before treating a run as applicable evidence. A successful PR CI run does not establish post-merge Desktop success. After an authorized merge, inspect the applicable runs on the merge revision and report any failures separately. For stacked PRs, record the remaining dependency and verify against the updated base before the next merge; retain a parent branch/worktree while an open child still depends on it, following [PR cleanup](../.agents/skills/pr-skill/SKILL.md#post-merge-cleanup).

## npm Setup

In the npm settings for `whyj-quant`, configure a GitHub Actions Trusted Publisher:

| Setting | Value |
| --- | --- |
| Owner | `yangjingo` |
| Repository | `oh-my-quant` |
| Workflow filename | `npm-publish.yml` |
| Environment | Leave empty |

Allow direct `npm publish` when creating the configuration; new configurations may default to staged publishing. Complete setup shortly before the first release: unused configurations expire after two days. See [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/).

The workflow uses GitHub-hosted runners, npm >=11.5.1, and `id-token: write` in the publishing job. No `NPM_TOKEN` secret is required. Public publication includes provenance.

## Release Procedure

1. Update the stable version in `package.json` and the lockfile as needed, update release documentation, and merge reviewed changes into `main`.
2. Open **Actions → Publish npm → Run workflow**, select `main`, enter the exact package version, and keep `dry_run` enabled.
3. Inspect both CI platforms and the dry-run package listing. The publishing job runs `prepublishOnly`, including insight generation and the complete release gate.
4. Run the same workflow with `dry_run` disabled to publish. Confirm the selected revision still represents the reviewed release; each dispatch checks its own fixed commit.
5. Verify the published version and provenance on npm, then test `npm install -g whyj-quant@<version>` and `whyj --version` in a clean environment.

Only stable versions are supported, published under `latest`. Dispatches are serialized. A dry run neither uploads a package nor proves OIDC authentication. Successful local validation does not prove GitHub runner execution or npm configuration.

## Failures and Recovery

Inspect the failed job before retrying; do not skip checks to release. Existing npm versions cannot be overwritten. If publication succeeded but later verification failed, inspect the registry before rerunning and prepare a new patch version when needed. Disable the workflow to pause releases; revert workflow changes through a normal PR.
