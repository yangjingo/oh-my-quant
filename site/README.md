# WhyJ Quant 产品官网

[正式官网](https://oh-my-quant.vercel.app) · [English](https://oh-my-quant.vercel.app/en/) · [Blog](https://oh-my-quant.vercel.app/blog/)

官网与 CLI 在同一仓库维护，`site/` 是独立的静态部署单元。视觉真源是根目录 [DESIGN.md](../DESIGN.md)，产品文案以 [README](../README.md)、[配置参考](../docs/quant-harness/configuration.md) 和 [Quant UI/UX](../docs/quant-harness/quant-uiux.md) 为依据。

## 为什么这样维护

- **同仓库、独立目录**：产品功能、安装步骤与官网内容可以在一次 PR 中更新；不复制另一套产品规范。
- **功能分支开发，合并回 main**：使用 `feat/website-*` 做短期开发与 Vercel Preview。不要用长期 `website` 分支保存第二份产品，否则设计和功能说明容易漂移。
- **独立 Vercel 项目**：Root Directory 设为 `site`。官网部署不运行 CLI，也不上传 `.ohquant/`、个人 notes、账户数据或整仓库产物。
- 当官网有独立团队、独立权限或不同发布周期时，再考虑拆仓库。当前不需要。

## 本地开发

```sh
node site/scripts/prepare-blog.mjs # Run from repository root after article edits; requires Bun
bun run --cwd site dev
bun run --cwd site build
bun run --cwd site preview
```

开发和构建预览均使用 `http://127.0.0.1:4173`，不要同时启动。没有第三方运行依赖，无需安装。构建为 Node.js 原生脚本，方便 Vercel 直接执行。

## 文件职责

| 文件 | 修改时机 |
|---|---|
| `templates/home.html` | 首页结构、功能介绍、演示内容与外链 |
| `templates/header.html` | 首页与 Blog 共用的 Feature 目录、导航和语言入口 |
| `templates/layout.html` | 共用页面外壳、元信息、字体和页脚 |
| `templates/download.html` | 已讨论的 Desktop/CLI 下载区；桌面双列、手机原生单选切换 |
| `content/downloads.json` | 经 GitHub Release 核实的 Windows 安装包版本、大小、链接和日期 |
| `public/download.css` | 下载区的暖黑金排版与响应式样式 |
| `templates/blog.html` | 中英文 Blog 列表；原文和译文状态明确区分 |
| `content/messages.json` | 中英文文案；每个键必须同时提供 `zh` 和 `en` |
| `public/styles.css` | 布局、响应式与设计 token；修改色彩前先更新或核对 `../DESIGN.md` |
| `public/app.js` | 标签切换、演示偏好、导航与复制命令 |
| `public/fonts/` | 自托管 Geist / Geist Mono 及 SIL OFL 许可；页面不请求第三方字体 |
| `scripts/render.mjs` | 路由、静态语言渲染和浏览器交互文案；缺失翻译会使构建失败 |
| `scripts/build.mjs` | 生成四个中英文入口和一篇中文文章，复制经校验的公开资产到 `dist/` |
| `scripts/prepare-blog.mjs` | 从 Markdown 和已认可的阅读模板生成文章与哈希清单 |
| `content/blog/vibe-repo-ops/` | 生成内容，不手工编辑；独立上传 site 时无需访问根目录 docs |
| `scripts/article.mjs` | 检查文章文件哈希，本地存在稿件时同时拒绝过期的生成版本 |
| `scripts/serve.mjs` | 仅本机开发/预览服务器，不作为生产服务 |
| `vercel.json` | 构建路径、安全响应头与字体缓存 |

字体来自 Google Fonts 的 Geist v5 / Geist Mono v6，使用固定资源版本。品牌文字采用 DESIGN 规定的 Geist，不使用旧图片 Logo 的衬线字体。

本轮排版、留白和交互调整依据用户指定的 taste-skill；设计判断与保留项见 [设计复核](./DESIGN-REVIEW.md)。

## 图标

通用界面图标统一使用 [Lucide](https://lucide.dev/guide/static)，选取 0.577.0 的 21 个官方 SVG，固定来源提交为 `0ea8780434e2b4527dc860b18ff94883d080b59c`。原始路径组成自托管的 `public/icons.svg`，许可证位于 `public/licenses/lucide.txt`。无需图标运行库或第三方网络请求。Download 另复用已审阅预览中的 Lucide Monitor 矢量，总计 22 个 sprite 图标。

使用 `<svg class="icon" aria-hidden="true" focusable="false"><use href="/icons.svg#languages" /></svg>` 引用图标；统一 24px viewBox、2px 描边与 `currentColor`。图标不承载辅助名称，纯图标链接和按钮通过本地化的 `aria-label` 命名，必要时用 `title` 提供悬停提示。

语言、GitHub 和页脚外部入口采用纯图标。菜单、方向箭头、复制、设置、FAQ 与原生选择框的箭头共用此图标集。品牌标记与合成数据曲线保持各自语义。

## 中英文与 Blog

| 页面 | 中文 | English |
|---|---|---|
| 首页 | `/` | `/en/` |
| Blog | `/blog/` | `/en/blog/` |
| Repo Ops 文章 | `/blog/vibe-repo-ops/` | 英文列表标注 Chinese 并链接中文原文，尚未发布译文 |

页面在构建时生成完整的语言内容，直接访问或禁用 JavaScript 仍能阅读。语言按钮切换同一页面的另一种语言，并保留章节锚点；站内导航保持当前语言。`html lang`、页面标题、description、hreflang、无障碍标签和交互提示同步翻译。URL 决定语言，不依赖浏览器存储；演示偏好在两种语言之间共用。

模板通过 `{{message.key}}` 引用 `content/messages.json` 中的文案，内容按纯文本转义，HTML 结构放在模板中。`runtime.*` 用于设置状态、移动导航按钮和复制反馈，构建时生成 `/messages.js`。不要直接编辑 `dist/`；开发服务器和正式构建使用同一个渲染函数。

Repo Ops 文章的真源是 `docs/blog/agentic/vibe-repo-ops-merged-draft.md`。修改稿件或阅读模板后，先执行 `node site/scripts/prepare-blog.mjs`，再运行网站构建。该准备步骤需要本地 Bun；Vercel 的 Node 构建读取已准备且具有哈希清单的内容，不依赖上传目录外的 docs。正文保留历史证据的日期和状态，不因发布而声称历史 PR 状态仍是当前状态。原始博客的清理与文档导览仍单独处理。

官网设计采用 `10184e1` 的 JQ 标识、暖黑背景 `#0C0C0C`、暖灰正文 `#B8B4A8`、奶油色标题与段落关键句 `#FFF3C4` 和金色 `#C99A2E`，与当前博客模板统一。本文使用独立阅读布局；文章页的 Blog 和品牌链接返回当前站点，正式 URL 用于 canonical 与分享。

Feature 目录指向首页已有的自然语言研究、因子与回测、报告、工作流和设置章节。目录使用原生 `details/summary`，支持 Enter、Space、Tab；Escape 关闭并返回焦点，点击外部或选择链接也会关闭。手机端入口位于折叠菜单中。

## 内容与交互约定

页面是产品官网，不是在线量化服务。三种研究场景均标明交互示意与合成数据；设置只改变网页示例，localStorage 只保存涨跌色、Overview 显示与动效偏好。不收集 API key、不读取本机配置、不连接证券账户。

红绿仅用于涨跌和风险，`Market Colors` 翻转涨跌色，风险保持独立语义；平盘保持中性。默认黑金配色与颜色值对应 DESIGN。网页支持系统减少动态效果偏好。

发布前检查：两种语言的首页和 Blog 均可直接访问；语言切换保留页面和锚点；桌面与手机无横向溢出；Feature 目录与全部标签可用；键盘方向键切换标签；复制结果明确；偏好刷新及切换语言后保留；配色不改变风险语义；安装命令与外链仍和产品一致。研究示例不是产品性能或真实模型运行证明。

## Download 集成来源

下载界面来自 `feat/website-warm-preview` 在 `10184e1` 之后的未提交 Hero2 / DownloadOptions 预览，原来只存在于独立工作树，未随已提交设计进入本次网站。当前将其布局、文案和原生控件移植到 `templates/download.html`，使用现有 Lucide sprite 和复制处理器；未引入 React/Tailwind 运行链。没有自动引入该工作树的首页重做、默认语言调整或 PR #27 演示区。

中文仍为 `/`，英文为 `/en/`。顶部 Features 在两种语言中均保留英文，开始使用统一跳到 `#download`；旧 `#install` 为定位别名。旧下载路径重定向到各自语言的下载锚点并保留查询参数。桌面版和 CLI 并列，手机使用原生单选按钮切换，无 JavaScript 仍可选择和下载。正文博客模板保持独立。

安装包不随网站构建发布，直接链接 GitHub Release 的 Windows x64 产物及 SHA256SUMS。版本、大小与验证日期集中在 `content/downloads.json`；修改时重新核实发布资产，构建会拒绝版本与链接不一致的清单。macOS/Linux 只提供 CLI，不显示不存在的桌面安装包。

## Vercel

完整操作顺序见 [博客更新与 Vercel 发布流程](../docs/blog/website-publishing.md)。

在 `site/` 内执行：

```sh
vercel link --project oh-my-quant --yes
vercel deploy --yes --target preview
```

配置已写入 `vercel.json`：Framework Preset 为 Other，Build Command 为 `node scripts/build.mjs`，Output Directory 为 `dist`，无依赖安装。明确传入 `--target preview`；Vercel 新项目的第一次部署可能自动成为 Production，不能仅靠省略 `--prod` 判断目标。

若通过 Vercel Git Integration 导入仓库，Root Directory 必须填写 `site`；PR 生成 Preview，合并 main 后可触发 Production。当前是否已连接 Git、是否已正式发布，以 [部署记录](./DEPLOYMENT.md) 为准。

后续迭代先部署 Preview；正式发布时使用 `vercel promote <deployment-id> --yes` 提升已验证版本，或显式使用 `--prod` 创建新的 Production 部署。项目使用独立的 Vercel 项目，不改动现有其他项目或绑定自定义域名。
