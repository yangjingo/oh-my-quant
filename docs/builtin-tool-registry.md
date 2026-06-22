# 内置工具注册表

> 最后更新：2026-06-17

WhyJ Quant 使用小型静态注册表管理内置 agent 工具。目标是在不将工具绑定分散到 agent facade、CLI helper 和 TUI 显示代码的前提下，使未来添加工具更加容易。

## 设计

`src/tools/registry.ts` 是内置工具发现的唯一入口。

它负责：

- agent 的启用工具顺序
- 工具领域元数据：`data`、`quant` 或 `system`
- 对话显示标签元数据
- 按工具名进行 CLI 查找
- 重复名称检查
- 缺失实现检查

它有意不实现动态插件加载器。内置工具随仓库发布，与应用一起类型检查，并以静态方式 import。

## 运行时流程

```text
工具实现
  -> src/tools/registry.ts
    -> BUILTIN_TOOLS
      -> src/agent/src/session.ts AgentHarness tools
    -> findBuiltinTool()
      -> src/cli/params.ts 直接 /skill 执行
    -> builtinToolDisplay()
      -> src/tools/catalog.ts TUI 转录标签
```

这保持四个层面的一致性：

| 层面 | 注册表 API | 用途 |
|---------|--------------|---------|
| Agent loop | `BUILTIN_TOOLS` | 传递给 `AgentHarness` 的精确工具列表。 |
| CLI 工具执行 | `findBuiltinTool(name)` | `/skill trigger` 和直接命令适配。 |
| TUI 标签 | `builtinToolDisplay(name)` | 稳定的转录标签，如 `Quant.Risk`。 |
| 诊断/测试 | `listBuiltinToolRegistrations(domain?)` | 检查组和启用顺序。 |

## 添加未来的内置工具

1. 将工具实现为 `AgentTool`。
2. 从对应的领域模块导出，例如 `DATA_TOOLS`、`COMPUTE_TOOLS` 或 `SYSTEM_TOOLS`。
3. 在 `src/tools/registry.ts` 中添加一条注册：

```ts
{
  tool: mustTool(COMPUTE_TOOLS, "new_tool_name"),
  domain: "quant",
  display: { label: "Quant.NewTool" },
}
```

4. 添加或更新 `src/tools/registry.test.ts` 中的测试。
5. 如果工具有非显而易见的行为，在领域文档（如 `docs/quant-tools-design.md`）中记录契约。

工具随即通过同一条注册记录对 agent、CLI 查找和 TUI 显示代码可用。

## 规则

- 不要在 `registry.ts` 外部直接拼接工具数组。
- 不要在 `registry.ts` 外部维护独立的静态显示映射。
- 仅当现有 `data`、`quant` 和 `system` 分组不再能描述该工具时，才创建新的领域模块。
- 保持标签简短；Conversation 面板的宽度有限。
- 仅对需要注册但暂不向 agent 暴露的实验性工具使用 `enabledByDefault: false`。
