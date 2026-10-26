# WhyJ Quant Desktop 1.4.0

This Windows release updates the packaged research terminal from 1.3.1 with Pi 1.2, a configurable installation directory, and the shared JQ visual identity.

## Highlights

- **Choose where to install.** The per-user Windows installer supports other drives and paths containing spaces or Chinese characters, while research data stays in its existing location. ([#16](https://github.com/yangjingo/oh-my-quant/pull/16))
- **A consistent JQ identity.** The Desktop shell, terminal and newly generated reports share the JQ mark and warm color roles. Existing report files retain their original appearance. ([#28](https://github.com/yangjingo/oh-my-quant/pull/28))
- **Clearer research controls.** Interrupt research with Ctrl+G, retry failed quotes with Ctrl+R, and find configuration and report guidance from the terminal. ([#15](https://github.com/yangjingo/oh-my-quant/pull/15))

## What's Changed

### Runtime and Research

- Adopt Pi 1.2 and consolidate research task, evidence and report workflows. This change landed directly without a PR. ([d00a856](https://github.com/yangjingo/oh-my-quant/commit/d00a856))
- Reuse Pi APIs for explicitly selected community skills and MCP configuration. Skills are not downloaded on startup; MCP configuration does not start a JQ MCP client. ([#35](https://github.com/yangjingo/oh-my-quant/pull/35))
- Add research data contracts and price-volume calculations. ([#6](https://github.com/yangjingo/oh-my-quant/pull/6))

### Fixes

- Correct backtest equity and compound annual return calculations. ([#4](https://github.com/yangjingo/oh-my-quant/pull/4))
- Improve Chinese answer qualification checks and reuse unchanged message layouts during long conversations. ([#15](https://github.com/yangjingo/oh-my-quant/pull/15))

### Documentation and Maintenance

- Consolidate product scope, requirements and usage into the current Quant Harness guide. ([#66](https://github.com/yangjingo/oh-my-quant/pull/66))
- Stabilize CI policy and test lifecycles, including deterministic overview recovery and skill cancellation tests. These are verification improvements, not new application features. ([#41](https://github.com/yangjingo/oh-my-quant/pull/41), [#42](https://github.com/yangjingo/oh-my-quant/pull/42), [#45](https://github.com/yangjingo/oh-my-quant/pull/45))

## Installation and Upgrade

Download `WhyJ-Quant-Setup-1.4.0-win-x64.exe` from this Release's Assets and compare its SHA-256 with `SHA256SUMS.txt`. Windows 10 1809+ and Windows 11 x64 are supported. Bun, Python 3.13.12, AKShare 1.18.63, AKQuant and Git are bundled.

Reinstallation keeps the existing installation directory by default. Settings, sessions and reports remain in `%APPDATA%/WhyJ Quant/workspace/.ohquant`, independently of the application directory. AKShare is the default data source; configure an AI model connection with Ctrl+P.

## Known Limitations

- The installer is not Authenticode-signed. Windows may show an unknown-publisher warning, and strict application-control policies may block startup.
- Model and market-data services require network access and any credentials required by the selected provider. Live provider behavior is not certified by installer checks.
- The packaged Desktop still hosts the terminal interface. The separate Web research workspace introduced in [#27](https://github.com/yangjingo/oh-my-quant/pull/27) is not the Desktop entry; Electron workspace integration and packaging remain tracked by [#47](https://github.com/yangjingo/oh-my-quant/issues/47) and [#48](https://github.com/yangjingo/oh-my-quant/issues/48).

## Verification

The published installer was built from [4a83606](https://github.com/yangjingo/oh-my-quant/commit/4a8360671f0a303c9d226af56ae7b4141e1849f8). Publication requires both platform CI checks and Windows installation acceptance. Automated coverage includes startup without developer runtimes on PATH, bundled Python/Git, settings persistence, Unicode multiline paste, resizing, restart/exit, custom installation paths, shortcuts, reinstallation and retained research data. These checks do not replace interactive acceptance on a user's Windows machine.

## Full Changelog

[v1.3.1...v1.4.0](https://github.com/yangjingo/oh-my-quant/compare/v1.3.1...v1.4.0)
