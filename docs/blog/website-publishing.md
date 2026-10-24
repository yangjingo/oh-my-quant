# 博客更新与 Vercel 发布流程

本文维护 `docs/blog` → `site` → `oh-my-quant.vercel.app` 的内容交付。源稿、生成页面、Git 提交和线上部署是不同状态；检查通过后仍需确认发布的正是被审阅的那份内容。离线合集与网站文章使用独立构建链。

## 先找到真源，再改页面

Repo Ops 正文由[合并稿](./agentic/vibe-repo-ops-merged-draft.md)维护，文件名中的 draft 不代表实时发布状态。[阅读渲染器](../../site/previews/vibe-repo-ops/README.md)负责排版与交互；[messages.json](../../site/content/messages.json)负责中英文列表标题、摘要。编辑正文标题时也要核对列表，避免同一篇文章出现两个名称。

文章生成包位于 `site/content/blog/vibe-repo-ops/`，包含 HTML、公开资产与 manifest，须重新生成并随源稿提交。`site/dist/` 只是网站输出，不能单独热修。稿件和文件哈希约束生成物一致性；缺文件或哈希不符时修复来源与生成过程，不删除校验。

[blog-skill](../../.agents/skills/blog-skill/SKILL.md)维护写作与展示规则，[DESIGN](../../DESIGN.md)维护视觉。模板获认可后才刷新 skill 的参考包及 HTML 哈希；参考快照不是另一份文章真源。译文从确认后的原文派生，尚无英文正文时明确链接中文，不伪造英文路由。

## 本地构建回答哪些问题

在仓库根目录执行：

```powershell
node site/scripts/prepare-blog.mjs
node site/scripts/build.mjs
bun run docs:build
bun run check:docs
$env:PORT = '4173'
node site/scripts/serve.mjs --dist
```

访问 `http://127.0.0.1:4173/blog/vibe-repo-ops/`。文章准备需要 Bun，独立网站构建只需要 Node；十一篇离线合集由 `docs:build` 生成，不会自动进入网站。换行规则由 `.gitattributes` 保证，避免跨平台改变哈希。

检查正文、标题、目录、引用和图注，再检查宽窄屏、资源加载及实际存在的交互。表格、图表、媒体、放大、分享和打印按本次变化选择验证，保留无 JavaScript 与减少动态效果下的可读性。使用项目服务器检查 CSP；没有响应头的简单静态服务不能代替它。模拟剪贴板或分享接口时明确说明验证边界。

入库前执行 [PR 流程](../../.agents/skills/pr-skill/SKILL.md)要求的完整门槛，核对分支、依赖与未提交文件。源稿、图源、渲染器和生成包一起交付，避免预览有改动、提交却遗漏。截图和录屏留在忽略的 `output/`，通过 PR 附件或 CI artifact 提供，禁止放入跟踪的资产目录。正式插图与验收截图有不同用途。

## Preview 必须包含完整网站

先确认账户、项目和当前 Production 回滚目标。当前流程使用 `yangjing-s-projects/oh-my-quant` 的独立网站输入：构建 `node scripts/build.mjs`，输出 `dist`，安装命令 `node --version`。发布时重新检查远端配置，不能据历史记录假定其未变。

```powershell
vercel whoami
vercel project inspect oh-my-quant --scope yangjing-s-projects
vercel inspect oh-my-quant.vercel.app --scope yangjing-s-projects
```

创建全新副本，只带公开构建输入。这样既减少私有数据误传，也检验没有根目录 docs 与开发依赖时能否独立构建。

```powershell
$releaseDir = Join-Path $PWD ('output/site-release-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
if (Test-Path -LiteralPath $releaseDir) { throw 'Choose a fresh release directory' }
New-Item -ItemType Directory -Path $releaseDir | Out-Null
foreach ($entry in @('public','scripts','content','templates','package.json','vercel.json')) {
  Copy-Item -LiteralPath (Join-Path 'site' $entry) -Destination $releaseDir -Recurse
}
node (Join-Path $releaseDir 'scripts/build.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Independent site build failed' }
vercel link --yes --project oh-my-quant --scope yangjing-s-projects --cwd $releaseDir
if ($LASTEXITCODE -ne 0) { throw 'Project link failed' }
vercel deploy --target preview --yes --scope yangjing-s-projects --cwd $releaseDir
```

不上传整个仓库，不复用混有旧页面、截图或凭证的目录，也不将只有一篇文章的部署提升成整个官网。CLI 上传根目录是网站副本；未来若改为从整仓库 Git 自动部署，才相应配置 Root Directory 为 `site`。当前 push 不等于自动上线。

记录 Preview URL/ID，确认 `preview / Ready`，并检查 `/`、`/en/`、两个 Blog 列表及文章路由。访问保护需要保留；无法访问时，只能报告平台状态和本地结果。用户要求先预览确认再 push 时遵守该顺序；已有明确发布授权则无需重复询问。

## 发布同一候选，核对正式域名

确认的必须是同一份候选内容。取得对应发布授权后，提升已验收 Preview：

```powershell
vercel promote <preview-deployment-id> --yes --scope yangjing-s-projects
vercel inspect oh-my-quant.vercel.app --scope yangjing-s-projects
```

提升可能产生新的 Production ID。确认正式域名实际指向该部署，再检查两种语言、正文与资源、列表和下载入口。平台 Ready、本地截图与线上页面检查分别记录；必要时比较线上 HTML 与本地构建哈希，不能把其中一种证据当成全部验收。

下载区主按钮应进入已验证的 GitHub Release 页面。旧 `/download`、`/en/download`、`/zh/download` 还要检查有无尾斜杠及查询参数的情况，确认最终页面和 `#download`。Vercel 的尾斜杠规范化顺序可能与本地服务器不同，重定向须在线验证。

将来源修订、稿件/HTML 哈希、Preview 和 Production ID、前一回滚目标及检查范围记入 [DEPLOYMENT.md](../../site/DEPLOYMENT.md)。历史发布过程留在那里，本页只维护操作与边界。

## 不确定结果先查询，故障从源头修复

部署命令超时后先 inspect 已返回的 ID，再决定是否重试。正文仍旧时检查真源、生成包、上传副本和域名映射；独立构建失败时检查是否依赖上传范围之外的文件，不能靠带上整个仓库解决。

Production 出现回归时，可恢复已验证的上一版本：

```powershell
vercel rollback <previous-production-id> --scope yangjing-s-projects
vercel inspect oh-my-quant.vercel.app --scope yangjing-s-projects
```

回滚后仍需核对实际页面。修复回到源文件并重新走 Preview，不能只改 `dist`，让下一次构建覆盖修复。

## 新文章需要显式接入

当前生成器绑定具体稿件和路由，不是自动扫描 Markdown 的 CMS。新增文章需要自己的生成入口、资产白名单、路由和双语列表；应保持一份正文来源，按实际需要复用模板。未合入或未发布的文章应链接可审阅的 PR/源码，不先依赖不存在的正式路由。删除原稿是独立内容决定，不因部署成功而自动获得授权。

## References

1. Vercel. [Deploy](https://vercel.com/docs/cli/deploy)、[Promote](https://vercel.com/docs/cli/promote)、[Rollback](https://vercel.com/docs/cli/rollback). 部署命令与状态的官方说明。
2. Vercel. [trailingSlash](https://vercel.com/docs/project-configuration/vercel-json#trailingslash). 部署路由规范化的依据，仍需实际 URL 验收。
3. oh-my-quant. [网站维护](../../site/README.md)、[发布约定](../../.agents/skills/blog-skill/references/vercel-publishing.md). 网站构建与授权边界。
