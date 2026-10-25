# Shared Web workbench

React + TypeScript + Vite presentation shared by the browser and Desktop renderer. The module follows [architecture](../../docs/agent-runtime/architecture.md) and [Web UI](../../docs/quant-harness/web-ui.md). It replaces the retired static design renderer.

## Run

From the repository root:

```sh
bun install --cwd apps/web --frozen-lockfile
bun run web:dev       # application entry: explicit disconnected Host state
bun run web:demo      # same React UI, explicit synthetic development adapter
bun run web:check     # types, client/editor/boundary tests, production build and fixture exclusion
bun run --cwd apps/web build:demo
```

Development binds 127.0.0.1:4176. Normal output is `dist/`; demonstration output is `dist-demo/`. Do not publish the package directory, dev data, tests or local receipts. Deploy only the selected build output. Preview is a demo, not a real local filesystem/model connection.

## Ownership

| Path | Responsibility |
| --- | --- |
| `src/main.tsx`, `mount.tsx` | Bootstrap, adapter selection and React mounting |
| `src/components/` | Header, Sessions, conversation, Overview, Composer, modal/settings and footer |
| `src/state/` | Async snapshot projection and session selection; never owns execution |
| `src/client/` | Typed UI port and unavailable-Host adapter |
| `src/features/composer/` | Pure token editing; references are resolved by the client |
| `src/styles/`, `public/assets/` | Presentation and licensed shared brand/font/icon assets |
| `dev/` | Explicit synthetic adapter and build/browser verification entrypoints |
| `test/` | Lifecycle, concurrency, editor and dependency regressions |

`mountWorkbench(element, client)` is the integration seam. It accepts a `WorkbenchClient`; unmount releases observers and never cancels a run. Only an explicit cancel action targets a run. The default bundle contains no demo adapter. Real HTTP/SSE, Host discovery, storage, credentials, provider calls and service commands belong to their existing shared modules and subsequent Host integration; the renderer cannot import them.

The package foundation and detach/cancel contract originate in [PR #81](https://github.com/yangjingo/oh-my-quant/pull/81) at `a5ac07d` (Liears). This migration preserves result access while applying #84's terminal layout, and extends events with session/run identity. It does not close #50/#81 or implement #46/#75.

## Review evidence

Use `dev/capture.cjs` with Playwright CLI against `web:demo`. It checks desktop/mobile layout, menus, draft retention, switching while running, send/stop and settings; screenshots go to ignored `output/web-react/`. Default disconnected mode must be checked separately. Screenshots are attached to the PR, never committed. Native IME, screen readers and installed Electron acceptance remain target-environment checks.
