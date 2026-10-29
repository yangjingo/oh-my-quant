# CI and Releases: Verify the Artifact We Deliver

Prefer `gh` for GitHub issue and PR operations, including checks and reviewer attachments. Use `gh api` for supported operations without a dedicated command; use a browser or computer use when `gh` cannot perform the task or the user requests it. Tool choice does not change authorization or access requirements.

Passing source tests, installing a package, publishing a release and updating the website are separate outcomes. This workflow keeps their evidence separate so that a green build cannot silently become a claim that users received a working download.

`main` is the stable integration target, not necessarily the latest published version. Linux and Windows CI protect the shared foundation and CLI compatibility; Desktop installation checks currently cover Windows. macOS remains a delivery target requiring separate acceptance. See [product scope](./prd.md#scope).

## Issues and Pull Requests

Use one implementation issue and one primary module per PR. Keep the template's English headings and exactly one standalone `Closes #<issue>` line; link dependencies without closing them. Scope and writing conventions live in [AGENTS](../AGENTS.md), while [pr-skill](../.agents/skills/pr-skill/SKILL.md) owns local verification and post-merge cleanup.

[PR policy](../.github/workflows/pr-policy.yml) validates an open issue, completed sections, a current Markdown documentation change and duplicate closing references. It runs trusted default-branch code under `pull_request_target`, never PR-provided code. Proposed policy changes therefore need their own regression checks; a green target check still exercises the installed policy.

The validator rereads PR state to handle edits and closure during validation. It does not assess reasoning quality or atomically reconcile all concurrent issue/PR changes. Finalize the description before auditing the latest checks: a body edit can start a new policy run without changing the commit.

Visible UI changes require reviewer-accessible implementation captures under [pr-skill's visual evidence rules](../.agents/skills/pr-skill/SKILL.md#visual-evidence); a local archive path is not shared evidence. An [interactive frontend preview](../.agents/skills/pr-skill/SKILL.md#interactive-frontend-preview-recommended), preferably a temporary Vercel deployment, is recommended in addition. Identify its source revision and service/demo mode; preview access does not establish real Host or Desktop acceptance. Reviewers assess this evidence manually; PR policy checks section completion, not screenshot quality or deployment availability.

When review finds inaccurate or missing documentation, follow [review-skill's repair ownership](../.agents/skills/review-skill/SKILL.md#collaboration-and-convergence): changes introduced by the PR belong with its author, while confirmed defects already in `main` receive a focused documentation PR when that maintenance is authorized. Keep proposed policy changes distinct from corrections and retain unresolved implementation findings.

## Continuous Integration

The local baseline is:

```sh
bun install --frozen-lockfile
bun install --cwd apps/web --frozen-lockfile
bun run check:release
```

The [CI workflow](../.github/workflows/ci.yml) uses Bun 1.3.14 and Node 24 on Linux and Windows. The gate covers types, dependency boundaries, policy regressions, test organization, tests, CLI build, documentation and `web:check` (React types, client lifecycle/editor/dependency regressions, production build and demo-fixture exclusion). The Web package has its own frozen lockfile; CI and npm publication install both roots. `web:demo` and `build:demo` explicitly select the synthetic development adapter. Browser captures verify presentation separately and do not prove real Host or Electron integration. Linux also builds the website. Both platforms pack and install the npm artifact outside the checkout, then check its version with install scripts disabled. This verifies package startup, not live providers or interactive acceptance.

[Desktop required](../.github/workflows/desktop.yml) runs on every PR and main push, including docs changes. It typechecks, prepares pinned runtimes, packages and exercises the installed application in a disposable Windows runner. This costs more than path filtering, but covers shared CLI dependencies that affect the shipped app. Local root checks do not replace it; manual Desktop publication also reuses the full CI gate.

Outdated PR runs may be cancelled; main and manual runs are preserved. CI diagnostic artifacts last 14 days. Report the tested revision, environment and run link; distinguish failure, cancellation, skipped checks and missing evidence. A rerun does not erase its original failure. [Review-skill](../.agents/skills/review-skill/SKILL.md) defines the review procedure.

Runtime integration fixtures must own their asynchronous work through teardown. A test-runner timeout does not cancel an evaluation or a local provider handler: abort the operation, close the server, and await both the test body and pending handlers before restoring environment variables or removing its workspace. The fund comparison cases use a finite 15-second watchdog for five/six local model requests plus persistence and recovery; this is scheduling tolerance, not a product latency guarantee. The research task matrix runs each asset/entry pair in a separate workspace with its own existing 15-second budget. Preserve all evidence, report and recovery assertions; do not increase the global timeout or use reruns to hide failures. Exploratory slow-provider and forced-timeout probes belong in ignored evidence. The factor fixture also runs a bounded child-process timeout regression as part of the gate: its expected child failure verifies the owned test body and provider handler settle before teardown, without weakening factor assertions or changing global timeouts.

The factor-method integration scenarios use a 30-second per-case ceiling for multi-turn runs and recovery, with cancellation and owned cleanup on timeout. Local Windows Bun 1.3.14 runs measured roughly 0.5–1.4 seconds per scenario before the ceiling; hosted runner load may differ, so this is test scheduling headroom, not a product performance target or proof of the earlier timeout's cause. The controlled child records provider/body completion before fixture removal.

Annual Agent recovery tests use an isolated loopback provider and `synthetic-test-key`; the normal CI gate needs no real model key and does not validate live model quality. Archive seeding and Agent initialization run in a bounded 30-second setup, separate from the unchanged five-second behavior deadlines. Teardown aborts prompts, drains the owned setup/test body and provider handlers, then restores the environment and removes the workspace. If a deadline interrupts the body, diagnostics record the observed request count and remaining tool steps; a missing request must not pass the cancellation assertion.

Desktop CI also runs `bun run --cwd apps/desktop test` before packaging. These regressions inject shutdown failures into the smoke script and verify the Windows process query with a controlled child; they do not replace installed-application acceptance. The final no-orphan check uses `System.Diagnostics.Process` rather than CIM/WMI, keeps a 20-second query budget, and rejects query errors or malformed responses. Any surviving `whyj` process fails the isolated-runner check.

The root test gate also runs the Desktop unit suite, while `web:check` runs the Web package's tests with its own lockfile. A discovery fixture verifies CLI, TUI, Web, Desktop and service tests are actually collected, and that development and generated directories remain excluded. The shared contract fixture exercises the same submit, save/reload, follow-up and cancellation behavior directly and over authenticated Host HTTP/SSE. The existing Host kill/restart cases remain in the full suite, including a completed controlled effect whose receipt must not be duplicated.

`bun run test:entry-e2e` is a Windows Desktop CI check after the shared assets are built. It starts an isolated Host and synthetic model, submits in a real browser, attaches and hides Electron, then cancels the same run from a real terminal. It verifies an explicit continuation, report save/reopen and follow-up identities, and separately quits the terminal and Desktop while the reused Host remains available. Its redacted receipt and screenshots are retained in `desktop-evidence`; a fixture failure remains a failed check. It does not establish external tool idempotency, live-provider quality, native tray input or clean target-machine acceptance. Actual multi-day resource measurements and native interaction remain tracked by #146 and #147, opt-in scheduled live-provider evaluation by #152, and exact-candidate acceptance by #56. These separate checks are not implied to have run.

Smoke writes `result.json` after each completed check and on success/failure, including the tested revision, stage, completed checks, and process-query timing or error details. A shutdown failure also writes `failure.txt` without requiring a live Electron window; optional page capture cannot replace the original failure. Inspect these files in `desktop-evidence` alongside the job log. A query timeout proves neither a leak nor clean shutdown; a successful retry does not explain an earlier stall. These changes improve the check and its diagnostics, not application shutdown semantics.

The shared-Host fixtures exercise an isolated synthetic run in Electron and a browser, version/port conflict, restart recovery, and Desktop quit. The tray fixture invokes Electron's tray event and menu callbacks in a test process, checking both cancellation and confirmation of backend stop. It does not establish that the operating-system tray can be clicked or replace installed-package acceptance on the target machine.

## Main Branch Protection

Workflow files do not configure enforcement. In the matching main protection rule, require PRs and select actual check names: `CI required`, `PR policy`, and `Desktop required`. Choose GitHub Actions as their source where supported. Workflow titles and manual publishing jobs are unsuitable substitutes.

### Desktop Payload and Size Evidence

The installed Desktop remains self-contained: the complete installer includes Electron, the baseline-compatible Bun CLI, embedded Python with the locked quantitative dependencies. The optional online entry downloads that complete installer during installation; it does not remove or defer runtime installation until first launch. Git is no longer bundled or added to PATH; Skills use built-in HTTPS archive downloads, so curl is not required either. First launch does not download runtimes or require a separate dependency installation. Provider/model requests still require their normal network access and credentials. Runtime versions, native libraries, Python package metadata and licenses remain in the payload. Electron language resources are limited to `en-US`, `zh-CN` and `zh-TW`; other languages use the English fallback for native UI. This does not change the quantitative features or application text.

Packaging omits the NumPy, pandas and PyArrow internal test suites and PyArrow C/Cython headers, sources and import libraries. It also omits the two copies of Plotly's JupyterLab browser extension scripts: JupyterLab is not bundled, while standalone offline Plotly HTML remains supported. The React Desktop does not ship `node-pty` or xterm; they remain development dependencies for terminal and CI capture tests. Python's public `numpy.testing`/`pandas.testing` helpers remain available; the embedded environment is a runtime, not a PyArrow extension-development SDK or JupyterLab environment. CLI syntax/whitespace is minified without identifier renaming. Do not replace these exclusions with a blanket removal of Python data files, DLLs, `.dist-info`, or every directory named `testing`.

Each Desktop build replaces its generated `runtime/web` directory with the current Web build and refuses a linked destination. The installed-package check compares the complete Web filename set and SHA-256 values with the build, inspects the ASAR and unpacked resources for development terminal dependencies, and rejects `.ohquant` and local `.env` paths. These checks catch specific packaging mistakes; they do not prove every possible secret is absent or replace independent review of release inputs. Preserve user workspaces separately from generated runtime files.

The full NSIS installer disables `differentialPackage`: there is no automatic updater or published differential-update feed. Electron-builder's differential mode forces a 1 MiB dictionary and non-solid 7z compression; disabling it restores the normal solid archive and larger default dictionary. The existing full-installer upgrade/reinstall flow remains. If an automatic updater is introduced later, revisit this tradeoff and validate its update feed instead of assuming a differential package still exists. Compression can increase build/decompression resource needs; installation acceptance must exercise the actual installer. The payload already uses 7z level 9, so `compression: maximum` alone does not fix the differential-mode restriction.

After packaging, `node apps/desktop/scripts/package-size.mjs` records the source revision, installer SHA-256/bytes, unpacked file bytes, component totals, Python package totals and largest files in `output/desktop-size/package-size.json`. The workflow retains this as `desktop-size-evidence` and adds totals to the job summary. Unpacked file bytes exclude filesystem allocation overhead and post-launch caches. Compare the same source, lockfiles and toolchain, recording deliberate compression changes; a prior release or an archive alone is not an equivalent installer baseline.

`node apps/desktop/scripts/check-package.mjs` defaults to `release/win-unpacked`; installer acceptance passes the actual installation directory to the same check after reinstall. It exercises that Python with synthetic data: numerical operations, Arrow/Polars conversion, Parquet round-trip, offline Plotly output, MiniRacer, calendar data, and the existing deterministic AKQuant cases. The layout check rejects a bundled Git directory (including stale preparation output) and Git entries in the runtime source manifest. The installed-app smoke downloads one selected Skill from each pinned curated repository using the installed compiled CLI with an empty PATH, validates both receipts and checks that only the requested Skills are selected. This step needs GitHub API/codeload access; it does not download an execution runtime. The installed-app smoke also verifies CLI, shared Host startup, window close/reopen and idle shutdown; first-install/reinstall and user-data checks remain mandatory. These checks do not validate live provider availability or signing policy on another machine. Keep receipts in CI artifacts/PRs; changing payload filters invalidates the affected installation evidence.

### Desktop Online Entry

`bun run --cwd apps/desktop dist:online` runs after building the complete NSIS installer. It uses the existing pinned NSIS compiler/plugins to create `WhyJ-Quant-Online-<version>-win-x64.exe`, enforcing a strict **50,000,000-byte entry limit**. This limit describes the initial entry executable, not total network transfer or installed disk usage. The welcome page displays the additional complete-package download size. `WhyJ-Quant-Setup-<version>-win-x64.exe` remains the complete offline alternative; both lead to the same installation wizard and local capabilities.

The entry embeds a versioned GitHub HTTPS asset URL, byte count and SHA-512 calculated from the complete candidate. It downloads into its own temporary directory, verifies size and hash, then launches that installer with the original arguments. A missing, interrupted, truncated or corrupt download cannot start the installer or uninstall an existing application. Network failures offer retry in interactive mode; silent failures and cancellation return exit code 2. A verified install forwards the child exit status. This is neither an updater nor an alternative shared Host. Distribution sources and the Electron entry live in `apps/desktop/` under the [module architecture](./agent-runtime/architecture.md); Host business logic stays in `src/app/`. Desktop loads the shared React workbench from the local Host and closes to the tray. Repository-root `release/` and `output/` locations, appId and user data paths remain unchanged. The Desktop process bootstrap only supplies the storage root through `OHQUANT_DIR`; renderer/data-file access remains prohibited. The standalone smoke reads its isolated workspace. Generated `apps/desktop/runtime` and `.downloads` are excluded from source architecture/documentation scans.

The current pinned electron-builder 26.15.3 `nsis-web` template does not verify a freshly downloaded payload and removes the old version before the download stage. The separate entry deliberately verifies the complete installer before that installer starts. No runtime or installer-engine upgrade is required. The entry and complete installer are unsigned; a matching hash establishes the selected payload's integrity, not publisher trust or approval by a target machine's application-control policy.

`bun run --cwd apps/desktop test:online` builds a harmless executable fixture and exercises real download failures, same-size hash corruption, raw NSIS argument forwarding and child exit status on Windows. A disposable hosted runner captures the actual welcome/download/error windows, cancels a pending download, and clicks Retry after a network failure to complete a verified download. `node apps/desktop/scripts/test-online-install.mjs` serves the exact complete candidate over loopback and runs the existing first-install/reinstall, Unicode/non-system path, shortcut, data retention, Python/AKQuant and Desktop checks through the online entry. A corrupt download after reinstall must preserve the installed application. It refuses a non-hosted account. Loopback isolates unpublished candidate bytes; it does not certify GitHub availability, production TLS/proxy behavior or a future published URL.

Production build receipts record the embedded URL, payload SHA-512/bytes, entry SHA-256/bytes and source revision/hashes. CI retains them, synthetic results and sequential UI captures as `desktop-online-evidence`. Test entries accept only explicit loopback addresses and are written under ignored `output/`, outside the published `release/*.exe` glob. The published online entry becomes usable only when a **new authorized version** contains its matching complete installer; building against the existing version does not authorize replacing that release. Final publication verification must download both assets and check their relationship, not merely confirm that a small EXE exists.

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
3. Read back the Release and assets. Download both online and complete installers and `SHA256SUMS.txt`; verify hash, version, architecture, size, resolved source and the online receipt's payload SHA-512 against the published complete asset before updating downloads. Preserve the complete offline option and distinguish entry size from its additional download.
4. Update `site/content/downloads.json` from verified assets. The public button links to the versioned **Release page**; the EXE URL is verification metadata. Preview both languages and follow [website publication](./blog/website-publishing.md). Git merge alone does not deploy this project.

Record installer source/run/hash separately from the website revision and deployment. A successful installer check does not prove every target machine accepts an unsigned build or that real providers work.

### Desktop Release Notes

[apps/desktop/RELEASE-NOTES.md](../apps/desktop/RELEASE-NOTES.md) owns the publication body. Use **English** throughout, adapting the highlights and linked-change organization of [vLLM](https://github.com/vllm-project/vllm/releases/tag/v0.32.0) and [SGLang](https://github.com/sgl-project/sglang/releases/tag/v0.5.22). Explain user-visible changes and upgrade implications rather than listing commits.

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
