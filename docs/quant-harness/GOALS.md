# WhyJ Quant 产品目标

本页保留目标与范围；逐特性的已有实现、缺口和验收条件统一维护在 [PRD](./PRD.md)，实施顺序见 [roadmap](./roadmap.md)，文档入口见 [README](../README.md)。原始目标的特殊表述、重复快照核对及后续选择见 [目标来源与整理取舍](../blog/07-artifacts-and-boundaries.md#goals)。

## GOAL1：易用性与量化研究体验

### 配置与性能

- F01：交互选择模型、填写凭证，复用 Pi 的配置引导，统一配置来源；明确 Pi 文件互通和账号登录的兼容范围。
- F02：金融数据源、工具依赖与 API key 也有引导式配置。
- F03：自动测试 TTFT/TPOT，管理和设置上下文 HUD，显示可解释的性能结果。

### 金融终端与日常布局

- F04：以选定的 [workspace-design-reference.png](../assets/workspace-design-reference.png) 为参考，统一面板、字体呈现和克制的皮肤设计；具体规范以根目录 DESIGN.md 为准。
- F05：布局贴合 quant 的日常研究工作。
- F06：统一金色层级、淡色、间隔与涨跌红绿语义。
- F07：简化 slash，评审每个命令与 quant 术语的对应及可发现性。

### 数据、组合、研究与输出

- F08：可靠、分级、自动取数；提升刷新速度，追溯来源，及时更新，不展示错误或过时信息为最新数据。
- F09–F10：管理自定义观察组合，支持自主操作与组合对比。
- F11：结合原文 `yhoo`（暂按 Yahoo 理解）的情绪和走势，形成有依据的调整建议。
- F12–F13：典型因子、技术指标、风险和策略分析；计算正确性是研究的前置要求。
- F14–F15：自动生成 Artifact，并发展为金融分析师年度报告；结合投资大师观点，保留出处与推演边界。
- F16：便于拓展实盘执行工具。按 PRD 第 8 节保留的用户选择，本阶段先留好文档和接口；当前实现和验收见 [执行契约](./execution.md#2026-10-13f16-当前范围与接口验收)。真实服务/账户接入另行选定和授权。

## GOAL2：Quant Harness 与可插拔模块

- F17：设计 extensions 结构，提供插件管理与可选能力。
- F18–F19：参考 coding harness，在 runtime 形成量化专用 Harness，明确 loop、goal、tool、skill、data 的职责；每次模块化说明解决的量化场景问题。
- F20：设计研究上下文、压缩和恢复，保持对象、参数、证据与目标连续。
- F21–F22：存储与 Harness 共同定义持久化、数据及时性及 portfolio 私有状态边界。
- F23：默认集成精选 quant skills，用户能看见安装与依赖状态。
- F24：统一常用工具注册与能力说明，在 prompt 中正确装配 tools/skills，验证调用效果。

## 文档与项目表达

- F26：合并重复设计，移出过时正文。保留三条阅读线：**产品与交付、Quant Harness、Quant UI/UX**；文件按 [目录](../README.md) 的八类职责登记。原文列出后两类，第一类用于承载 GOALS、PRD、roadmap、验收和项目介绍，不增加产品功能。
- F27：生成 [slides.html](../slides.html)，围绕产品、技术决策、实现和踩坑认知介绍项目；展示已有能力与规划的区别。

后续产品网站（2026-10-13 确认）：包含产品介绍、Docs、Blog、用户手册与 Demo。视觉统一以 [DESIGN](../../DESIGN.md) 为准；内容分工与公开边界见 [网站内容入口](../README.md#website-content)。当前已准备英文根 README、中文任务手册、博客和更新后的讲解演示；网站、在线交互 Demo 与部署尚未实施，不计为新的功能完成。

## 保留的历史需求

F25：保留旧 roadmap 的 alpha/akquant 引擎探索及固定输入、成本、版本和失败语义要求；[需求来源与取舍](../blog/09-boundaries-for-change.md#alpha)单列说明。当前实现与验收见 [Alpha / AKQuant](./alpha-backtest.md) 和 PRD F25，不沿用早期「尚未接入」的现状判断。
