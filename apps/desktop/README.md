# Desktop package development

The Windows package contains the shared React workbench, the local Host, the standalone CLI and the pinned Python runtime. The renderer does not own a second Agent. `node-pty` and xterm are development dependencies for terminal and test capture; they are not shipped in the React Desktop package.

From a clean checkout, install the frozen root, Web and Desktop dependencies, run `apps/desktop/scripts/prepare-runtime.ps1`, then run `bun run desktop:build` and `bun run --cwd apps/desktop dist:win`. `bun run test:entry-e2e` exercises the local browser, Desktop and terminal against an isolated synthetic Host after the build. The [CI guide](../../docs/ci-release.md) describes the complete checks, artifact hashes and release boundary.

`runtime/web` is generated and replaced on each build. Keep workspaces and private evidence outside `apps/desktop/runtime`; do not put user data in a build directory. The installed-package check compares the Web bundle to the current source build and checks the archive for test-only terminal dependencies and common private paths.

Build, CI and unsigned package checks are not target-machine acceptance. Issue #56 requires a clean isolated Windows target using the exact candidate hash; live providers and Windows signing policy have separate limits. The [candidate release-note draft](./RELEASE-NOTES-DRAFT-48.md) is not a published release.
