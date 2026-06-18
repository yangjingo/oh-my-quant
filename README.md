# WhyJ Quant

交互式量化分析终端 — AI Agent 驱动，slash commands 操作，本地数据存储。

[![npm](https://img.shields.io/npm/v/whyj-quant)](https://www.npmjs.com/package/whyj-quant)

![WhyJ Quant terminal homepage](./docs/assets/terminal.png)

## Quick Start

```bash
npm i -g whyj-quant
whyj
```

第一步先打开配置面板选择数据源：

```
Q > /config
```

在 `Config` 里设置：

- `API Key` 用于 AI Agent
- `Source` 用于行情来源
- `Source Key` 用于对应数据源密钥

然后可以直接提问做分析：

```bash
# .env 文件 (项目根目录)
ANTHROPIC_API_KEY=sk-ant-...
TUSHARE_TOKEN=your_token        # A 股数据 (可选)
FINANCIAL_DATASETS_KEY=your_key # 美股直连数据 (可选)
LLMQUANT_API_KEY=your_key       # 美股/HK 直连数据 (可选)
```

然后：

```
Q > 分析平安银行的动量因子和风险指标
```

## Commands

Shell-level commands:

| 命令 | 说明 |
|------|------|
| `whyj` | 启动交互式 REPL |
| `whyj --help` | 查看 CLI 入口帮助 |
| `whyj --json doctor` | 检查 runtime、配置目录、auth 来源 |
| `whyj -c "/help"` | 执行单条 slash command 后退出 |
| `whyj --json -c "/portfolio"` | 执行单条 slash command 并输出 JSON envelope |

Slash commands:

| 命令 | 说明 |
|------|------|
| `/portfolio` | 本地组合对比面板 |
| `/resume` | 恢复历史 session |
| `/compact` | 压缩当前 session |
| `/config` | 配置面板 |
| `/clear` | 清空当前对话 |
| `/help` | 命令参考 |

无 `/` 前缀直接输入自然语言 → AI Agent 分析。因子、回测、风险与策略评分由 agent 调用内置 Quant tools（`Quant.Factor`、`Quant.Backtest`、`Quant.Risk`、`Quant.Benchmark`）完成；行情拉取与缓存由 agent 通过已配置的 `Source` 自动处理。

## Dev

```bash
bun install
bun run src/index.ts
bun run src/index.ts -- -c "/help"   # one-shot mode
bun run src/index.ts -- --json doctor
```

## JSON Policy

`--json` 输出稳定 envelope：

```json
{
  "ok": true,
  "command": "skill",
  "message": "human-readable summary",
  "data": {}
}
```

错误不会打印密钥：

```json
{
  "ok": false,
  "command": "skill",
  "error": {
    "code": "command_failed",
    "message": "safe error message"
  }
}
```

`doctor` 只报告 token 是否存在以及来源类别：`env`、`config` 或 `missing`。

## Docs

- [CLI Design & Reference](./docs/interactive-cli-design.md) — slash commands, `src/cli/` module, implementation plan
- [Agent System Spec](./docs/agent-system-spec.md)
- [Module Architecture](./docs/module-architecture.md) — repo-level module boundaries and dependency direction
- [Built-in Tool Registry](./docs/builtin-tool-registry.md) — how future built-in agent tools are registered
- [Source Providers](./docs/source-data-providers.md) — official interfaces, source priority, and agent/runtime injection path
- [Source Module](./src/source/README.md) — provider adapters, fallback rules, module test layout
- [Design System (NewForm)](./DESIGN.md)
