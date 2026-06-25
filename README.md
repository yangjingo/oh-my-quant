# WhyJ Quant

交互式量化分析终端 — AI Agent 驱动，slash commands 操作，本地数据存储。

[![npm](https://img.shields.io/npm/v/whyj-quant)](https://www.npmjs.com/package/whyj-quant)

![WhyJ Quant terminal homepage](./docs/assets/terminal.png)

## Quick Start

全局安装：

```bash
npm i -g whyj-quant
whyj
```

本地开发：

```bash
bun install
bun run src/index.ts
```

首次启动后先打开配置面板：

```
Q > /config
```

在 `Config` 里设置：

- `API Key`: AI Agent provider key
- `Source`: 行情来源
- `Source Key`: 对应数据源密钥
- `Codex Skills` / `Claude Skills`: 是否把用户级 Codex/Claude skills 集成进 WhyJ Quant。默认关闭，只加载项目内核心量化 skills。

也可以直接写入默认配置文件 `.ohquant/settings.json`：

```json
{
  "version": 1,
  "env": {
    "WHYJ_QUANT_API_KEY": "sk-...",
    "WHYJ_QUANT_BASE_URL": "https://api.deepseek.com/anthropic",
    "WHYJ_QUANT_AUTH_TOKEN": "sk-...",
    "WHYJ_QUANT_TUSHARE_TOKEN": "your_token",
    "WHYJ_QUANT_FINANCIAL_DATASETS_KEY": "your_key",
    "WHYJ_QUANT_LLMQUANT_API_KEY": "your_key"
  },
  "model": "sonnet",
  "thinkingLevel": "high"
}
```

外部 skill 集成开关保存在 `.ohquant/settings.json`：

```json
{
  "skillIntegrations": {
    "codex": false,
    "claude": false
  }
}
```

配置完成后直接提问：

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
| `/doctor` | 检查 runtime、auth 来源和修复 hints |
| `/skill` | 查看、安装和运行 skills |
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

`doctor` 报告凭证是否存在、来源类别和 redacted value fingerprint；不会打印完整 secret。`whyj --json doctor` 和 `/doctor` 使用同一套报告逻辑。

## Docs

### Architecture & System

- [Agent System Spec](./docs/agent-system-spec.md) — full architecture, tool system, session management
- [pi Agent Loop & Harness](./docs/pi-agent-loop-harness.md) — harness lifecycle, compaction, queue drains, branch navigation
- [Agent Loop Context Assembly](./docs/agent-loop-context.md) — model-input vs UI-text assembly path
- [Module Architecture](./docs/module-architecture.md) — repo-level module boundaries and dependency direction
- [Storage Policy](./docs/ohquant-storage-policy.md) — local filesystem split: durable settings, cache, artifacts, forbidden state

### CLI & UX

- [CLI Design & Reference](./docs/interactive-cli-design.md) — slash commands, `src/cli/` module, implementation plan
- [Doctor, Config, and UX Guidelines](./docs/doctor-design-and-hints.md) — doctor checks, config flow, UX interaction, errors, guidance

### TUI

- [TUI Layout Design](./docs/tui-layout-design.md) — five-region frame-buffer layout and interaction model
- [TUI Table/Chart Render](./docs/tui-table-chart-render.md) — structured agent output rendering in the TUI
- [Design System (NewForm)](./DESIGN.md)

### Agent Tools & Skills

- [Built-in Tool Registry](./docs/builtin-tool-registry.md) — unified registration path for built-in agent tools
- [Quant Tools Design](./docs/quant-tools-design.md) — factor, backtest, risk, and benchmark as agent tools
- [Skill 系统](./docs/trader-skills.md) — skill 架构、安装、发现、CLI handler、TUI 集成及完整技能目录

### Data

- [Source Providers](./docs/source-data-providers.md) — official interfaces, source priority, agent/runtime injection
- [Source Module](./src/source/README.md) — provider adapters, fallback rules, module test layout

### 参考

- [量化资源索引](./docs/source-data-providers.md) — 数据源 provider、Python 库、API 参考（已合并至此）
- [Skill 系统](./docs/trader-skills.md) — 外部 skill 生态、AI 交易平台、学习资源（已合并至此）
- [Personal Notes](./notes/README.md) — 投资知识库：`notes.md`（原则/法则/框架）+ `funder.md`（16 位大师索引）+ `daily.md`（每日笔记）。其中 `notes.md` 和 `funder.md` 被 `/insight` 管道消费，自动生成为 Agent 思考时展示的投资格言
