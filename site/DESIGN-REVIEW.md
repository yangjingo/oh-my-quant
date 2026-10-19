# 官网设计复核

2026-10-13，按用户指定的 [taste-skill](https://github.com/Leonxlnx/taste-skill/tree/d237dd399d57524945c0c81327da5da19f7a468d) 优化现有官网与仓库 README。

采用 [主页设计规则](https://github.com/Leonxlnx/taste-skill/blob/d237dd399d57524945c0c81327da5da19f7a468d/skills/taste-skill/SKILL.md) 和 [现有项目改版规则](https://github.com/Leonxlnx/taste-skill/blob/d237dd399d57524945c0c81327da5da19f7a468d/skills/redesign-skill/SKILL.md)。项目的视觉真源仍是 [DESIGN.md](../DESIGN.md)。

## 设计判断

这是面向研究者和开发者的产品介绍页。方向是简洁、克制的黑金视觉，以清晰的文字层级和可操作的产品演示建立理解。

- 设计变化程度 `5/10`：调整信息编排，沿用品牌和交互。
- 动效程度 `3/10`：按钮反馈、已有终端光标；取消入场位移。
- 营销内容密度 `3/10`：首屏四层信息，段落保持合适行宽。终端示例保留实际数据界面的密度。

## 审查与调整

| 原有问题 | 调整 |
|---|---|
| 首屏左右两组文案重复表达产品理念 | 单一标题、简短说明、开始使用与演示入口；安装按钮统一使用现有导航文案 |
| 章节编号、英文小标签和底部宣言重复出现 | 移除营销区重复标签；工作流保留有顺序意义的步骤编号 |
| 三个功能使用相同大小分栏 | 左侧章节说明，右侧逐项展开功能；手机自然变为单列 |
| 正文、设置帮助和 FAQ 在手机上偏小 | 提高字号与行距，增加段落均衡换行 |
| 语言、菜单、复制与开关的点击区域偏小 | 主要控件至少 44px；保留开关的紧凑视觉尺寸 |
| 按钮有悬停效果但缺少按下反馈 | 增加轻微缩放，继续支持键盘焦点与减少动效偏好 |
| Blog 空状态使用无内容意义的 `[00]` | 使用中英文“即将发布”状态，保留真实空目录 |
| README 安装入口靠后、文档表格关系不明确 | 快速开始提前；文档按使用、原理和阅读分组 |

## 保留的约束

黑金、Geist / Geist Mono、左对齐、自托管字体、纯静态 HTML/CSS/JS，以及现有圆角用途均继续沿用。行情红绿和风险语义独立于品牌色。产品演示使用明确标注的合成数据，不添加装饰性行情或生成截图。

首页和 Blog 的四个语言路由、章节 ID、导航标签、演示标签、设置、复制、FAQ 与本地偏好保持可用。减少动效同时覆盖控件的伪元素。

SEO 基线：四个页面原有的标题含义、description、Open Graph 文案与 `lang` 保留；标题分隔符统一为 `|`。Lighthouse 发现 `hreflang` 使用相对地址，改为正式域名的完整 URL，并补充对应页面的 canonical / `og:url`。未改变页面地址或内容分类。

无障碍复核同时修正了语言按钮可见文字和辅助名称不一致的问题；品牌链接使用其可见品牌名作为辅助名称。

README 使用 GitHub 原生 Markdown；保留真实安装命令、官网链接和演示说明。没有为排版引入第三方运行依赖。

验证和发布结果见 [部署记录](./DEPLOYMENT.md)。

## 2026-10-19 · Restore the reviewed Download section

The blog integration initially copied committed JQ design files and missed the uncommitted Download work in `feat/website-warm-preview`. The reviewed Hero2 composition and Desktop/CLI options are now ported to the existing static template system. Native radio inputs, details and download links preserve the no-JavaScript fallback; the existing script handles command copying. The warm gold/bronze background, adjacent desktop options and mobile selector follow that source. Chinese remains at `/` and English at `/en/`; Features remains English in both headers. The separate homepage conversation redesign and workspace gallery are outside this restoration.
