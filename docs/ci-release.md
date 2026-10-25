# CI and Releases: Verify the Artifact We Deliver

Passing source tests, installing a package, publishing a release and updating the website are separate outcomes. This workflow keeps their evidence separate so that a green build cannot silently become a claim that users received a working download.

`main` is the stable integration target, not necessarily the latest published version. Linux and Windows CI protect the shared foundation and CLI compatibility; Desktop installation checks currently cover Windows. macOS remains a delivery target requiring separate acceptance. See [product scope](./prd.md#scope).

## Issues and Pull Requests

Use one implementation issue and one primary module per PR. Keep the template's English headings and exactly one standalone `Closes #<issue>` line; link dependencies without closing them. Scope and writing conventions live in [AGENTS](../AGENTS.md), while [pr-skill](../.agents/skills/pr-skill/SKILL.md) owns local verification and post-merge cleanup.

[PR policy](../.github/workflows/pr-policy.yml) validates an open issue, completed sections, a current Markdown documentation change and duplicate closing references. It runs trusted default-branch code under `pull_request_target`, never PR-provided code. Proposed policy changes therefore need their own regression checks; a green target check still exercises the installed policy.

The validator rereads PR state to handle edits and closure during validation. It does not assess reasoning quality or atomically reconcile all concurrent issue/PR changes. Finalize the description before auditing the latest checks: a body edit can start a new policy run without changing the commit.

## Continuous Integration

The local baseline is:

```sh
bun install --frozen-lockfile
bun run check:release
```

The [CI workflow](../.github/workflows/ci.yml) uses Bun 1.3.14 and Node 24 on Linux and Windows. The gate covers types, dependency boundaries, policy regressions, test organization, tests, CLI build and documentation. Linux also builds the website. Both platforms pack and install the npm artifact outside the checkout, then check its version with install scripts disabled. This verifies package startup, not live providers or interactive acceptance.

[Desktop required](../.github/workflows/desktop.yml) runs on every PR and main push, including docs changes. It typechecks, prepares pinned runtimes, packages and exercises the installed application in a disposable Windows runner. This costs more than path filtering, but covers shared CLI dependencies that affect the shipped app. Local root checks do not replace it; manual Desktop publication also reuses the full CI gate.

Outdated PR runs may be cancelled; main and manual runs are preserved. CI diagnostic artifacts last 14 days. Report the tested revision, environment and run link; distinguish failure, cancellation, skipped checks and missing evidence. A rerun does not erase its original failure. [Review-skill](../.agents/skills/review-skill/SKILL.md) defines the review procedure.

Desktop CI also runs `bun run --cwd desktop test` before packaging. These regressions inject shutdown failures into the smoke script and verify the Windows process query with a controlled child; they do not replace installed-application acceptance. The final no-orphan check uses `System.Diagnostics.Process` rather than CIM/WMI, keeps a 20-second query budget, and rejects query errors or malformed responses. Any surviving `whyj` process fails the isolated-runner check.

Smoke writes `result.json` after each completed check and on success/failure, including the tested revision, stage, completed checks, and process-query timing or error details. A shutdown failure also writes `failure.txt` without requiring a live Electron window; optional page capture cannot replace the original failure. Inspect these files in `desktop-evidence` alongside the job log. A query timeout proves neither a leak nor clean shutdown; a successful retry does not explain an earlier stall. These changes improve the check and its diagnostics, not application shutdown semantics.

## Main Branch Protection

Workflow files do not configure enforcement. In the matching main protection rule, require PRs and select actual check names: `CI required`, `PR policy`, and `Desktop required`. Choose GitHub Actions as their source where supported. Workflow titles and manual publishing jobs are unsuitable substitutes.

Require up-to-date branches and conversation resolution, include administrators, and disallow force pushes and branch deletion. These reduce untested integration and bypasses but increase synchronization work. Do not require a check until applicable PRs produce it.

The maintainer chose no mandatory approving review count or commit signatures for the solo/agent workflow. Signing proves source identity, not correctness; review counts and linear history are independent decisions. Verify current classic protection and rulesets rather than treating this document as proof of saved settings:

```sh
gh api repos/yangjingo/oh-my-quant/branches/main/protection
gh api 'repos/yangjingo/oh-my-quant/rulesets?includes_parents=true'
```

Inspect the actual PR blocking reason too. After an authorized merge, check runs on the merged revision before reporting integration complete. Preserve unfinished dependencies and private worktree data; cleanup follows pr-skill. No destructive protection test is required.

## Desktop Release and Website Handoff

A version, tag, Actions artifact and GitHub Release identify different states. PR/main builds never publish. Manual publication requires `publish_release=true`, successful CI and installer checks, main, and matching stable root/Desktop versions.

1. Verify the candidate on main and prepare release notes. Resolve any existing version tag to its commit, including annotated tags. A mismatched or unreadable tag blocks publication; use a new version unless the maintainer explicitly authorizes correction with an expected-old-head lease. Never silently replace a published installer.
2. Dispatch `gh workflow run desktop.yml --ref main -f publish_release=true`. Inspect the actual head SHA and **publish** result. Only that run's tested installer should be released; `--target` does not move an existing tag.
3. Read back the Release and assets. Download the installer and `SHA256SUMS.txt`; verify hash, version, architecture, size and resolved source before updating downloads.
4. Update `site/content/downloads.json` from verified assets. The public button links to the versioned **Release page**; the EXE URL is verification metadata. Preview both languages and follow [website publication](./blog/website-publishing.md). Git merge alone does not deploy this project.

Record installer source/run/hash separately from the website revision and deployment. A successful installer check does not prove every target machine accepts an unsigned build or that real providers work.

### Desktop Release Notes

[desktop/RELEASE-NOTES.md](../desktop/RELEASE-NOTES.md) owns the publication body. Use **English** throughout, adapting the highlights and linked-change organization of [vLLM](https://github.com/vllm-project/vllm/releases/tag/v0.32.0) and [SGLang](https://github.com/sgl-project/sglang/releases/tag/v0.5.22). Explain user-visible changes and upgrade implications rather than listing commits.

Use `# WhyJ Quant Desktop <version>` and a summary, followed by these second-level headings in order: **Highlights**; **What's Changed**; **Installation and Upgrade**; **Known Limitations**; **Verification**; **Full Changelog**. Omit empty optional groups. Link every substantive change to its implementation PR using an absolute URL, or identify a direct commit when no PR exists. Include available assets, data retention/migrations, signing limitations and candidate-specific verification.

Compare the previous published Desktop tag with the exact candidate. Verify referenced changes are actually in that range; a PR merged later is not part of an older installer. Distinguish website/planning changes from packaged features. The full changelog uses those release tags; a first release links its history and states there is no predecessor.

For an authorized prose correction, preserve the old body and release metadata, then edit notes only. Read back the result and confirm tag, asset IDs, sizes and hashes are unchanged. Keep the original successful run link and update the repository notes through a PR. A newer notes commit does not authorize rebuilding or retagging the installer.

## npm Setup

Configure Trusted Publishing for package `whyj-quant`: owner `yangjingo`, repository `oh-my-quant`, workflow `npm-publish.yml`, no environment. Permit direct `npm publish`; staged publication is a separate mode. Consult [npm's setup requirements](https://docs.npmjs.com/trusted-publishers/) for current configuration and expiry behavior.

The [publish workflow](../.github/workflows/npm-publish.yml) uses GitHub-hosted runners, npm >=11.5.1 and `id-token: write`; it needs no long-lived `NPM_TOKEN`. Public publication includes provenance. These workflow declarations do not prove the registry configuration or credentials currently work.

## Release Procedure

Merge a reviewed stable package version, then dispatch **Publish npm** on main with that exact version and `dry_run` enabled. Inspect both CI platforms and the package listing. `prepublishOnly` also generates insights and runs the complete gate.

After release authorization, dispatch with `dry_run` disabled and verify that run's fixed revision. Confirm the registry version and provenance, then install that exact version in a clean environment and check `whyj --version`. Dispatches are serialized and publish stable versions under `latest`; a dry run does not test OIDC upload authorization.

## Failures and Recovery

Classify the failed layer before retrying: source regression, check infrastructure, registry upload or website handoff. Inspect the registry after an uncertain publish; existing npm versions cannot be overwritten. Prefer a new patch release over silently changing delivered artifacts. Pause publishing when necessary and repair workflows through a normal PR.

Historical incidents and their tradeoffs belong in the [Repo Ops article](./blog/agentic/vibe-repo-ops.md); run logs belong in CI or PR evidence. This page maintains current responsibilities and essential operations.
