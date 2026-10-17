# WhyJ Quant 模块架构

本文档是面向维护者的代码库地图。解释每个模块的职责、数据允许流动的方向，以及其他模块应使用的入口点。

这些边界为什么这样划分、组装层增加了什么成本，见 [模块与变化边界](../blog/09-boundaries-for-change.md)；产品工作流对架构的约束见 [研究终端的产品设计](../blog/08-research-workbench.md)。博客说明选择理由，本页维护当前依赖契约。

设计实际分为两个目录：[Agent Runtime](../agent-runtime/README.md)维护通用执行与会话生命周期；[Quant Harness](./README.md)包含完整量化应用的产品、数据、计算、执行、报告和 UI/UX。本页属于后者，维护其内部模块的依赖和组装；任务范围、证据与完成判据是这一应用体系中的研究编排核心。文档归属不改变代码依赖和授权边界，完整分类见[文档目录](../README.md#design)。

## 顶层布局

| 路径 | 角色 | 备注 |
|------|------|------|
| `src/cli/` | slash 命令解析、本地命令处理、JSON one-shot 模式 | 仅限本地 UI/session 控制 |
| `src/tui/` | 终端渲染、面板、输入、布局、显示组件 | 消费运行时事件；不应持有业务状态 |
| `src/app-runtime.ts` | TUI/CLI 到 agent session 和本地面板的桥接 | 编排 UI 状态刷新 |
| `src/app-watchlist.ts` | watchlist 应用服务 | 让 TUI 不直接访问 storage |
| `src/insight/` | 笔记生成与 storage-backed insight/quote 服务 | 拥有笔记读取与缓存服务；quant 不再转发此服务 |
| `src/quant/` | 显式数据上的计算与方法解释 | 公共入口为 `index.ts`，不取数、保存、读取笔记或运行工作流 |
| `src/agent/` | 上游 pi kernel 接入、WhyJ 会话适配、session facade | 持有 prompt loop、compaction、resume |
| `src/research/` | 分支研究状态与共享证据核验 | 参数/引用/重算独立于 Agent 与报告渲染，不调用实时数据源 |
| `src/performance/` | 私有账户区间业绩的只读历史端口与计算 | 只接收显式输入；文件读取归 CLI，私有年报组装归 runtime，不进入默认研究 Agent，见 [账户业绩](./performance.md) |
| `src/execution/` / `src/app/paper-execution/` | 独立订单端口 / 宿主显式选择的本地模拟盘 | 通用端口不持久化或读取凭证；paper 宿主在指定绝对目录保存私有账户/订单，合成成交由宿主注入，不进默认 Agent，见 [执行契约](./execution.md) |
| `src/tools/` | 内置 agent 工具 | 数据工具、量化工具、shell 工具、注册表 |
| `src/source/` | 行情数据 provider adapter 和回退编排 | 公共入口点为 `src/source/index.ts` |
| `src/market/` | 无 IO 的代码、日期和 Bar 规范化 | source/storage 共用，保留交易所与基金后缀身份 |
| `src/runtime/research/portfolio.ts` | 自定义组合编辑服务 | TUI 与 CLI 共用校验和增删改逻辑 |
| `src/runtime/quant-harness.ts` | 结构化研究任务宿主与工具执行守卫 | 组合现有 Session/Pi；任务事件仍存原 session，状态由 research/tasks 投影 |
| `src/tools/research-task-tool.ts` | 会话绑定的研究控制工具 | registry.bindResearchTools 组装，注入分支读口；成功结果提交事件，不在工具内等待自身 idle |
| `src/runtime/workspace/research-task-view.ts` / `src/tui/src/research-task-panel.ts` | 任务投影文本与只读终端面板 | `/resume --task` 经 AppRuntime 回调传入快照；渲染与按键不执行模型、行情或状态写入 |
| `src/runtime/data/analysis-data.ts` | 量化工具数据入口 | 按分析窗口自动取数 |
| `src/runtime/data/data-readiness.ts` | 数据连接诊断 | 明确市场/样本/窗口，仅探测所选源，无缓存或隐式保存；CLI/数据配置面板共用 |
| `src/runtime/data/data-settings.ts` | 数据配置草稿与验证生命周期 | 编辑使证据失效，取消隔离迟到结果；验证成功才生成可保存草稿，不直接持久化 |
| `src/runtime/data/tool-readiness.ts` | 工具能力投影 | 从实际 registry 检查市场、凭证、Python 依赖与日线样本范围，不执行工具 |
| `src/runtime/data/tool-probe.ts` / `tool-probe-draft.ts` | 端点响应检查与编辑生命周期 | CLI/TUI 共用；只调用所选 source adapter，复用基金参数 schema；固定配置快照、超时/取消、不持久化 |
| `src/tui/src/data-settings-panel.ts` | 数据编辑器 | 键盘/焦点/脱敏展示；PanelController 经 PanelDataService 保存，完成事件驱动 TUI 重绘 |
| `src/runtime/workspace/overview-refresh.ts` | Overview 周期/手动刷新生命周期 | 取消、超时、代次、状态和观测；AppRuntime 转发入口 |
| `src/runtime/workspace/overview-data.ts` | 本轮公开报价请求池与来源映射 | 最多 8 个活跃请求，跨指数/组合去重，可注入 source fetcher；无行情缓存 |
| `src/runtime/data/source-runtime.ts` | storage-backed source runtime adapter | 将 source 的可注入 cache/settings deps 绑定到 storage |
| `src/storage/` | `.ohquant` 持久化、缓存、session 摘要、显式 legacy portfolio 迁移 | 本地持久化状态规则的唯一位置；只暴露 resolver/API，不暴露 import-time path constants |
| `src/types/` | 共享领域契约 | 保持与 provider 无关 |
| `docs/` | 设计、架构、运维文档 | 将实现说明放在此处，而非埋在代码注释中 |

## 边界规则

1. `tui` 渲染状态；不决定 session 真值。
2. `cli` 处理确定性 slash 命令；自然语言转给 agent。
3. `agent` 持有 harness 生命周期、`compact`、`resume` 和 session 重建。
4. `tools` 是唯一可供 agent 调用的执行层。
5. `source` 获取并标准化 provider 数据；不决定 portfolio 语义。
6. `storage` 持有文件系统布局和去重/缓存规则；调用方不应手工拼接 `.ohquant` 路径。
7. `runtime` 负责把 source 的依赖注入接口绑定到 storage/settings；`source` 本身不导入 storage。
8. `execution` 只定义私有执行契约和调用边界；显式应用宿主可以持有独立执行服务账本，不能将其并入 `.ohquant` 公开行情/观察组合存储或默认研究上下文。

## 模块契约

### 功能替换与淘汰边界

- `performance`、`alpha`、`execution`、`extensions`、`skill`、`quant` 的跨模块生产依赖只通过各自 `index.ts`，包含类型导入和再导出；内部实现与测试夹具不成为公共契约。架构检查强制这六个模块的入口约束，其他旧模块仍按各自现有契约渐进收敛。
- 功能专属类型留在所属模块；只有确实跨域共享的契约进入 `types`。文件、凭证、存储和工具注册由宿主接线，计算模块不反向依赖宿主。`performance` 的依赖限定为自身、`quant`、`types` 与 `node:util`；文件历史适配器位于 `src/cli/account-history.ts`。
- 淘汰功能时先撤销宿主入口与注册，再删除功能实现及所属测试，并核对配置、持久化格式和历史会话读取的兼容策略；不能随功能删除自动清理用户数据。这是变更流程，当前没有删除任何产品功能。
- 生产代码不得引用 `test/`、`tests/`、测试文件或 `bun:test`；跨模块测试可以复用合成夹具。这些静态依赖检查不等于运行时插件沙箱。

### `src/quant/`

- `index.ts` 显式列出因子、回测、风险、基准、组合比较、基金定投、评分及方法解释的公共函数和类型；内部新增导出不会自动扩展公共接口。外部生产调用不直接引用实现文件。
- 只允许依赖自身、无 IO 的 market 规范化及共享数据契约；禁止依赖应用宿主、insight、Node/Bun IO、第三方 provider 和 CLI 结果类型。计算接收价格、日期和假设，返回计算结果，不发现配置或用户文件。
- `runtime/research/comparison.ts` 拥有取数、生成制品身份、时间与保存的编排，调用 quant 的分类/NAV/风险计算；`insight/generator.ts` 拥有笔记读取，`insight/index.ts` 继续负责提示语和缓存服务。quant 不再保留转发这些服务的旧入口。
- 模块测试与合成夹具集中在 `quant/test/`；insight 测试归 `insight/test/`，比较编排测试归 runtime。隔离回归只复制 quant、market 和 types 到临时目录，分别在 Bun 与 Node 下运行公共计算，无应用源码、依赖包或笔记数据。

### `src/runtime/`

根目录保留会话/扩展组装、私有执行命令和通用错误处理。业务服务按职责分组，不使用一个加载所有功能的总入口：

| 子目录 | 所有权 |
|---|---|
| `data/` | 行情入口、数据配置与端点能力诊断 |
| `models/` | 模型编辑、OAuth、Pi 导入与显式图片读取 |
| `skills/` | 预制安装根、目录选择与发现刷新 |
| `research/` | 有 IO 的研究服务、观察组、新闻与报告编排；区别于顶层 `research` 的证据重算 |
| `evidence/` | 根据提供的研究状态和文本核对回答；不依赖其他 runtime 分组 |
| `evaluation/` | 可选评测运行器及合成场景；其他生产模块不得反向引用 |
| `workspace/` | 命令目录、界面状态、Overview 生命周期和展示投影 |

runtime 不导入 CLI 或 TUI，包括类型。共享 `AppState`、`UIMessage`、面板与 HUD 数据契约归 `types/ui.ts`、`types/hud.ts`。CLI 与 TUI 消费这些契约及服务；`runtime/session.ts` 的 `createLocalAgent()` 组装默认本地会话，`agent` 的 `createAgent()` 必须接收完整依赖。

### `src/skill/`

- 只维护预制仓库、下载提交、技能名称和 Git 安装事务；通过 `index.ts` 暴露。
- `runtime/skills/skill-store.ts` 绑定安装根和缓存失效，`skill-discovery.ts` 供 CLI 与界面共用。
- `agent/src/skills.ts` 调用 Pi Coding Agent 的公开加载 API；目录扫描、元数据与忽略规则不再本地复制。
- `/skill install` 先展示选择，按名称下载并启用，`/skill remove` 持久化移除加载选择，`/skill reload` 刷新已安装内容；启动不自动下载。已移除逐技能文件哈希、Python/网络探针、运行资格与报告审计。
- 安装仍保护本地变更并处理取消；会话保留进行中资源快照。上游依赖与使用方法回到 `SKILL.md`。
- `runtime/skills/mcp-presets.ts` 维护 MCP 模板，`mcp-config.ts` 经 `agent/src/pi-mcp.ts` 复用 Pi 配置增删。`/mcp` 按需管理用户或项目配置并导出模板；连接、认证、加载与包缓存归 Pi。

### `src/source/`

- 职责：
  - 各 provider 特定的行情数据获取
  - 数据源回退顺序
  - 通过 `SourceRuntimeDeps` 接收可选缓存/settings hooks
  - Overview/TUI 的数据源归属文本
- 公共导入：
  - `src/source/index.ts`
- 内部分割：
  - `src/source/src/` 实现
  - `src/source/tests/` 模块测试

### `src/storage/`

- 职责：
  - 设置、bars 缓存、benchmark/comparison 制品、sessions、显式 legacy portfolio 迁移
  - 本地 portfolio 去重和精简摘要生成
  - `.ohquant` 策略执行
  - runtime path resolver：`resolveOhquantDir()`、`resolveDataDir()`、`resolveBenchmarkResultsDir()` 等
- 公共导入：
  - `src/storage/index.ts` 或依赖范围有意缩小时使用特定的 storage 模块

### `src/tools/`

- 职责：
  - 向 agent 暴露稳定的工具契约
  - 将工具 IO 转换为 domain/storage/source 调用
  - 干净地呈现面向用户的错误
- 规则：
  - 新的内置工具应通过 `docs/quant-harness/quant-tools-design.md#registry` 记录的注册表路径注册

### `src/agent/`

- 职责：
  - harness phase、运行循环、session tree、compaction、resume
  - system prompt/context 组装
- 规则：
  - UI 应调用 facade，不直接修改 agent 状态
  - `kernel/loop.ts` 唯一导入上游执行循环；`kernel/llm.ts` 唯一导入上游协议与模型目录
  - `model-config.ts` 解析配置；`session-state.ts` 映射事件；每个 Agent 自有 SessionCtx
  - `session-contracts.ts` 定义完整模型/工具/skills/repo/prompt/证据端口；`runtime/session-dependencies.ts` 组装默认本地 IO，`agent/src/session.ts` 消费端口与分支快照。独立替换与失败契约见 [Session 依赖注入](../agent-runtime/README.md#dependencies)
  - 架构 gate 禁止 `session.ts` 直接导入 storage、tools、source、tui；不以默认组装替代可注入宿主
  - `session-runtime/harness/operation.ts` 统一取消与完成等待；`session/compact-session.ts`、`navigate-session.ts` 管理独占会话操作
  - pi 两包精确锁定同一版本；架构检查禁止 TypeScript 路径别名覆盖和绕过 kernel 的协议实现导入

## 推荐的依赖方向

`agent` 和 `artifact` 共用 `research/input.ts` 的归档核验及七类计算重算；`research/state.ts` 消费结构化分支快照并生成内部状态，见 [研究状态](./README.md#research-state)。Research 只可向 quant、market、storage、types 依赖；低层和 TUI 不反向依赖 research。数据归档修订/缺失的判定在报告与恢复上下文中一致，新增核验逻辑无需依赖 HTML 或 TUI。

```text
cli/tui
  -> app-runtime
    -> agent
    -> storage
    -> tools

tools
  -> runtime/source-runtime
  -> storage
  -> market/types

source
  -> market/types

app services (`app-runtime`, `app-watchlist`, `insight`)
  -> storage
  -> source/tools/agent as needed

runtime/source-runtime
  -> source
  -> storage

storage
  -> market/types
```

避免反向依赖：`source` 和 `storage` 不应互相依赖，`tui` 不应直接依赖 provider adapter，也不应手工拼 `.ohquant` 路径。`tests/architecture/architecture-boundary-baseline.json` 当前为空，新增违规由 `bun run check:architecture` 阻止。

## 测试布局

将测试放在所验证模块的附近，但按模块分组：

- `src/source/tests/`
- `src/storage/test/`
- `src/tui/test/`
- `src/agent/test/`
- `src/performance/test/`
- `src/skill/test/`
- `src/quant/test/`（合成数据与独立数值参考在 `test/fixtures/`）
- `src/insight/test/`
- `src/cli/test/`（handler 测试在 `test/handlers/`）
- `tests/architecture/`（仓库级依赖边界、测试发现与开发入口回归）
- `tests/app/`（跨模块应用入口、启动、配置、研究、报告与恢复集成）

全部模块的测试布局由 `bun run test:fence` 强制检查：使用模块内 `test/`，现有 `source/tests/` 保留；app 内独立适配器使用各自的 `test/`。runtime、tools、research、market 的测试已集中，入口集成测试位于 `tests/app/`。测试进程与数据夹具归各自测试目录；评测运行器的合成场景仍属于可选 evaluation 功能，不作为单元测试夹具混入应用服务。

对于 provider bug，在修复之前或同时，在模块测试文件夹中添加回归测试。

## 开发入口与 npm 命令

2026-10-15 将原根目录脚本按职责迁入模块；跨模块测试放在根目录 `tests/`，不是发布代码的一部分。构建后的 npm 包仍只包含 `dist/` 和发布说明等公开文件，消费者运行 `whyj` 不需要这些开发入口。

| 位置 | 责任 |
|---|---|
| `src/cli/dev/` | CLI 构建、模型连接 smoke、Skill 命令和 reviewed 上游的显式核验 |
| `src/runtime/dev/` | 研究评测、数据编排、模型测量与 AKShare 参数签名生成；`overview/` 与 `chart/` 维护对应应用输入路径 |
| `src/tui/dev/`、`src/artifact/dev/` | 终端绘制/流写入/合成长对话 CPU 测量与合成报告生成；测量不证明实体终端输入延迟 |
| `src/source/dev/`、`src/quant/dev/` | 公共新闻 adapter 检查、独立 Decimal 数值参考复核 |
| `src/alpha/dev/`、`src/performance/dev/` | 显式真实引擎核验和合成账户计算示例 |
| `src/storage/dev/`、`src/skill/dev/`、`src/insight/dev/` | 会话 IO 基准、已留存证据包重算、Insight 生成 |
| `tests/architecture/`、`tests/app/` | 仓库工程门槛及跨模块回归，不承担产品功能 |

开发探针是模块的可选消费者，可能注入生产 adapter、合成夹具或显式请求真实服务。架构检查不把 `dev/` 按生产依赖规则约束，但禁止生产文件反向导入 `dev/` 或任意测试目录；[反向依赖回归](../../tests/architecture/module-boundaries.test.ts)和[打包闭包检查](../../tests/architecture/development-entrypoints.test.ts)分别核对源码边界与实际 CLI 构建。它们不获得 Agent 默认执行资格。

`npm test` 显式运行 `src` 与 `tests` 两个测试根，`npm run test:modules` 和 `npm run test:integration` 可分别执行。默认 Bun 发现同样排除 module dev、手动 Artifact 生成器、reference、desktop、site 和内部 output 等目录；不能为了检查文件迁移，顺带执行付费模型或真实市场脚本。根目录 `scripts/` 已退役，测试围栏要求目录不存在；迁移后未清理的旧缓存也会使该门槛失败。

跨模块子进程回归固定仓库入口与工作目录，不能依赖其他用例留下的 `process.cwd()`。Doctor CLI 测试只继承宿主进程必需变量，显式设置合成凭证、禁用网络并指定不存在的 Python；验证 Tools 缺依赖时仍返回结构化诊断，不要求维护者或 CI 预先安装 AKShare。真实依赖可用性另由显式 Doctor/探针验证。

常用入口为 `npm run dev`、`npm run build`、`npm start`、`npm test` 和 `npm run check`，具体范围及开发依赖见[英文 README](../../README.md#development)。npm 统一调度，底层构建和测试继续使用 Bun；本轮没有更换测试框架，也没有把脚本移动当成真实性验收。

## 当前文档

- [Quant UI/UX](./quant-uiux.md)
- [Quant Harness](./README.md)
- [Agent 运行时设计](../agent-runtime/README.md)
- [OhQuant 存储策略](./ohquant-storage-policy.md)
- [内置工具注册表](./quant-tools-design.md#registry)
- [数据源 Provider](./source-data-providers.md)
- [Skill 系统](./trader-skills.md)
