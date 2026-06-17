# Built-in Tool Registry

> last-updated: 2026-06-17

WhyJ Quant uses a small static registry for built-in agent tools. The goal is to make future tools easy to add without scattering tool wiring across the agent facade, CLI helpers, and TUI display code.

## Design

`src/tools/registry.ts` is the single entry point for built-in tool discovery.

It owns:

- enabled tool order for the agent
- tool domain metadata: `data`, `quant`, or `system`
- conversation display label metadata
- CLI lookup by tool name
- duplicate-name checks
- missing-implementation checks

It intentionally does not implement a dynamic plugin loader. Built-in tools are shipped with the repo, typechecked with the app, and imported statically.

## Runtime Flow

```text
tool implementation
  -> src/tools/registry.ts
    -> BUILTIN_TOOLS
      -> src/agent/src/session.ts AgentHarness tools
    -> findBuiltinTool()
      -> src/cli/params.ts direct /skill execution
    -> builtinToolDisplay()
      -> src/tools/catalog.ts TUI transcript labels
```

This keeps four surfaces aligned:

| Surface | Registry API | Purpose |
|---------|--------------|---------|
| Agent loop | `BUILTIN_TOOLS` | The exact tools passed to `AgentHarness`. |
| CLI tool execution | `findBuiltinTool(name)` | `/skill trigger` and direct command adapters. |
| TUI labels | `builtinToolDisplay(name)` | Stable transcript labels such as `Quant.Risk`. |
| Diagnostics/tests | `listBuiltinToolRegistrations(domain?)` | Check grouping and enabled order. |

## Adding a Future Built-in Tool

1. Implement the tool as an `AgentTool`.
2. Export it from the matching domain module, for example `DATA_TOOLS`, `COMPUTE_TOOLS`, or `SYSTEM_TOOLS`.
3. Add one registration in `src/tools/registry.ts`:

```ts
{
  tool: mustTool(COMPUTE_TOOLS, "new_tool_name"),
  domain: "quant",
  display: { label: "Quant.NewTool" },
}
```

4. Add or update tests in `src/tools/registry.test.ts`.
5. If the tool has non-obvious behavior, document the contract in a domain doc such as `docs/quant-tools-design.md`.

The tool is then available to the agent, CLI lookup, and TUI display code through the same registration.

## Rules

- Do not concatenate tool arrays directly outside `registry.ts`.
- Do not keep a separate static display map outside `registry.ts`.
- Prefer a new domain module only when the current `data`, `quant`, and `system` groups no longer describe the tool.
- Keep labels short; the conversation panel has limited width.
- Use `enabledByDefault: false` only for experimental tools that should be registered but not exposed to the agent yet.
