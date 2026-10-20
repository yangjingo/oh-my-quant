# 博客更新与 Vercel 发布流程

更新：2026-10-20。适用于本仓库 `docs/blog` → `site` → `oh-my-quant.vercel.app` 的文章维护。它与十二篇离线合集的构建是两条独立流程。本文是维护操作说明，不会自动作为公开文章出现在 Blog 列表。

## TL;DR

正文和插图从源文件修改；先重新生成文章包，再构建完整网站、检查浏览器并上传 Preview。确认同一份预览后才提升 Production。Git push、PR 合并、Vercel 发布各自有独立状态，不能相互代替。

```powershell
# 在仓库根目录，Node + Bun；Vercel CLI 已登录正确团队
node site/scripts/prepare-blog.mjs
node site/scripts/build.mjs
bun run check:docs
$env:PORT = '4173'
node site/scripts/serve.mjs --dist
```

本机打开 `http://127.0.0.1:4173/blog/vibe-repo-ops/`。发布命令与上传边界见下文，不能直接把整个仓库传给 Vercel。

## 1. 确定这次修改的真源

| 要修改的内容 | 真源与职责 |
|---|---|
| 已发布 Repo Ops 正文 | [合并稿](./agentic/vibe-repo-ops-merged-draft.md)，路径保留 draft 历史名称，发布状态以路由与部署记录为准 |
| 文章排版、图表和交互 | [阅读渲染器](../../site/previews/vibe-repo-ops/README.md)及同目录 CSS、TS、JS；主题为 `brand/theme.css` |
| 设计和编辑规则 | [DESIGN](../../DESIGN.md)、[blog-skill](../../.agents/skills/blog-skill/SKILL.md)和其参考文件 |
| 中英文列表标题、摘要 | [messages.json](../../site/content/messages.json)；正文仍只有一个中文真源 |
| 路由、canonical 与列表 | [render.mjs](../../site/scripts/render.mjs)、[blog.html](../../site/templates/blog.html)、[article.mjs](../../site/scripts/article.mjs) |
| 生成文章包 | `site/content/blog/vibe-repo-ops/`，包括 HTML、公开资产及 manifest；必须生成并随源码提交，不能手工编辑 |
| 构建网站 | [build.mjs](../../site/scripts/build.mjs)，仅发布允许的文件；`site/dist/` 不是真源 |
| 已认可的模板快照 | [HTML 模板说明](../../.agents/skills/blog-skill/references/html-template.md)，用于参考，不是另一份独立正文 |
| 发布证据与回滚目标 | [DEPLOYMENT.md](../../site/DEPLOYMENT.md)，按时间记录部署 ID、来源、检查范围 |

本次下载区遗漏的原因，是它存在于 `feat/website-warm-preview` 的未提交工作树，而发布时只取了设计分支的已提交版本。后续发布前同时检查当前分支、相关 PR、专用工作树及未提交修改；建立本次来源清单，不能把同一个 commit 上的两个工作树当成相同内容。只带入已确认范围，保留他人的工作。

## 2. 编辑文章与维护模板

遵守 blog-skill：TL;DR、问题到机制再到证据与边界、文末 References；技术插图优先 SVG，图内只用英文并提供标题和图注。参考视频用链接，正文视频用紧凑封面并按需播放。长段正文用暖灰 `#B8B4A8`；标题、短语和段落中的关键句可以用奶油色 `#FFF3C4`，关键句使用 Markdown `**...**`。

修改图源或模板后重新生成，不要在生成 HTML 中补改。原三篇文章的删除与合并是单独的内容决定，完成一次部署不会自动授权删稿。新译文从已确认原文修订派生；尚无英文正文时，英文 Blog 明确标注 Chinese 并链接中文文章，不伪造英文路由或 hreflang。

模板改变并获认可后，刷新 skill 的 HTML 参考包：从一次干净的独立文章构建中复制 `index.html`、`assets/`、`images/`，更新模板说明的 HTML SHA-256。不要复制 `.vercel`、截图、浏览器日志或凭证。固定快照有自己的审阅元信息，其 HTML 哈希不要求等于正式文章。

## 3. 生成、检查、准备入库

```powershell
node site/scripts/prepare-blog.mjs
node site/scripts/build.mjs
bun run docs:build
bun run check:docs
bun run check:release
git diff --check
```

