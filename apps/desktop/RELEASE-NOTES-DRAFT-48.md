# Unreleased Desktop candidate — Issue #48

This draft describes a candidate, not a published version or an accepted installer. Final release notes must be reviewed against the actual release range and the exact tested package.

## Candidate changes

- The Windows shell presents the shared React workbench and attaches to the same local Host as Web and terminal entrypoints. Closing the window hides it to the tray; explicit quit detaches the Desktop view. ([#149](https://github.com/yangjingo/oh-my-quant/pull/149), [#150](https://github.com/yangjingo/oh-my-quant/pull/150))
- Unknown tool outcomes require explicit review before further work; confirmation does not replay or verify an external action. ([#151](https://github.com/yangjingo/oh-my-quant/pull/151))
- The React Desktop package no longer includes the unused PTY runtime. Terminal development and verification tools retain their own dependencies. ([#48](https://github.com/yangjingo/oh-my-quant/issues/48))

## Installation and verification limits

Use only a candidate whose filename, source revision and SHA-256 are recorded together. Existing app identity and data paths are intended to remain unchanged. The installer is unsigned; Windows application-control policy can block the candidate. Automated fixtures use synthetic data, and the independent target-machine installation, upgrade, retention and lifecycle checks in #56 remain required before acceptance. No public Release or npm publication is authorized by this draft.
