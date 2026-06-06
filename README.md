# WhyJ Quant

交互式量化分析终端 — AI Agent 驱动，slash commands 操作，本地数据存储。

[![npm](https://img.shields.io/npm/v/whyj-quant)](https://www.npmjs.com/package/whyj-quant)

![WhyJ Quant terminal homepage](./docs/assets/terminal.png)

## Quick Start

```bash
npm i -g whyj-quant
whyj
```

第一条命令 — 无需任何配置，bundle 了示例数据：

```
Q > /data info --symbol 000001.SZ
```

输出平安银行的 OHLCV 快照。要启用 AI Agent 分析，配置 API key：

```bash
# .env 文件 (项目根目录)
ANTHROPIC_API_KEY=sk-ant-...
TUSHARE_TOKEN=your_token        # A 股数据 (可选)
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
| `whyj --json doctor` | 检查 runtime、配置目录、auth 来源、MCP 配置发现 |
| `whyj -c "/help"` | 执行单条 slash command 后退出 |
| `whyj --json -c "/factor list"` | 执行单条 slash command 并输出 JSON envelope |

Slash commands:

| 命令 | 说明 |
|------|------|
| `/data download --symbol CODE` | 下载并缓存行情数据 |
| `/data info --symbol CODE` | 股票/基金快照 |
| `/factor list` | 查看可用因子 |
| `/factor analyze --symbol CODE --factor NAME` | 单因子分析 |
| `/backtest run --symbol CODE --fast 20 --slow 60` | 双均线回测 |
| `/risk check --symbol CODE` | 风险指标 |
| `/benchmark run --symbol CODE` | 策略评分 |
| `/add stock --code CODE --name NAME` | 加入自选 |
| `/add list` | 查看自选 |
| `/benchmark dashboard` | 策略跑分看板 |
| `/config` | 配置向导 |
| `/mcp connect` | 连接数据源 |
| `/help` | 命令参考 |

兼容入口仍可用：`/skill`、`/claw`、`/watch`。

无 `/` 前缀直接输入自然语言 → AI Agent 分析。

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

- [CLI Manual](./docs/cli-manual.md)
- [Agent System Spec](./docs/agent-system-spec.md)
- [Design System (NewForm)](./DESIGN.md)