`prepare-blog.mjs` 使用 Bun 生成正式文章模式，移除审阅标记和 noindex，生成 canonical，并记录稿件与每个文件的 SHA-256。`build.mjs` 只需 Node：本地存在稿件时检查源哈希，独立网站上传不带根目录 docs 时仍校验文章包。缺文件、文件被修改或稿件更新后未重新生成，均应阻止构建。哈希敏感内容的换行策略见根 `.gitattributes`，避免 Windows/Linux checkout 改变字节。

`docs:build` 仅重建十二篇离线合集，不会发布 Repo Ops；`check:docs` 检查文档登记与本地链接，不能证明网页可读或远程部署成功。完整 release gate 依 [PR 流程](../../.agents/skills/pr-skill/SKILL.md)执行；后续修改重跑受影响检查，保留各项检查对应的修订，不能拿旧绿灯代替新内容验收。

浏览器重点核对：中英文首页和列表可访问；文章标题、目录、正文与 References；桌面/手机排版；SVG、字体、图标和媒体；表格筛选/列显示/比较、图表控制、放大/Escape；分享与打印；无 JavaScript 和减少动态效果下仍可读。复制/分享使用 stub 时注明，不能写成真实系统交互验收。使用网站服务器的 CSP 检查，不能仅用无响应头的简单 HTTP 服务。

入库包含稿件、图源、渲染器、生成文章包、设计/skill 规则和对应文档。检查 untracked 文件，避免漏掉未提交模板。临时 `output/`、`site/dist/`、`.vercel/`、node_modules、个人数据、凭证不入库。一个实施 Issue 对应一个 PR；提交和推送后检查最终 head 的 CI 与最终 PR 描述触发的 policy。合并状态与网站上线状态分别记录。

