# Blog upload, updates, and rollback

This is an execution guide, not an automatic publication hook. Continue within existing authorization. Local preview or workflow-design requests do not authorize remote deployment. Before requesting any additional approval, prepare the exact candidate, checks, and target.

Repository operators should follow [the article publishing runbook](../../../../docs/blog/website-publishing.md) for the concrete source paths, PowerShell release-copy commands, and current one-article limitation.

## 1. Verify the actual publication boundary

Read `site/README.md`, `site/DEPLOYMENT.md`, `site/vercel.json`, and local project linkage. Recorded URLs, IDs, and Git integration settings are dated history; refresh them before deployment.

Verify the installed CLI, account/team, project name/ID, Root Directory, build/output directories, domain, current Production ID, and Git deployment integration. Never print tokens. Expected verification targets are `yangjing-s-projects/oh-my-quant` and `oh-my-quant.vercel.app`; they do not authorize linking an unrelated directory.

`site/` builds independently. CLI upload from `site/` differs from importing the repository through Git with Root Directory `site`. Check whether source manuscripts outside that root are included. A successful local site build does not prove remote access to `../docs`.

Before production integration, choose a reproducible input path: transform approved manuscripts accessible to the site build, or stage source-hashed derived content into `site/content/` in a controlled preparation step. Do not hand-maintain a second article. The local Bun preview command is not automatically supported by the existing Node-only Vercel build.

## 2. Integrate the article, not the entire docs tree

Check routes/templates in `site/scripts/render.mjs` and the public allowlist in `site/scripts/build.mjs`. Local previews do not automatically register production routes or blog navigation.

Register only approved language pages with stable slugs, real SEO metadata, and language links. Include public articles, figures, required fonts/icons, and licenses. Exclude `.ohquant/`, `.env`, sessions, private `output/`, absolute machine paths, unrelated docs, and unapproved drafts.

Keep draft `noindex`, but do not treat it as access control. Remove it only according to the publication/indexing decision. Regenerate from sources instead of editing `site/dist/`.

From the repository root:

```sh
node site/scripts/build.mjs
```

Inspect the actual output inventory, public pages, assets, language navigation, captions, and old entries. Run local browser verification. Run relevant docs/PR checks separately and report unresolved failures.

## 3. Deploy Preview

When the user has requested an uploaded preview, deploy from the verified `site/` directory or a clean release copy:

```sh
vercel deploy --target preview --yes --scope yangjing-s-projects
```

Explicitly name the target; do not rely only on omitting `--prod`. Authentication failure does not justify another project. Link an unlinked directory only after verifying the intended project. Ordinary static `dist/` is not Vercel Build Output API output; do not casually use `--prebuilt`. See [deploy](https://vercel.com/docs/cli/deploy).

Record the URL/ID, environment, source/design revision, and status. Timeout does not prove failure: inspect the started deployment before retrying. After Ready, check actual article routes, available languages, figures/fonts/CSP, mobile layout, and zoom on the accessible Preview. Preserve deployment protection; if access is unavailable, report the missing online verification.

For a generated static review, build into a fresh release directory with an explicit public-asset inventory. A reused local preview folder can contain obsolete drafts, screenshots, and recordings that are not intended for publication. Check project-level build settings: a static HTML upload may need deployment-local empty `buildCommand` / `installCommand` and `outputDirectory: "."` overrides. Do not modify the full site's project defaults for one article. Tie the uploaded HTML and manuscript hashes to the local browser verification; identify uncommitted content separately from its base commit. If the active deployment tool disallows fetching the deployed URL, report platform readiness and local validation without claiming online end-to-end verification.

Local screenshots are not online screenshots; Ready is not reading-experience validation. The review object is this exact generated Preview.

## 4. Update Production

When publication is already authorized and the candidate meets acceptance criteria, record the current Production rollback target and promote the verified candidate:

```sh
vercel promote <verified-deployment-id-or-url> --yes --scope yangjing-s-projects
```

Promotion can produce a new Production deployment; verify final ID, environment, domain, and any build-affecting environment differences rather than copying the Preview ID into the production record. See [promote](https://vercel.com/docs/cli/promote).

Inspect domain mapping, then verify the actual article, language links, figures, and revision date at the production URL. Report platform readiness separately if online checks remain incomplete.

Updates follow source edit, translation/figure synchronization, rebuild, Preview, and publication. Preserve slugs, provenance, and revision metadata. Verify redirects when URLs change. Use versioned/content-hashed image URLs; do not overwrite immutable cached resources and expect immediate refresh.

## 5. Rollback and delivery record

For an authorized rollback, select a verified available Production version:

```sh
vercel rollback <previous-production-id-or-url> --scope yangjing-s-projects
```

Check current plan permissions and target availability. If the command times out, inspect rollback status rather than repeating it. Verify the version served by the domain. Correct the source and repeat Preview afterward so the next build does not reintroduce the error. See [rollback](https://vercel.com/docs/cli/rollback).

Use existing repository deployment records rather than another status ledger. Record article slug, manuscript/translation hashes and commit, design SHA, Preview/Production IDs, URLs, check scope, previous Production, and unverified items. If no deployment ran, report a prepared workflow, not a successful upload.
