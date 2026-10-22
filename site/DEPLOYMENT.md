# 官网交付与部署记录

## 2026-10-22：发布 Agent Desktop 架构定稿（Issue #74，PR 保持未合并）

维护者授权先将确认后的单文件博客发布，再更新相关架构 Issue；另明确要求在博客 PR 邀请 @Liears 审阅组织与演进，暂不合并。此记录区分线上发布和 main 的源码状态。

- 基线 main `0548a92b6d98d7d1270091de46eb9f00cf81bed4`；候选来自 `docs/74-agent-desktop-blog` 的本次修改。原稿 SHA-256 `9cae452c9c15f1865717363b025a674ea986ae8e8e120b915c867f062de6d2a3`，生产文章 HTML `41a1d98faa8e86527fe574dca0a83225fd64adabdd7dae3fdd93727253d6415a`；生成包 manifest `c16ca6eebc7a7e3d8547c913e4d979ff5a5c2e16a41c91c17042e31d84345edb`。准备命令见[发布流程](../docs/blog/website-publishing.md#7-新增另一篇文章)。
- [正式文章](https://oh-my-quant.vercel.app/blog/agent-desktop-lifecycle/)已上线；中英文 Blog 均链接中文原文，未发布英文译文。正文段落和标题与定稿自动比对一致。发布适配只处理资源、元信息、分享及表格交互，没有重新改写架构结论。
- 完整独立站点副本通过 Node 构建。项目 `prj_W6RAjHLVuwjdRdZ1pKFSRJj5ymvy` / `yangjing-s-projects/oh-my-quant`，CLI 上传根为 `.`，构建 `node scripts/build.mjs`、输出 `dist`、Node 24。保留 CSP 和访问保护。
- Preview `dpl_AfsyoYDG6ZbhC1Cd6kntBxACjT8v` / <https://oh-my-quant-hkplys0se-yangjing-s-projects.vercel.app> Ready；浏览器进入 Vercel 登录页，未宣称 Preview 在线视觉验收。按已授权发布提升候选后，Production `dpl_BCc94V4NLwq9ZvA33VByDrxroL6d` / <https://oh-my-quant-4iwizmvh6-yangjing-s-projects.vercel.app> Ready，正式域名下载的文章字节与候选完全一致。
- 本地 Chromium + 生产 CSP：1440/390/320px 无横向溢出；两张表格筛选、空态、列隐藏、重置、选择对比、展开和 Escape 返回通过；插图放大、无 JS 的九行原表、减少动态效果与打印 PDF 可用。分享/打印点击使用 stub 验证参数和调用，不作为系统分享面板验收。
- 正式域名 Chromium：1440/390px 可读，图像加载、两个表格控件初始化通过；首页、中英文列表、旧 Repo Ops 页面均返回 200，无页面运行错误。截图/PDF/日志保存在忽略的 `output/`，不作为产品资产提交。
- 仓库检查：2733 项 Bun 测试、28 项质量测试、类型/架构/构建通过；首次文档检查指出新 HTML 未加入 docs 总目录，补齐后 `check:docs` 通过。41 个本地私有历史证据链接未复验，不用于本次通过声明。GitHub CI 以博客 PR 的最终 head 为准。
- 回滚目标为此前 Production `dpl_9jTzkT7dqk6TB1xdgWTha5WQWaZU`。本次不修改 Desktop v1.4.0 Release 或下载安装包。PR 未合并期间，从旧 main 重新部署可能覆盖新文章，后续发布须显式保留此候选或先完成授权合并。

## 2026-10-21：Desktop 1.4.0 发布与下载页交接（Issue #67）

上轮撤下 CLI 入口时保留了已有 1.3.1 安装包；源码版本、Actions 构建成功和公开 Release 是三种不同状态。此前工作流的 `publish` 被跳过，官网版本清单也没有自动刷新。本轮维护者明确要求发布 1.4.0，并要求主下载按钮进入 GitHub Release 页面。

- 维护者授权将尚无 Release 的 `v1.4.0` 从旧提交 `3ff6b7a` 更正到已验证 main `4a8360671f0a303c9d226af56ae7b4141e1849f8`，以原标签对象 `d93473f` 为预期值执行 lease 保护更新。原标签记录保存在私有交付证据目录；不把本次授权推广为自动改写标签。
- [发布工作流 39576756091](https://github.com/yangjingo/oh-my-quant/actions/runs/39576756091) 的两平台 CI、Desktop 和 publish 均通过。[Desktop 1.4.0](https://github.com/yangjingo/oh-my-quant/releases/tag/v1.4.0) 已为 Latest。下载后的安装包、Release 资产 digest 与 SHA256SUMS 三者一致：`3e3fd44d24508b0e2b8fad1e7cc58ba719d5d70cff48fb82d82b6545a88f7779`，287,728,367 字节。该候选有 12 项应用检查、4 项安装检查的 runner 回执，不替代 #56 的人工目标机验收。
- 官网候选基于上述 main 加 #67 的下载交接修改；中英文主按钮进入 `releases/tag/v1.4.0`，保留校验和链接和用于核验的安装包元数据。CLI 入口保持下线。
- Preview：`dpl_FVrJ56zfZcdMxSZXQcvYWjdmoRTW` / <https://oh-my-quant-7peh0o1ya-yangjing-s-projects.vercel.app>，Ready。独立发布副本只含公开网站输入，构建通过；未更改 Preview 访问保护。
- 中文首页构建 SHA-256：`013bbea9de1c4da9498e65d4ced260da27645b716857e116b5afa6b626a9b336`；英文：`266cec51480762c5cdc3df31fbc2e5429cf0c8e83740d7b32b6b741b04f2725c`。
- 本地 Chromium 在中英文各 1440/390/320px 验证版本、大小和目标链接，无横向溢出，无 EXE 直链/CLI 卡片；实际点击进入 GitHub 1.4.0 Release 页面。截图留在忽略的 `output/release67/`，不入库。
- 本地完整 gate：2727 项 Bun 测试和 28 项质量检查通过；网站与文档检查通过。候选增加现有标签与受测提交一致性保护，防止未来把新安装包挂在旧源码标签下。
- 此提交记录发布准备状态；合并后提升同一 Preview，正式 Production ID、线上验收及最终 PR 链接见 [#67 交付记录](https://github.com/yangjingo/oh-my-quant/issues/67)。网站回滚目标是 `dpl_ActG9NE5Zk55nYyjn3eUKnsQRqgM`；回滚网站不撤销已发布 1.4.0。

## 2026-10-21：暂时撤下公开 CLI 安装入口（Issue #63 / PR #64）

维护者要求官网先保留 Desktop 下载，将 CLI/TUI 的 Desktop 复用决策交给 #51，并关联 #29。此次移除中英文 CLI 卡片、移动端版本切换、安装复制动作和页脚 npm 链接；保留 Windows 安装包、校验和、发布说明、旧下载路由和锚点。CLI/TUI 源码与 npm 发行物没有删除或重新发布。

- 网站候选来自 PR #64 的 `c53397e`；随后同步 #42 的 main `0328bf0`，网站构建输入未变。本记录本身不上传到网站。
- 独立发布副本只包含 `site/{public,scripts,content,templates,package.json,vercel.json}`，Node 构建通过。
- Preview：`dpl_8zUcBdw7QXKYcWwFeGsgv42WwRom` / <https://oh-my-quant-g4yphat9e-yangjing-s-projects.vercel.app>，inspect 确认 Preview / Ready。浏览器访问进入 Vercel 登录页，因此未宣称完成 Preview 线上视觉验收，也未关闭保护。
- 英文首页构建 SHA-256：`82e78f188ead4dc3f5fd29784fdef00d26449067907e2be18d13ebe7df18d0cf`。
- 中文首页构建 SHA-256：`bb95f68c4459a4152878e4043e11afb2d8157588061605e4bb714275c5261eb6`。
- 文章 HTML SHA-256 仍为 `801399b7ff9882334600b1284b7472c88a94bc15ba1f3a4c3c91cfdd0c6392cb`；此次未修改文章。
- 本地 Chromium 在中英文各 1440、390、320px 验证：单张 Desktop 卡片，无 CLI 控件/npm 页脚链接，无横向溢出，安装说明可用 Enter 展开和关闭，浏览器无错误。实际截图和 DOM 回执保存在忽略的 `output/pr63/`，不入库。
- 同步 main 后完整 release gate：2727 项测试通过、0 失败；类型、架构、质量、构建与文档检查通过。最终 CI 以 PR head 和最终描述触发的检查为准。
- 此提交记录的是发布准备状态。PR 合并后提升同一 Preview，核验正式域名与旧下载路径；Production ID、线上验收和清理结果记录在 [PR #64 的交付评论](https://github.com/yangjingo/oh-my-quant/pull/64)。不能用此处的 Preview Ready 代替 Production 已生效。
- 本轮发布前的 Production / 回滚目标：`dpl_EJBM6M7D21rJRBkBqYj7Q42iJ4RY`。

## 2026-10-20：补齐 Production 发布与旧下载地址修复（Issue #57）

PR #54 已合并为 main `1c7e58202a8d7395667238bb6bd1b484e7bfba70`，但本轮开始时正式域名仍指向 v14 `dpl_2tXXYp3oRuDWYgFJ4UXAEWuTQm9S`。这次从该 main 提取完整网站的公开构建输入，独立 Node 构建通过后发布 Preview 并提升 Production。没有上传主工作树中其他尚未提交的修改。

- 补发 Preview：`dpl_EZutd6yRUvRdqwN6ofFRo5RTaiPK`。
- 补发 Production：`dpl_tGL9oH7hVT85WFTc3ptaEaQXeDCh`，使新版 Desktop / CLI 下载区在 `/en/#install` 生效。
- 随后的线上检查发现：`/en/download` 被 `trailingSlash: true` 先转到 `/en/download/`，原不带尾斜杠的 redirect source 未命中，结果 404。中文两种旧路径也受影响。本地服务器的直接跳转检查未覆盖平台的处理顺序。
- 修复只将 `site/vercel.json` 的三个 redirect source 改为带尾斜杠；页面 HTML、正文、样式和资源未变。来源是上述 main 加 Issue #57 的三行路由配置修复，部署时尚未提交，后续提交可按该差异复现。
- 修复 Preview：`dpl_4oLBmMLzpkonmbdmrpYeDrHEs9vC` / <https://oh-my-quant-1w5pvdesd-yangjing-s-projects.vercel.app>。
- 修复 Production：`dpl_EJBM6M7D21rJRBkBqYj7Q42iJ4RY` / <https://oh-my-quant-easxxv9qn-yangjing-s-projects.vercel.app>。inspect 确认 `production / Ready` 且正式域名已绑定。
- 回滚目标：`dpl_tGL9oH7hVT85WFTc3ptaEaQXeDCh`；该版本有新版 UI，但保留旧路径缺陷。
- 英文首页 HTML SHA-256：`97e2f03ced23942c2476994b94074ee12d32a0a773d528968eb191861be1468b`。
- 文章 HTML SHA-256：`801399b7ff9882334600b1284b7472c88a94bc15ba1f3a4c3c91cfdd0c6392cb`。

实际 Chromium 检查覆盖 `/en/#install` 的 1440px 双列布局、390px Desktop / CLI 切换、320px 无横向溢出；中文顶部仍为 Features，文章正文计算颜色为 `#B8B4A8`。五个公开页面返回 200，在线 HTML 哈希与本地构建一致。Preview HTTP 检查和修复后的 Production 浏览器导航均验证三条旧路径的带斜杠/不带斜杠六种形式，保留 `?via=verify`，最终到达正确语言首页的 `#download` 且返回 200。

最终效果图于 2026-10-20 在 Chromium 以 1440 × 1000 视口打开 `/en/#install` 截取，对应上述修复 Production；该页面 HTML 与 `5c7a7ee` 的构建一致。该图曾被误提交到 `docs/assets/` 用作 PR 附图，现按维护者要求从当前源码移除，保留在外部交付证据归档。PR 截图应使用 GitHub 附件或 CI artifact，不能以入库图片代替附件。

其他截图和构建回执保留在专用交付证据目录。首次补充颜色检查用了不正确的 `#section-2 p` selector 而超时，修正为实际段落后通过；不将该超时视为网页故障。未重新下载安装包或调用业务模型服务。后续发布应分别记录合并、Preview、Production 和线上核验；具体流程见 [博客发布说明](../docs/blog/website-publishing.md)。

## 2026-10-19：已确认预览的入库准备（Issue #52）

用户确认 v17 并要求完成入库与对应 Issue/PR。本分支已快进到 main `439fb6b` 后恢复本次改动，未改动主工作树。最新完整 `bun run check:release` 通过；网站独立构建、文档与 skill 检查通过。新增 `docs/blog/website-publishing.md` 并加入文档/博客导览；`.gitattributes` 固定稿件 LF 和哈希敏感生成包的原始字节。当时误将两张验收截图存入 `docs/assets/`；现已从当前源码移除并保留外部证据归档，后续禁止重复该做法。PR 合并和 Production 提升须分别记录，本文不预先宣称已完成。

## 2026-10-19：Features 文案与 Download 恢复（v17，待用户确认）

用户指出中文顶部不应追加“功能”，并发现之前讨论的下载界面未集成。原因是此前仅取设计提交 `10184e1`，遗漏 `oh-my-quant-site-preview` / `feat/website-warm-preview` 工作树中未提交的 Hero2 和 DownloadOptions。现按原版布局和文案移植到静态模板，保留双列/手机切换、安装说明、Windows 安装包、SHA256SUMS 和三条 CLI 复制命令；没有引入该工作树的其他首页/演示区改动。

- 最新 Preview：<https://oh-my-quant-andt3zrw6-yangjing-s-projects.vercel.app/#download>；英文 <https://oh-my-quant-andt3zrw6-yangjing-s-projects.vercel.app/en/#download>。
- Deployment：`dpl_BBexBjh2UZcaCJ2Ayv7TgAPAtPma`，inspect 确认 preview / Ready。
- 只改 Features 文案的中间 v16：`dpl_3K8j4zdxX8TBJZdZ7cAzk2QtpkCi`，由 v17 替代。
- 发布目录 `output/site-release-20261019-review-v17`，独立 Node 构建生成五页及八类公开资产；博客保留 v14 阅读色和同一篇正文。
- GitHub Release API 核实 v1.3.1 仍为 latest，Windows x64 安装包为 287582110 bytes，SHA256SUMS 资产存在。未重新下载或运行安装包。
- 本地 Chromium 核对中文与英文在 1440/390/320px 的双列/单列状态、无溢出、手机切换和键盘选择、无 JavaScript 切换、旧下载路径带查询参数的 308 重定向。复制处理器使用剪贴板 stub 核对 npm 命令，不冒充系统剪贴板验收。博客正文计算颜色保持 #B8B4A8。桌面和手机截图 `output/playwright/blog-preview/review-v17-download-*` 已人工查看。
- 生成构建、脚本语法、文档检查、skill 校验和 diff 检查通过。完整 2686 项 release gate 是 v15 检查；本轮仅重跑受影响的网站与文档检查。首次浏览器批量检查因平滑滚动导致点击稳定性等待超时，使用 reduced-motion 环境重跑通过；不将超时计作通过。

平台 Ready 与本地验收分别记录，本轮未对远程 Preview 做浏览器验收。依用户要求仍未 commit/push、未合并、未更新 Production，等待预览确认。

## 2026-10-19：入库前完整网站审阅 Preview（v15）

用户要求先刷新预览并确认效果，再提交和推送。此次仅部署 Preview，未执行 commit/push 或提升 Production。

- Preview 首页：<https://oh-my-quant-tnf84ku7i-yangjing-s-projects.vercel.app/>
- Blog：<https://oh-my-quant-tnf84ku7i-yangjing-s-projects.vercel.app/blog/>
- 文章：<https://oh-my-quant-tnf84ku7i-yangjing-s-projects.vercel.app/blog/vibe-repo-ops/>
- 部署 ID：`dpl_AxFwpqHxbHvUQGJKY9Vbb6TKcJ23`，inspect 确认 `preview / Ready`。保留项目登录保护；本轮未做该远程 Preview 的浏览器验收。
- 公开输入副本：`output/site-release-20261019-review-v15`，独立 Node 构建通过。文章 HTML SHA-256：`b3dbb45e7cf0dee4fb3d809b65cb88eb16b17c014ec7bbca710eac0f22dfa875`，与 v14 保持相同阅读样式；本轮补充关键句强调规则及维护文档。
- 本轮查询的 Production 仍为 `dpl_2tXXYp3oRuDWYgFJ4UXAEWuTQm9S`。

本地 Chromium 使用实际 CSP，在 1440/390/320px 检查五个页面均返回 200 且无横向溢出。正文为暖灰、段落关键句及标题为奶油色；表格展开/Escape、可见 SVG 解码、打印深色文字通过，未捕获页面脚本异常。已查看桌面首页、文章首屏及手机段落截图：`output/playwright/blog-preview/review-v15-*`。

`bun run check:release` 完整通过（2686 tests / 299 files / 0 fail），含类型、架构、质量、测试组织、测试、构建及文档检查；网站独立构建和 skill 格式校验通过。首次安装出现网络/缓存完整性错误，使用独立缓存 `output/bun-review-cache` 后 locked install 成功；未修改锁文件或跳过完整性检查。DESIGN 的失效本地素材链接改为实际网站文件或设计来源的精确 commit 链接，并区分网站已实现与其他客户端的目标设计。目录仅登记合并稿和配图，原博客保留。没有执行外部模型/市场验收、Desktop 安装检查或远程 CI。

## 2026-10-19：正文阅读色调整（v14，当前 Production）

按用户反馈，奶油色仅用于标题和少量强调；正文、References 条目和表格值改为暖灰 `#B8B4A8`，正文链接为 `#C4B68E`，打印版为深色文字。DESIGN.md、文章渲染器、英文 blog-skill 视觉规范和附带 HTML 参考模板同步更新。正文与暖黑背景的对比度为 9.44:1。

- Preview：`dpl_AkxpQmpG3fc1uqvSFSqwV6hGvWYF` / <https://oh-my-quant-gq8bcdgpn-yangjing-s-projects.vercel.app>
- Production：`dpl_2tXXYp3oRuDWYgFJ4UXAEWuTQm9S` / <https://oh-my-quant-jl0tokp2o-yangjing-s-projects.vercel.app>
- 正式文章：<https://oh-my-quant.vercel.app/blog/vibe-repo-ops/>；inspect 确认正式域名已指向上述 Ready Production。
- 回滚版本：`dpl_127ch1HT9nkEzcqQaw8TrvxfS1oH`。
- 发布副本：`output/site-release-20261019-reading-v14`，只包含网站构建输入，独立 Node 构建与 Vercel 构建均生成五页。
- 稿件 SHA-256：`d760ef914479d85cd98d1e633a59b76c9ca14e0f9ec9f06fdc4e1ebd280fb38c`，正文内容未改。
- 发布 HTML SHA-256：`b3dbb45e7cf0dee4fb3d809b65cb88eb16b17c014ec7bbca710eac0f22dfa875`；浏览器获取的线上 HTML 与本地构建完全一致。
- 参考模板 HTML SHA-256：`a324b6799e18348e25859dc74b1d637a86d465a1a11f28d3b5524f713d4aec87`；参考模板保留审阅元信息，故与发布版 HTML 不同。

本地 Chromium 检查了正文、标题、强调、链接、References、表格和打印的实际计算颜色；已查看桌面与手机截图。线上文章返回 HTTP 200，正文/标题/强调/链接/表格颜色符合上述角色，390px 无横向溢出。线上证据为 `output/playwright/blog-preview/production-reading-v14-mobile.png`。Skill 格式校验通过。本轮未重复执行业务代码测试；源码仍位于审阅工作树，部署不等于合入 main。

## 2026-10-19：新版 DESIGN 与 Repo Ops 正式发布

用户明确要求更新正式官网并将文章加入 Blog。已从完整网站 Preview 提升到 Production；本轮不是单篇文章替换首页。

| 项目 | 当前记录 |
| --- | --- |
| 正式首页 | <https://oh-my-quant.vercel.app/> |
| Blog 列表 | <https://oh-my-quant.vercel.app/blog/>；英文 <https://oh-my-quant.vercel.app/en/blog/> |
| 正式文章 | <https://oh-my-quant.vercel.app/blog/vibe-repo-ops/> |
| Preview | `dpl_7tWEzG8or2xSxduAMvdwabDuKj3B` / <https://oh-my-quant-hlj1jtjwq-yangjing-s-projects.vercel.app> |
| Production | `dpl_127ch1HT9nkEzcqQaw8TrvxfS1oH` / <https://oh-my-quant-krzn53n0y-yangjing-s-projects.vercel.app> |
| 域名状态 | `vercel inspect oh-my-quant.vercel.app` 确认指向上述 Production，Ready |
| 回滚版本 | `dpl_FyUtTYSevXScNQmAEeswu8W3JRU2` |
| 设计 | 从 `10184e1a2ad99d976c33e6c55d6872d7083fe827` 引入官网相关文件与 DESIGN；保留业务运行时代码原状 |
| 稿件 SHA-256 | `d760ef914479d85cd98d1e633a59b76c9ca14e0f9ec9f06fdc4e1ebd280fb38c` |
| 发布文章 HTML SHA-256 | `ac4816492b6cc0af9b3b8484fa2140270e18bde2faf4f4b9b1d235eb9e77a25c` |
| 来源状态 | `docs/vibe-repo-ops-merged-draft` 工作树，基线 `cc9c935` 加本次未提交的网站集成改动；部署不等于合入 main |

首页、英文首页、中英文 Blog 列表统一使用 JQ 标识及暖黑/奶油/金色设计。列表以日期、主题、标题、摘要和阅读链接展示文章。英文列表明确标注 Chinese 并链接已确认的中文原文；未伪造英文正文或 hreflang。正文保留左侧目录、分享/PDF、SVG 图、交互表和分析图，以及简化后的 References。正式稿移除审阅标记和 noindex，设置真实 canonical，站内导航使用相对站点路径。

输入链为 Markdown/渲染器 → `node site/scripts/prepare-blog.mjs`（本地 Bun）→ `site/content/blog/vibe-repo-ops/` 及哈希清单 → 独立 Node 网站构建。修改已生成 HTML 的反例会被哈希校验拒绝；恢复后正常通过。发布副本 `output/site-release-20261019-jq-blog` 只复制 public、scripts、content、templates、package.json 和 vercel.json。该副本在没有根目录 docs 的情况下独立构建成功；Vercel 日志同样确认生成五个页面。

本地验证：五页面在 1440/390/320px 均无横向溢出，锚点完整，无脚本或资源错误；首页场景切换、方向键、行情配色、Overview 偏好、跨语言保留设置、英文列表进入中文文章、插图放大、图表口径切换、返回 Blog 均通过。使用现有 CSP 响应头进行本地检查。

线上复核：浏览器访问正式域名的五个页面均为 HTTP 200；五份线上 HTML 的 SHA-256 均与本地验收构建一致。文章四张架构图成功解码，18 条 References 存在，未发现脚本或资源加载错误；已保存并查看正式站手机 Blog 截图。证据位于 `output/playwright/blog-preview/production-*-jq*-20261019.png`，未上传到网站。

本次未执行 CLI/桌面全量 release gate，也未合并仓库分支；这是网站构建与发布验收。原博客清理、文档导航以及英文全文翻译仍独立保留。后续网站修改应从本次集成源继续，避免用尚未包含这些改动的旧 main 网站覆盖本次发布。

## 2026-10-19：References 简化预览（v13）

最新 Preview：<https://oh-my-quant-cmechn7tt-yangjing-s-projects.vercel.app>；部署 ID `dpl_FGGbRM4V3Y2vKrUrVqr1igMGwJrV`，CLI 返回 Ready。按用户反馈，References 删除插图来源说明和所有分组小标题，仅保留一个 References 标题与连续 18 条引文。英文 blog-skill 同步这一规则。

本地 Chromium 复核：References 恰有一个标题、一个列表、18 条引文；1440/390px 无横向溢出，已查看手机截图。部署包来自新目录 `output/vercel-blog-preview-20261019-v13`。稿件 SHA-256：`d760ef914479d85cd98d1e633a59b76c9ca14e0f9ec9f06fdc4e1ebd280fb38c`；HTML SHA-256：`a1de97b81b3fb32db0b2d947c7924c02493db7ca1ab23b8b1380e3e715d99314`，与本地检查版本一致。本次只更新 Preview，未合并；沿用上一轮的设计来源与访问保护。


## 2026-10-19：Repo Ops 合并博客临时 Preview

供用户确认后的合并审阅，不是正式发布。部署根路径 `/` 是中文合并稿；尚未生成英文译稿或注册正式博客导航。原来的三篇文章继续保留。

| 项目 | 记录 |
| --- | --- |
| Project | `yangjing-s-projects/oh-my-quant` / `prj_W6RAjHLVuwjdRdZ1pKFSRJj5ymvy` |
| Preview | <https://oh-my-quant-749iiz51o-yangjing-s-projects.vercel.app> |
| Deployment ID | `dpl_BLMvqeLj5894XNcdPJzcPLWkfFCZ` |
| 平台状态 | CLI 部署和随后 `vercel inspect` 均确认 `preview / Ready` |
| 来源 | `docs/blog/agentic/vibe-repo-ops-merged-draft.md`，分支 `docs/vibe-repo-ops-merged-draft` 的未提交审阅稿 |
| 基线 commit | `cc9c9354b6baf0d0ff71581cf93d43f813e5dbc6`；不能将此基线当作包含审阅稿的提交 |
| 稿件 SHA-256 | `4c09c86e2340ba06a57aa72fa6285aac565a78b2709970ae62033ba86fed068c` |
| 上传 HTML SHA-256 | `d986b89d6b4d641ac3c59f8036540c8b855d64ce561aa97cb78fad713a5a8cd6`；与本地浏览器验收文件一致 |
| 设计来源 | JQ 暖黑金设计 `10184e1a2ad99d976c33e6c55d6872d7083fe827` |
| 上传目录 | 独立生成的 `output/vercel-blog-preview-20261019-v12`，只包含文章 HTML、公开资产和静态部署配置 |
| 访问保护 | 保留项目 `all_except_custom_domains` 登录保护；Preview 可能要求账号登录 |
| Production | 部署后重新 inspect，仍为 `dpl_FyUtTYSevXScNQmAEeswu8W3JRU2`，正式域名未切换 |

本次将参考文献整理为 18 条连续编号引文，保留全部 67 个来源链接，项目的可借鉴点和限制改为引文下的独立说明。图源单列，视频参考保持普通链接。正文保留三张交互表、两张分析图和四张架构图；小练习仍在正文结尾、References 之前。对应约定写入英文 blog-skill。

已做本地 Chromium 检查：1440/1024/390/320px 无横向溢出，18 条引文和章节锚点完整，三张表的筛选、隐藏列及对比可用，两张图的统计口径和样本切换可用。无 JavaScript 时保留 18 条引文、三表 15 行和两张静态图。导出并检查 19 页打印稿，参考文献使用白底、连续编号与可点击来源。脚本语法和 Skill 校验通过。截图/PDF 位于 `output/playwright/blog-preview/references-v12-*`，未上传到 Preview。

验收范围是本地浏览器与 Vercel 平台部署状态；本次没有对部署 URL 执行在线页面抓取或端到端检查。未新跑业务 CI，也未据此更新正文中有明确日期的 Actions/分支保护历史快照。文档导览与旧稿删除继续等待用户确认。

复现：设置 `BLOG_PREVIEW_OUTPUT` 为一个新的空发布目录，执行 `bun run site/previews/vibe-repo-ops/build.ts`，核查资产后通过 `vercel link --yes --project oh-my-quant --scope yangjing-s-projects --cwd <目录>` 关联既有项目，再执行 `vercel deploy --target preview --yes --scope yangjing-s-projects --cwd <目录>`。生成的 `vercel.json` 在本部署中覆盖安装/构建命令为空、输出目录为 `.`，避免继承完整官网的 `node scripts/build.mjs` / `dist` 设置；项目默认设置未修改。

---

日期：2026-10-14。

## 已交付

- 同仓库的 `site/` 独立静态官网，按 `DESIGN.md` 的黑金色、Geist、左对齐与留白设计。
- 顶部 Feature 功能目录、Blog、文档、语言切换与安装入口；移动端折叠菜单。
- 首页和 Blog 均支持完整的中英文静态页面，Blog 当前显示待发布状态。
- 市场研究、组合比较、研究报告三种交互示意，明确标注合成数据。
- 设置分组切换、涨跌配色切换、Overview 显示开关、减少动态效果和本地偏好保存。
- npm / Bun 安装方式、复制安装与启动命令、FAQ、GitHub / npm / 文档入口。
- 自托管字体与 SIL OFL 许可证、独立构建、Vercel 部署配置及维护说明。
- 通用界面图标统一使用自托管 Lucide SVG；语言切换与外部资源入口采用纯图标，保留本地化辅助名称。

## Vercel 状态

| 项目 | 结果 |
|---|---|
| Vercel Project | `yangjing-s-projects/oh-my-quant` |
| 固定地址 | <https://oh-my-quant.vercel.app> |
| 当前 Production | <https://oh-my-quant-jgtln8kqj-yangjing-s-projects.vercel.app> |
| 首次部署 | <https://oh-my-quant-1psxo238y-yangjing-s-projects.vercel.app> |
| 初版 Preview | <https://oh-my-quant-nrhmr2uty-yangjing-s-projects.vercel.app> |
| 中英文 / Blog / Feature Preview | <https://oh-my-quant-7ju1lhceo-yangjing-s-projects.vercel.app> |
| Taste 优化 Preview | <https://oh-my-quant-2jf02y5f3-yangjing-s-projects.vercel.app> |
| Lucide 图标 Preview | <https://oh-my-quant-jiuumu8cy-yangjing-s-projects.vercel.app> |
| 首次部署 ID | `dpl_E8EauEqejxNkTHyiZMhQhaRcyuSh` |
| 初版 Preview ID | `dpl_73YG2NPS5WDHcoE67HrvrwgDcSXE` |
| 中英文 Preview ID | `dpl_5JdPM8WRqaEjJNaeDosWSFrfxsct` |
| Taste Preview ID | `dpl_Dha4GqhtD6HURtDQL3gsgufjqkMf` |
| Lucide Preview ID | `dpl_9fSRKRUPTomnyucvabyLF9E1d7ZE` |
| 当前 Production ID | `dpl_FyUtTYSevXScNQmAEeswu8W3JRU2` |
| 部署证据 | Vercel CLI 确认正式域名指向最新 Production，状态 Ready；本地构建生成 4 个语言页面与 6 类 public 资产 |
| 发布内容 | 仅从 `site/` 上传，未上传根目录业务代码、`.ohquant/` 或个人笔记 |

新项目首次执行 `vercel deploy --yes` 时，Vercel 自动将其设为 Production，并绑定固定地址。随后显式执行 `--target preview`，生成相同网页资产的独立 Preview。部署结果由平台状态确认；浏览器验证在本地完成，不据此宣称已做线上端到端检查。

2026-10-13 用户确认正式发布后，使用 `vercel promote dpl_5JdPM8WRqaEjJNaeDosWSFrfxsct --yes --scope yangjing-s-projects` 提升已验证的中英文 Preview。Vercel 生成 Production 部署 `dpl_ECpzN9wjDmhhr6TFnkMtf1sFswNL`。通过 `vercel inspect oh-my-quant.vercel.app` 确认固定域名已指向该部署，状态为 `production / Ready`；当前正式版包含中英文首页、Blog 与 Feature 目录。

同日完成 taste-skill 优化后，提升 Preview `dpl_Dha4GqhtD6HURtDQL3gsgufjqkMf`，平台生成 Production `dpl_33g58YmkQU1NnA9xPV8MWXZy9v4R`。再次通过 `vercel inspect oh-my-quant.vercel.app` 确认正式域名已切换，状态为 `production / Ready`。

2026-10-14 完成 Lucide 图标更新后，从已审查的暂存内容构建独立发布副本，避免混入工作区同时进行的文档迁移。提升 Preview `dpl_9fSRKRUPTomnyucvabyLF9E1d7ZE` 后，平台生成 Production `dpl_FyUtTYSevXScNQmAEeswu8W3JRU2`；`vercel inspect oh-my-quant.vercel.app` 确认正式域名已指向该部署，状态为 `production / Ready`。

当前通过 CLI 在 `site/` 目录部署，因此项目 Root Directory 为 `.`。**尚未连接 Git 自动部署**。若以后导入整个 GitHub 仓库，需把 Root Directory 改为 `site`；不要保持 `.` 后直接构建整个仓库。

## 验证

- `node --check site/public/app.js` 通过。
- `bun run --cwd site build` 通过；构建仅包含允许的公开文件。
- Chromium 浏览器交互验证通过：三类研究场景、方向键和 Home 标签导航、三组设置、行情与风险颜色隔离、Overview 隐藏、刷新保留偏好、恢复默认、减少动效、三种复制操作、FAQ、移动端菜单及 Escape 关闭。
- 1440、1024、768、390、320px 宽度均无页面横向溢出；所有站内锚点存在，系统 `prefers-reduced-motion` 生效。
- 本地页面控制台检查为 0 errors / 0 warnings。
- 人工查看桌面首屏、设置区和移动端截图。截图及本次浏览器检查脚本保存在工作区 `output/playwright/quant-site-*`，不进入发布包。

### 中英文与导航更新

- 构建生成 `/`、`/en/`、`/blog/`、`/en/blog/`；两种语言缺失文案时构建失败，页面元信息和运行时提示共用文案目录。
- Chromium 97 项检查通过，覆盖 Feature 的 Enter / Tab / Escape、点击外部关闭、功能跳转、Blog 空状态、语言切换保留章节与偏好、研究和设置标签、三种复制操作以及禁用 JavaScript 后的静态内容。
- 四个页面分别检查 1440、1024、820、768、760、520、390、320px，无页面横向溢出；英文正文无遗漏的中文文案。
- 补充检查桌面和手机切换时关闭旧菜单、无尾斜杠地址跳转、所有站内链接及章节存在、未知页面返回 404。
- 本地浏览器未出现脚本异常；人工查看英文 Feature 目录、手机菜单、英文首页和中英文 Blog 截图。

这些检查针对官网静态内容和浏览器交互，不代表 CLI、模型提供方或真实行情端点完成重新验收。

### Taste 优化复核

- 按 [设计复核](./DESIGN-REVIEW.md) 调整首屏、功能列表、正文与触控目标；没有新增运行依赖。
- 97 项中英文和交互检查再次通过；四页面的八个宽度均无横向溢出，保留原有功能。
- 补充 26 项检查：四页面的 canonical / Open Graph / hreflang、开关边缘点击、键盘焦点、减少动效及中英文手机控件的 44px 点击区域。
- 响应式菜单状态、路由重定向、所有站内链接和锚点、404 检查通过。
- 本地英文首页 Lighthouse 移动端模拟：Performance 91 / Accessibility 100 / Best Practices 100 / SEO 100。相对 hreflang 地址与可见标签的辅助名称问题已修复；分数仅代表本次本地运行。
- README 24 个链接及引用文件检查通过，使用 GitHub Markdown API 渲染后检查本地深色桌面和浅色手机排版。已刷新示例截图；不等同于实际 GitHub 页面端到端验证。
- 人工查看中英文首屏、功能、设置与移动端截图；检查脚本、截图和 Lighthouse JSON 位于本地 `output/`，不进入发布内容。

### Lucide 图标复核

- 使用 Lucide 0.577.0 的 21 个原始 SVG，集中在 `/icons.svg`，随站点附带上游许可证；不增加运行依赖。
- 97 项中英文和交互检查再次通过；新增 46 项图标与交互检查，合计 143 项。覆盖四个页面的图标引用与显示、语言入口辅助名称、菜单展开与关闭、键盘语言切换、FAQ、原生选择器及禁用 JavaScript 后的渲染。
- 四页面在八个宽度下均无横向溢出，本地浏览器未出现脚本异常；人工查看桌面 Feature 目录、中英文首屏和移动端菜单。
- 本地英文首页 Lighthouse 移动端模拟：Accessibility 100 / Best Practices 100。该结果仅代表本地检查，不等同于线上端到端验证。
- 更新 README 的官网示例截图；检查脚本、截图和 Lighthouse JSON 位于本地 `output/`，不进入发布内容。

## 后续维护

使用短期 `feat/website-*` 分支开发，合并回 `main`；无需建立长期官网分支或独立仓库。安装方法、命令或设置变更时，在同一 PR 更新官网和对应产品文档。部署命令见 [README](./README.md)。
