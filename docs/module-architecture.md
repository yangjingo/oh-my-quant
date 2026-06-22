# WhyJ Quant 模块架构

本文档是面向维护者的代码库地图。解释每个模块的职责、数据允许流动的方向，以及其他模块应使用的入口点。

## 顶层布局

| 路径 | 角色 | 备注 |
|------|------|------|
| `src/cli/` | slash 命令解析、本地命令处理、JSON one-shot 模式 | 仅限本地 UI/session 控制 |
| `src/tui/` | 终端渲染、面板、输入、布局、显示组件 | 消费运行时事件；不应持有业务状态 |
| `src/app-runtime.ts` | TUI/CLI 到 agent session 和本地面板的桥接 | 编排 UI 状态刷新 |
| `src/agent/` | vendored pi harness wrapper、运行时上下文、session facade | 持有 prompt loop、compaction、resume |
| `src/tools/` | 内置 agent 工具 | 数据工具、量化工具、shell 工具、注册表 |
| `src/source/` | 行情数据 provider adapter 和回退编排 | 公共入口点为 `src/source/index.ts` |
| `src/storage/` | `.ohquant` 持久化、缓存、session 摘要、portfolio 发现 | 本地持久化状态规则的唯一位置 |
| `src/types/` | 共享领域契约 | 保持与 provider 无关 |
| `docs/` | 设计、架构、运维文档 | 将实现说明放在此处，而非埋在代码注释中 |

## 边界规则

1. `tui` 渲染状态；不决定 session 真值。
2. `cli` 处理确定性 slash 命令；自然语言转给 agent。
3. `agent` 持有 harness 生命周期、`compact`、`resume` 和 session 重建。
4. `tools` 是唯一可供 agent 调用的执行层。
5. `source` 获取并标准化 provider 数据；不决定 portfolio 语义。
6. `storage` 持有文件系统布局和去重/缓存规则；调用方不应手工拼接 `.ohquant` 路径。

## 模块契约

### `src/source/`

- 职责：
  - 各 provider 特定的行情数据获取
  - 数据源回退顺序
  - 带缓存感知的实时数据刷新
  - Overview/TUI 的数据源归属文本
- 公共导入：
  - `src/source/index.ts`
- 内部分割：
  - `src/source/src/` 实现
  - `src/source/tests/` 模块测试

### `src/storage/`

- 职责：
  - 设置、bars 缓存、comparison 制品、sessions、本地 portfolio 发现
  - 本地 portfolio 去重和精简摘要生成
  - `.ohquant` 策略执行
- 公共导入：
  - `src/storage/index.ts` 或依赖范围有意缩小时使用特定的 storage 模块

### `src/tools/`

- 职责：
  - 向 agent 暴露稳定的工具契约
  - 将工具 IO 转换为 domain/storage/source 调用
  - 干净地呈现面向用户的错误
- 规则：
  - 新的内置工具应通过 `docs/builtin-tool-registry.md` 记录的注册表路径注册

### `src/agent/`

- 职责：
  - harness phase、运行循环、session tree、compaction、resume
  - system prompt/context 组装
- 规则：
  - UI 应调用 facade，不直接修改 agent 状态

## 推荐的依赖方向

```text
cli/tui
  -> app-runtime
    -> agent
    -> storage
    -> tools

tools
  -> source
  -> storage
  -> types

source
  -> storage
  -> types

storage
  -> types
```

避免反向依赖：`storage` 不应依赖 `source`，`tui` 不应直接依赖 provider adapter。

## 测试布局

将测试放在所验证模块的附近，但按模块分组：

- `src/source/tests/`
- `src/storage/*.test.ts`
- `src/tui/test/`
- `src/agent/test/`

对于 provider bug，在修复之前或同时，在模块测试文件夹中添加回归测试。

## 当前文档

- [CLI 设计与参考](./interactive-cli-design.md)
- [Agent System Spec](./agent-system-spec.md)
- [pi Agent Loop 与 Harness](./pi-agent-loop-harness.md)
- [OhQuant 存储策略](./ohquant-storage-policy.md)
- [内置工具注册表](./builtin-tool-registry.md)
- [数据源 Provider](./source-data-providers.md)
- [Skill 系统](./trader-skills.md)
