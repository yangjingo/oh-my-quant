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
| `templates/blog.html` | Blog 目录；尚未发布文章时显示待发布状态 |
| `content/messages.json` | 中英文文案；每个键必须同时提供 `zh` 和 `en` |
| `public/styles.css` | 布局、响应式与设计 token；修改色彩前先更新或核对 `../DESIGN.md` |
| `public/app.js` | 标签切换、演示偏好、导航与复制命令 |
| `public/fonts/` | 自托管 Geist / Geist Mono 及 SIL OFL 许可；页面不请求第三方字体 |
| `scripts/render.mjs` | 路由、静态语言渲染和浏览器交互文案；缺失翻译会使构建失败 |
| `scripts/build.mjs` | 生成四个语言页面，将审阅过的 public 资产复制到干净的 `dist/` |
| `scripts/serve.mjs` | 仅本机开发/预览服务器，不作为生产服务 |
| `vercel.json` | 构建路径、安全响应头与字体缓存 |

字体来自 Google Fonts 的 Geist v5 / Geist Mono v6，使用固定资源版本。品牌文字采用 DESIGN 规定的 Geist，不使用旧图片 Logo 的衬线字体。

官网导航、页脚、演示标题与 favicon 统一使用 JQ 融合标识。`public/logo-mark.svg` 和 `public/favicon.svg` 分别对应 `docs/assets/logo-mark.svg` 和 `docs/assets/app-icon.svg`，更新共享素材时一并更新副本。副本随站点提交，独立构建直接使用这些文件，不需要品牌生成脚本。桌面与手机导航均移除 Docs 入口；正文中的具体文档引用按其用途保留。

本轮排版、留白和交互调整依据用户指定的 taste-skill；设计判断与保留项见 [设计复核](./DESIGN-REVIEW.md)。

## 图标

通用界面图标统一使用 [Lucide](https://lucide.dev/guide/static)，选取 0.577.0 的 21 个官方 SVG，固定来源提交为 `0ea8780434e2b4527dc860b18ff94883d080b59c`。原始路径组成自托管的 `public/icons.svg`，许可证位于 `public/licenses/lucide.txt`。无需图标运行库或第三方网络请求。

使用 `<svg class="icon" aria-hidden="true" focusable="false"><use href="/icons.svg#languages" /></svg>` 引用图标；统一 24px viewBox、2px 描边与 `currentColor`。图标不承载辅助名称，纯图标链接和按钮通过本地化的 `aria-label` 命名，必要时用 `title` 提供悬停提示。

语言、GitHub 和页脚外部入口采用纯图标。菜单、方向箭头、复制、设置、FAQ 与原生选择框的箭头共用此图标集。品牌标记与合成数据曲线保持各自语义。

## 中英文与 Blog

| 页面 | 中文 | English |
|---|---|---|
| 首页 | `/` | `/en/` |
| Blog | `/blog/` | `/en/blog/` |

页面在构建时生成完整的语言内容，直接访问或禁用 JavaScript 仍能阅读。语言按钮切换同一页面的另一种语言，并保留章节锚点；站内导航保持当前语言。`html lang`、页面标题、description、hreflang、无障碍标签和交互提示同步翻译。URL 决定语言，不依赖浏览器存储；演示偏好在两种语言之间共用。

模板通过 `{{message.key}}` 引用 `content/messages.json` 中的文案，内容按纯文本转义，HTML 结构放在模板中。`runtime.*` 用于设置状态、移动导航按钮和复制反馈，构建时生成 `/messages.js`。不要直接编辑 `dist/`；开发服务器和正式构建使用同一个渲染函数。

Blog 当前没有已发布文章，不生成虚构文章或占位文章链接。发布第一篇文章时：在 `templates/` 增加正文模板，在 `content/messages.json` 添加两种语言的文案，在 `scripts/render.mjs` 的路由表和模板加载列表登记文章，再把 `templates/blog.html` 的待发布状态替换为文章目录。目录和正文都应提供对应语言链接；未完成的译文不要冒充已发布版本。

Feature 目录指向首页已有的自然语言研究、因子与回测、报告、工作流和设置章节。目录使用原生 `details/summary`，支持 Enter、Space、Tab；Escape 关闭并返回焦点，点击外部或选择链接也会关闭。手机端入口位于折叠菜单中。

## 内容与交互约定

页面是产品官网，不是在线量化服务。三种研究场景均标明交互示意与合成数据；设置只改变网页示例，localStorage 只保存涨跌色、Overview 显示与动效偏好。不收集 API key、不读取本机配置、不连接证券账户。

### 工作台预览

工作台展示以 `templates/home.html` 的 `#workspace` 为交互内容来源；同时提供 `site/public/workspace-preview.png` 作为真实对话式 Agent 研究工作台的高保真在线预览大图。README 和 `docs/slides.html` 共用 `docs/assets/workspace-preview.png`，不另外绘制 CLI 或维护第二份示例。`docs/assets/workspace-design-reference.png` 只是历史配色与留白参考，不作为当前产品预览。

更新静态预览时：访问英文 `/en/`，清除 `whyj-quant-site-preferences-v1` 后刷新，选择 Market research、Overview 开启、red-up，并关闭动效；桌面视口设为 1440px，再截取 `#workspace`。不裁掉 Interactive demo / Synthetic data 标记。刷新同一 PNG 后，README 与幻灯片同时更新；不要增加根目录生成脚本。页面翻译、用户切换场景/偏好和响应式重排是预期变化，不应从某个保存了偏好的浏览器状态制作默认截图。

红绿仅用于涨跌和风险，`Market Colors` 翻转涨跌色，风险保持独立语义；平盘保持中性。默认暖黑、奶油白、暖灰与克制金色对应 DESIGN；CLI、Desktop 源码、报告模板和 JQ 导出素材已同步。网页支持系统减少动态效果偏好。

发布前检查：两种语言的首页和 Blog 均可直接访问；语言切换保留页面和锚点；桌面与手机无横向溢出；Feature 目录与全部标签可用；键盘方向键切换标签；复制结果明确；偏好刷新及切换语言后保留；配色不改变风险语义；安装命令与外链仍和产品一致。研究示例不是产品性能或真实模型运行证明。

## Vercel

在 `site/` 内执行：

```sh
vercel link --project oh-my-quant --yes
vercel deploy --yes --target preview
```

配置已写入 `vercel.json`：Framework Preset 为 Other，Build Command 为 `node scripts/build.mjs`，Output Directory 为 `dist`，无依赖安装。明确传入 `--target preview`；Vercel 新项目的第一次部署可能自动成为 Production，不能仅靠省略 `--prod` 判断目标。

若通过 Vercel Git Integration 导入仓库，Root Directory 必须填写 `site`；PR 生成 Preview，合并 main 后可触发 Production。当前是否已连接 Git、是否已正式发布，以 [部署记录](./DEPLOYMENT.md) 为准。

后续迭代先部署 Preview；正式发布时使用 `vercel promote <deployment-id> --yes` 提升已验证版本，或显式使用 `--prod` 创建新的 Production 部署。项目使用独立的 Vercel 项目，不改动现有其他项目或绑定自定义域名。
