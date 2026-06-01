# Changelog

## [0.1.0] - 2026-06-25

首个重新梳理后的 WhyJ Quant 版本。本版本按当前 TypeScript/Bun 代码线重新定义为新的 `v0.1.0`，旧发布记录不再作为当前发布口径。

### Added

- 交互式量化分析终端：`whyj` 启动全屏 TUI，支持自然语言提问、slash commands、状态栏、组合面板、历史会话恢复和结构化输出渲染。
- Shell 入口与 one-shot 模式：支持 `whyj --help`、`whyj -c "/help"`、`whyj --json doctor` 和 `whyj --json -c "/portfolio"`。
- `.ohquant/` 本地存储体系：统一管理 settings、行情缓存、组合状态、session JSONL、artifact 输出和恢复索引。
- AI Agent runtime：接入 pi agent core/harness，支持 streaming、工具调用展示、session 持久化、resume、compact、system prompt skills block 和本地 skill runtime。
- Provider 与认证体系：支持 Anthropic Messages、OpenAI-compatible 等模型 provider 路由，并统一 API key、base URL、auth token 与行情 source credential 的读取逻辑。
- 数据源模块：提供 AKShare、Tushare、Financial Datasets、LLMQuant 等 source adapters，以及显式 source 参数、fallback flow 和 provider smoke test。
- 内置量化工具：注册 `Quant.Factor`、`Quant.Backtest`、`Quant.Risk`、`Quant.Benchmark` 与数据工具，覆盖因子、回测、风险、benchmark 和组合对比工作流。
- Portfolio 与 Insight 工作流：支持本地组合面板、基金分组、自动分类、组合对比、投资格言生成与思考区提示。
- Artifact 模块：可从 session JSONL 生成双栏 HTML 分析 dashboard，并包含敏感信息 redaction、轨迹渲染和测试样例。
- Doctor 诊断：新增 `/doctor` 和 `whyj --json doctor`，检查 runtime、配置目录、auth 来源，并输出安全的修复 hints。
- 文档体系：补充 agent loop、CLI、doctor、storage policy、source providers、built-in tool registry、quant tools、TUI layout/table/chart render、artifact design 等设计文档。

### Changed

- 代码线重新定义为 TypeScript + Bun + frame-buffer TUI，旧 Python/skills 原型和旧 Ink/React UI 不再作为当前发布基础。
- CLI command registry、TUI panel、storage、source、quant、agent harness 按模块边界重构，减少 legacy bridge、MCP adapter 和旧 service implementation。
- 配置从散落的 `.env`/旧 config 口径收敛到 `.ohquant/settings.json`，同时支持配置面板与 JSON 输出中的 secret redaction。
- TUI 渲染契约更新为结构化 text/table/chart/skill-call 展示，改善 CJK 宽度、分隔线表格、图表颜色、工具调用预览和面板 loading 状态。
- README 与中文文档改为描述当前可用的 `whyj` 安装、启动、配置、commands、JSON policy 与架构入口。

### Fixed

- 修复 provider routing：显式 source 参数不再被 fallback chain 覆盖，Anthropic/OpenAI-compatible endpoint 路由和认证来源保持一致。
- 修复 session persistence 与 resume 进度同步，减少恢复历史会话时的状态错乱。
- 修复 TUI doctor 输出、panel rendering、divider-only table parsing、figure/chart rendering、组合状态栏数据源标签和 agent busy guard 等交互问题。
- 修复 one-shot 与 TUI doctor 输出不一致，统一 JSON envelope 和人类可读输出路径。

### Release Notes

- npm 包名：`whyj-quant`
- CLI binary：`whyj`
- 版本号：`0.1.0`
- 发布前建议执行：`bun run typecheck`、`bun test src/`、`bun run build`
- 如需重新建立 Git tag，建议在确认工作区 clean 后创建新的 `v0.1.0` tag；旧 tag 可保留为历史，不纳入本次发布说明。
