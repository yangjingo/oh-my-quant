# OhQuant 存储策略

ohmyquant 遵循与 Codex 和 pi 风格 agent 相同的本地文件系统分层：持久化用户设置、可重算的缓存、显式制品和禁止访问的私有状态各自独立。

## 模块结构

```
src/storage/
├── index.ts              # barrel re-export，统一对外接口
├── src/                  # 实现
│   ├── dirs.ts           # 路径常量 + ensureDirs
│   ├── settings.ts       # settings CRUD（load/save/normalize/migrate）
│   ├── watchlist.ts      # watchlist CRUD
│   ├── env-keys.ts       # WHYJ_QUANT_* 环境变量别名体系
│   ├── fs-events.ts      # 文件事件发布订阅
│   ├── policy.ts         # 存储策略定义 + 守卫
│   ├── bars.ts           # 行情数据缓存（.ohquant/data/）
│   ├── sessions.ts       # session 摘要列表 + 上下文用量估算
│   ├── comparison.ts     # benchmark 制品（.ohquant/benchmark/comparisons/）
│   ├── panel-portfolio.ts# Overview Portfolio symbol 列表 CRUD
│   ├── local-portfolios.ts# 遗留 portfolio 文件发现（迁移用）
│   ├── portfolio.ts      # portfolio 门面（含废弃桩 + panel-portfolio 代理）
│   └── artifacts.ts      # artifact HTML 文件 CRUD
└── test/                 # 测试
    ├── sessions.test.ts
    ├── comparison.test.ts
    ├── portfolio.test.ts
    ├── local-portfolios.test.ts
    └── env-keys.test.ts
```

## 目录分类

