# Terminal-style Web design prototype

This is the runnable design reference for [issue #84](https://github.com/yangjingo/oh-my-quant/issues/84), not the production React workbench or a Host adapter. Read the [region-by-region design specification](../../docs/quant-harness/web-ui.md) first.

## Run and check

From the repository root (Node 22.19+):

```sh
npm --prefix prototypes/web-terminal start
npm --prefix prototypes/web-terminal test
```

Open http://127.0.0.1:8770/. No dependency installation, build or credentials are needed. `PORT` can override the port. The server binds only to loopback and disables caching; it exposes static prototype files only.

## Ownership

- `components/`: shell, header, sidebar, conversation, Overview, Composer, modal, environment settings, status and shared UI primitives.
- `styles/`: corresponding region styles. Sidebar overrides belong to sidebar, not conversation.
- `data/`: synthetic commands/references/quotes and one displayed version constant. Keep `data/brand.js` aligned with root `package.json` when updating the design baseline.
- `session.js`: in-page session and demonstration lifecycle; `composer.mjs`: input controller; `composer-core.mjs`: pure editing and reference transforms.
- `tests/`: editing boundaries, reference serialization, IDs, accessible submit semantics, icon references, empty-state isolation and refresh-state presentation.
- `assets/`: existing project SVG marks, local Geist fonts with OFL notices, Lucide sprite with license.

Session messages/drafts exist only for the page lifetime. Reading/model/source choices use localStorage key `quant-preview.preferences`; there are no credentials. Selecting an external provider records a preference and shows disconnected state, not a successful connection. No live filesystem, model, MCP, skills, price feed or research execution is implemented.

## Interaction walkthrough

1. Expand the session rail from the header. Search, pin, rename and switch to the empty session, then return to the sample.
2. Type `/` and select a local UI command. Type `@`, enter `reports/`, and choose a file. Menus match the outer Composer width. There are no trigger buttons.
3. Submit a sample question; stop using the send/stop icon or the footer runtime dialog.
4. Open the footer model/source settings, change a local preference and reopen after refresh. AKShare selection must clear synthetic Overview rows and display unconnected status.
5. At 390px, check input/menu width, drawer close controls, settings navigation and footer ellipsis. The system IME and screen readers still need manual target-environment testing.

The root release gate does not discover this isolated package's tests; run its check explicitly. Production React/Host behavior, performance and installed Desktop acceptance remain separate. Screenshot attachments and known limitations are recorded in the design document and linked Draft PR, not committed here.

## Reproduce review captures

With the server running on its default port, use an isolated Playwright CLI session:

```sh
npx --yes --package @playwright/cli@0.1.22 playwright-cli --session web-ui open http://127.0.0.1:8770/
npx --yes --package @playwright/cli@0.1.22 playwright-cli --session web-ui run-code --filename prototypes/web-terminal/capture.cjs
```

The walkthrough resets only this browser session's prototype preferences, checks the interactions above and saves 16 screenshots under ignored `output/web-ui/`. Check that its JSON result contains `"passed":true,"captures":16`; the CLI may exit zero when a snippet reports an error. Attach the images to the Draft PR with the tested revision, browser, OS and viewport. This walkthrough is an explicit local check, not part of the root CI gate. These are rendered synthetic fixtures, not live market or Host evidence.