PR 验收截图、录屏和浏览器输出属于验证证据，不是博客或产品素材。它们只能保存在忽略的 `output/` 或外部证据归档中，通过 GitHub PR 附件或可访问的 CI artifact 提供给评审；禁止为了给 PR 添加效果图而提交到 `docs/assets/`、其他受版本控制的目录或专门的证据分支。无法上传附件时应说明限制，不能改成提交图片。博客正文确实需要的插图按内容素材维护，不能用“最终效果图”作为验收截图入库的理由。完整约定见 [PR Visual Evidence](../../.agents/skills/pr-skill/SKILL.md#visual-evidence)。

## 4. 准备独立发布副本并部署 Preview

先核对账户、项目与线上回滚目标；项目应是 `yangjing-s-projects/oh-my-quant`。截至本记录，CLI 发布根目录是网站本身，项目构建为 `node scripts/build.mjs`，输出 `dist`，安装命令 `node --version`。不要假设远程配置永远不变。若将来连接 Git 自动部署并导入整个仓库，Root Directory 才是 `site`；当前不应把 push 当成自动部署。

```powershell
vercel whoami
vercel project inspect oh-my-quant --scope yangjing-s-projects
vercel inspect oh-my-quant.vercel.app --scope yangjing-s-projects

# 每次使用一个新的目录；这里只复制完整网站的公开构建输入。
$releaseDir = Join-Path $PWD ('output/site-release-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
if (Test-Path -LiteralPath $releaseDir) { throw 'Choose a fresh release directory' }
New-Item -ItemType Directory -Path $releaseDir | Out-Null
foreach ($entry in @('public','scripts','content','templates')) {
  Copy-Item -LiteralPath (Join-Path 'site' $entry) -Destination $releaseDir -Recurse
}
foreach ($entry in @('package.json','vercel.json')) {
  Copy-Item -LiteralPath (Join-Path 'site' $entry) -Destination $releaseDir
}
node (Join-Path $releaseDir 'scripts/build.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Independent site build failed' }
vercel link --yes --project oh-my-quant --scope yangjing-s-projects --cwd $releaseDir
if ($LASTEXITCODE -ne 0) { throw 'Project link failed' }
vercel deploy --target preview --yes --scope yangjing-s-projects --cwd $releaseDir
```

明确指定 `--target preview`。不要上传整个仓库或复用包含旧文章、截图和录屏的输出目录；不要把单篇文章 Preview 提升后覆盖完整站点首页。本发布副本会在没有根目录 docs 的条件下构建，检验 Vercel 的真实文件边界。

记录 CLI 返回的 Preview URL 和 ID，随后 inspect 确认 `preview / Ready`。检查 `/`、`/en/`、`/blog/`、`/en/blog/`、`/blog/vibe-repo-ops/`。Preview 保留项目访问保护，可能需要登录；不可访问时只报告平台 Ready 与本地结果，不能声称线上浏览器验收。用户要求“先看预览再 push”时，按该顺序等待其确认；已有明确发布授权时不重复询问。

## 5. 提升正式版本与验证

获得对应发布授权，且确认的是同一份候选版本后：

```powershell
# 使用实际已经验证的 Preview ID，不能填旧日志中的 ID。
vercel promote <preview-deployment-id> --yes --scope yangjing-s-projects
vercel inspect oh-my-quant.vercel.app --scope yangjing-s-projects
```

提升可能创建新的 Production ID。核对正式域名指向这个新 ID 且状态 Ready，再在可用的浏览器中检查实际页面、正文/插图、站内导航和资源。需要精确版本证据时比较线上 HTML 与本地构建的 SHA-256。平台 Ready、本地截图、线上页面核验是三种不同证据，分别记录。

2026-10-20 的补发暴露了两个不同缺口：PR #54 已合入 main，但正式域名仍指向旧部署；发布后又发现旧下载路径在 Vercel 上返回 404。因此，完成 Git 交付后必须另外核对 Production，不能将 Preview 或 CI 通过视为发布完成。当前 `trailingSlash: true` 会先将 `/en/download` 规范化为 `/en/download/`；redirect 的 source 也必须匹配带尾斜杠的路径。三个旧入口 `/download`、`/en/download`、`/zh/download` 都要检查带斜杠和不带斜杠的形式，并携带查询参数验证最终 URL、`#download` 锚点和 HTTP 200。本地服务器的直接跳转没有覆盖 Vercel 的规范化顺序；回归验收以实际部署为准。行为依据见 [Vercel trailingSlash 配置](https://vercel.com/docs/project-configuration/vercel-json#trailingslash)。

[DEPLOYMENT.md](../../site/DEPLOYMENT.md)记录本次 commit 或未提交来源、稿件/生成 HTML 哈希、Preview 与 Production ID/URL、前一 Production 回滚 ID、实际执行的检查和未验证项。更新该记录后随交付入库。当前正式地址是 [官网](https://oh-my-quant.vercel.app/)，具体版本以实时 inspect 为准。

## 6. 失败处理与回滚

| 现象 | 处理 |
|---|---|
| 正文变了，页面仍是旧稿 | 确认修改真源，重新 prepare + build，再核对上传目录和域名映射 |
| 本地成功、Vercel 缺 docs 或 Bun | 独立构建必须读取已生成文章包；不要依赖上传根之外的文件 |
| 新设计丢了一部分 | 核对未提交工作树和依赖分支，明确遗漏来源后做定向集成 |
| manifest / hash 报错 | 重新生成并检查换行策略；不删除校验或手工篡改哈希掩盖问题 |
| Preview 要求登录 | 保留访问保护，使用有权限的账号验收 |
| 部署命令超时 | 先 inspect 已返回的部署 ID，确认状态，再决定是否重试 |
| Production 回归 | 回滚到已验证的前一 Production，然后在源文件修复并重新走 Preview |

```powershell
vercel rollback <previous-production-id> --scope yangjing-s-projects
vercel inspect oh-my-quant.vercel.app --scope yangjing-s-projects
```

不要在 `dist` 热修后忘记源文件，否则下一次部署会覆盖修复。回滚成功仍需验证域名和实际页面。

## 7. 新增另一篇文章

当前 `prepare-blog.mjs`、`article.mjs` 和 Repo Ops renderer 绑定一个稿件、slug 和章节结构；它们不是自动发现所有 Markdown 的 CMS。新增文章时显式实现对应生成入口、资产清单、路由和中英文列表条目，并调整文章自己的结构检查。不要把新 Markdown 丢进 `docs/blog` 就当成已经发布，也不要让整个 docs 目录成为公开资产。若文章数量增加，再将已验证模式提炼为文章登记表。

## References

1. [Vercel CLI deploy](https://vercel.com/docs/cli/deploy) — 部署目标与命令。
2. [Vercel CLI promote](https://vercel.com/docs/cli/promote) — 提升已存在的部署。
3. [Vercel CLI rollback](https://vercel.com/docs/cli/rollback) — 恢复此前部署。
4. [仓库网站维护](../../site/README.md)、[发布记录](../../site/DEPLOYMENT.md)、[blog-skill 发布约定](../../.agents/skills/blog-skill/references/vercel-publishing.md)。