| 路径 | 类别 | 可缓存 | 规则 |
|------|-------|-----------|------|
| `.ohquant/settings.json` | durable | 否 | 用户配置、模型偏好、后端开关、脱敏的认证引用和 skill 集成设置。env key 通过 `canonicalizeWhyjEnv()` 规范化为 `WHYJ_QUANT_*` 前缀。 |
| `.ohquant/watchlist.json` | durable | 否 | Composer 自动补全 symbol 列表。 |
| `.ohquant/panel-portfolio.json` | durable | 否 | Overview Portfolio symbol 列表（仅代码/名称）。实时报价在刷新时获取。 |
| `.ohquant/data/{source}/{symbol}/` | cache | 是 | 公开或数据源提供的行情数据（`daily.json`）和元数据（`meta.json`）。可安全地重新获取和替换。 |
| `.ohquant/cache/` | cache | 是 | 带 TTL 语义的短生命周期派生制品。 |
| `.ohquant/benchmark/comparisons/` | artifact | 否 | 分组对比结果（`cmp-{date}-{time}.json`），由 `Quant.Benchmark` 工具显式生成。 |
| `.ohquant/benchmark/results/` | artifact | 否 | 内置 `Quant.Benchmark` 工具生成的显式策略评分输出。 |
| `.ohquant/sessions/` | artifact | 否 | JSONL 格式的 agent session 转录。`listStoredSessions()` 解析 session tree 并计算上下文用量摘要（tokens/contextWindow/percent）。 |
| `.ohquant/artifacts/{session-id}.html` | artifact | 否 | 自包含 HTML 文件，从 session JSONL 派生。可重新生成，可安全删除。详见 [Artifacts 设计](#artifacts)。 |
| `.ohquant/portfolio/` | forbidden | 否 | 持仓、净值快照、配置和个人仓位不得缓存或从本地文件推断。`local-portfolios.ts` 仅用于一次性遗留迁移，不建立对该目录的持续依赖。 |

## 可缓存性规则

仅缓存可以安全重算或重新获取的数据，且不编码用户的私密财务头寸：

- 可缓存：行情数据、公开元数据、因子输入、临时后端响应、派生的 benchmark 中间结果。
- 持久化但不可缓存：设置和 watchlist，因为它们是用户主动编写的偏好。
- 制品但不可缓存：session 和 benchmark 结果文件，因为它们是显式输出。
- 禁止访问：portfolio 持仓、净值历史、配置、交易历史、仓位大小、成本基础和任何推断的个人风险敞口。

## Env Key 别名体系

所有应用管理的环境变量使用 `WHYJ_QUANT_*` 前缀，定义在 `src/storage/src/env-keys.ts`：

| 别名 Key | 环境变量名（取第一个存在的值） |
|----------|---------------------------|
| `authToken` | `WHYJ_QUANT_AUTH_TOKEN` |
| `apiKey` | `WHYJ_QUANT_API_KEY` |
| `baseUrl` | `WHYJ_QUANT_BASE_URL` |
| `tushareToken` | `WHYJ_QUANT_TUSHARE_TOKEN`, `TUSHARE_TOKEN` |
| `financialDatasetsKey` | `WHYJ_QUANT_FINANCIAL_DATASETS_KEY`, `FINANCIAL_DATASETS_KEY` |
| `llmquantApiKey` | `WHYJ_QUANT_LLMQUANT_API_KEY`, `LLMQUANT_API_KEY` |

`canonicalizeWhyjEnv()` 用于 settings normalize 时，将用户配置（可能包含旧别名）映射到统一的 `WHYJ_QUANT_*` 主键名。透传非 WhyJ 前缀的自定义键。

## Session 上下文用量

`listStoredSessions()` 在解析 JSONL session 文件时，会额外计算当前分支的上下文用量：

- 沿 `parentId` 链重建从 session root 到最新 leaf 的分支
- 调用 `buildSessionContext()` + `estimateContextTokens()` 估算 token 数
- 通过 `getModels()` 查找对应模型的 context window
- 返回 `StoredSessionContextUsage`（tokens / contextWindow / percent）

此计算依赖 `agent/src/pi/` 中的 session 模型和 compaction 工具，是 storage → agent 方向的单向引用。

## Artifacts

Artifacts 将 WhyJ Quant agent session 导出为自包含、可交互、可分享的 HTML 网页。设计参考 [Claude Code Artifacts](https://claude.com/blog/artifacts-in-claude-code)（2026-06-18，Beta）。

### 存储规格

| 属性 | 值 |
|------|-----|
| 路径 | `.ohquant/artifacts/{session-id}.html` |
| 类别 | artifact |
| 格式 | 单文件 HTML，内联 CSS + JS，零外部依赖 |
| 大小 | 无硬限制；Phase 1 截断至最近 50 条消息 |
| CSP | 严格：无 fetch / XHR / WebSocket；图片可以 `<img>` 外链但不内嵌 base64 |
| 生成 | 由 `src/artifact/src/generator.ts` 从 session JSONL 派生 |
| 版本 | 快照模式，不自动更新；重新导出即覆盖 |

### 存储操作

`src/storage/src/artifacts.ts`：

- `saveArtifact(sessionId: string, html: string): void` — 写入 HTML 文件，发出 WRITE 事件
- `loadArtifact(sessionId: string): string | null` — 读取 HTML 文件
- `listArtifacts(): ArtifactMeta[]` — 列出所有已生成的 artifact，含 sessionId、createdAt、title
- `deleteArtifact(sessionId: string): boolean` — 删除 HTML 文件，发出 DELETE 事件

### 可缓存性

Artifact 文件是**显式制品**（artifact class），不可缓存但可安全重算：

- 可从 session JSONL 完全重新生成（幂等）
- 用户或 agent 主动触发生成，非自动缓存
- 不包含个人持仓或私密财务数据（仅复制 session 中已有的对话内容）
- 不提交 git（`.ohquant/` 已在 `.gitignore` 中排除）

### 色彩与设计系统

Artifact HTML 的视觉 token 直接映射自 `src/tui/src/styles.ts` 和 `DESIGN.md`：

| 终端 token | CSS custom property | 用途 |
|-----------|-------------------|------|
| `GOLD` `#E8B339` | `--whyj-accent` | 标题、焦点、选中态 |
| `CREAM` `#F2EEE6` | `--whyj-ink` | 正文 |
| `MUTED` `#9B968C` | `--whyj-muted` | 次要注释、弱化元数据 |
| `HAIRLINE` `#2B2722` | `--whyj-divider` | 分隔线 |
| `CANVAS` `#0B0B0C` | `--whyj-canvas` | 背景 |
| `POSITIVE` `#1E9F4D` | `--whyj-positive` | 正值/盈利 |
| `NEGATIVE` `#E5494D` | `--whyj-negative` | 负值/回撤 |

完整设计见 [Artifacts Design](./artifacts-design.md)。

## Portfolio 规则

Portfolio 数据仅限实时访问。命令可以请求它、从实时 provider 接收它，或在当前请求的内存中使用它，但不得将其写入 `.ohquant/`，也不得读取遗留的 `.ohquant/portfolio/` 文件。

`local-portfolios.ts` 读取 `.ohquant/portfolio/holdings*.json` 的唯一目的是支持一次性遗留迁移（import legacy → panel-portfolio.json）。迁移完成后不建立对该目录的持续读依赖。

现有的本地 `.ohquant/portfolio/` 文件被视为遗留用户文件。应用不会自动删除它们，也不再读取或写入它们（除非主动触发迁移）。

## TUI 可见性

所有 `.ohquant` 本地文件系统活动应流经 storage、`src/cli/` 或 agent tools，并发出 file event。READ/WRITE 可视化属于 agent/tool-call conversation stream，而非右侧边栏：

- `READ`：设置、watchlist 自动补全、行情缓存、benchmark 结果、session 读取。
- `WRITE`：设置、watchlist、行情缓存、benchmark 结果、session 转录写入。
- `MKDIR`：由存储初始化或缓存写入创建的本地状态目录。
- `DELETE`：遗留数据迁移清理。

TUI 渲染器不应直接调用 `fs`。Overview dock 由 `AppRuntime` 刷新：它读取 `.ohquant/panel-portfolio.json` 获取 Portfolio symbol，并通过数据 provider 获取实时报价。`.ohquant/watchlist.json` 仅用于 Composer 自动补全。
