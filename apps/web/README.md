# Shared Web entry

Reserved for the React + TypeScript + Vite workbench shared by the browser and future Electron GUI. Implementation is owned by [issue #50](https://github.com/yangjingo/oh-my-quant/issues/50) and [PR #81](https://github.com/yangjingo/oh-my-quant/pull/81); this directory reservation adds no running application, dependencies or build command.

UI code belongs here; shared execution, state and Host services belong in `src/app`. The current prototype remains in `src/app/research-workspace`, the current Electron terminal host in `desktop`, and the public website in `site`. Do not copy those implementations into this directory as a second runtime.

See the [architecture contract](../../docs/agent-runtime/architecture.md) for current versus planned entrypoints. This reservation does not complete the Host integration or replace the work in PR #81.
