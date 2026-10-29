# Shared Web workbench

React + TypeScript + Vite presentation shared by the browser and Desktop renderer. The module follows [architecture](../../docs/agent-runtime/architecture.md) and [Web UI](../../docs/quant-harness/web-ui.md). It replaces the retired static design renderer.

## Run

From the repository root:

```sh
bun install --cwd apps/web --frozen-lockfile
bun run web:dev       # application entry: explicit disconnected Host state
bun run web:demo      # same React UI, explicit synthetic development adapter
bun run web:start     # build + start/reuse the local Agent Host; prints its loopback URL
bun run web:check     # types, client/editor/boundary tests, production build and fixture exclusion
bun run --cwd apps/web build:demo
```

Development binds 127.0.0.1:4176. Normal output is `dist/`; demonstration output is `dist-demo/`. Do not publish the package directory, dev data, tests or local receipts. Deploy only the selected build output. Preview is a demo, not a real local filesystem/model connection.

For the real Agent, install root dependencies too. Select a local configuration directory explicitly before starting; in PowerShell:

```powershell
$env:OHQUANT_DIR = 'E:\path\to\private-workspace'
$env:WHYJ_WEB_PORT = '4182' # optional
bun run web:start
```

The directory uses the existing `.ohquant` settings format: configure the provider, credentials and model through the existing local configuration workflow. No credentials or history are copied automatically. `web:host` serves an already built `dist/`; plain Vite/preview remains disconnected. The launcher returns after authenticated readiness and the detached Host survives its terminal. Use `bun run host:stop` to explicitly stop the selected workspace backend, including active research. Workspace discovery reuses a compatible instance; an incompatible or uncertain owner is diagnosed instead of starting another writer. See the [Host lifecycle](../../docs/agent-runtime/host.md).

The Host reuses the Quant/Pi Agent and registered research tools, excluding shell tools and external skills for this initial connection. The model panel edits the selected provider's model ID and supported thinking level; keys stay on the server. A saved configuration is not proof of a successful provider request. Use the hypothetical-data starter to verify a real tool call before configuring market sources.

Browser disconnect/reload preserves live work and restores workspace-scoped selection/drafts. Host restart restores private conversation checkpoints; explicit follow-ups reopen the original Quant journal. Interrupted requests are never replayed automatically, and uncertain tool outcomes require acknowledgement before a new question. See [conversation continuity](../../docs/quant-harness/workbench-sessions.md) for format and recovery boundaries. Live market Overview, file references, report/evidence projection, cross-entry continuation and automatic discovery remain separate work. An Agent answer is not a verified research report.

## Ownership

| Path | Responsibility |
| --- | --- |
| `src/main.tsx`, `mount.tsx` | Bootstrap, adapter selection and React mounting |
| `src/components/` | Header, Sessions, conversation, Overview, Composer, modal/settings and footer |
| `src/presentation.ts` | Localized state labels, send eligibility and honest snapshot-summary export |
| `src/state/` | Async snapshot projection and session selection; never owns execution |
| `src/client/` | Typed UI port and unavailable-Host adapter |
| `src/features/composer/` | Pure token editing; references are resolved by the client |
| `src/styles/`, `public/assets/` | Presentation and licensed shared brand/font/icon assets |
| `dev/` | Explicit synthetic adapter and build/browser verification entrypoints |
| `test/` | Lifecycle, concurrency, editor and dependency regressions |

`mountWorkbench(element, client)` is the integration seam. It accepts a `WorkbenchClient`; unmount releases observers and never cancels a run. Only an explicit cancel action targets a run. The default bundle contains no demo adapter. `src/app/workbench` owns the initial HTTP/SSE Host; `src/types/workbench.ts` owns neutral DTOs, re-exported by the UI contract. The renderer cannot import provider, storage or service implementations.

The package foundation and detach/cancel contract originate in [PR #81](https://github.com/yangjingo/oh-my-quant/pull/81) at `a5ac07d` (Liears). This migration preserves result access while applying #84's terminal layout, and extends events with session/run identity. It does not close #50/#81 or implement #46/#75.

## Review evidence

During a run, Enter keeps the next draft; the stop button or Ctrl+G cancels the selected run. Model responses support Markdown and GFM tables without raw HTML or automatic remote-image loading. Settings report rejected saves in place. Research results have a separate dialog for conclusions, evidence availability and report-version metadata; export downloads only the visible summary, not the stored report. Raw evidence inspection, report-body comparison and re-research remain Host integration work.

Use `dev/capture.cjs` with Playwright CLI against `web:demo`. It checks desktop/mobile layout, menus, draft retention, switching while running, send/stop and settings; screenshots go to ignored `output/web-react/`. Default disconnected mode must be checked separately. Screenshots are attached to the PR, never committed. Native IME, screen readers and installed Electron acceptance remain target-environment checks.
