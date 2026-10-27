# WhyJ Quant 模块架构

更新：2026-10-26。产品见[PRD](../prd.md)，交互见[UI/UX](../quant-harness/uiux.md)，进展见 Issues/PR。

## 当前顶层布局

| 位置 | 职责 |
|---|---|
| `src/index.ts`、`src/cli/` | 现有启动与业务命令、JSON 单次调用；CLI 入口迁移仍待 #76 |
| `apps/tui/` | 终端布局、输入与面板；包含源码、测试和探针，不持有会话真值 |
| `apps/web/` | 共享 React 界面及客户端端口；Host 待接入 |
| `src/app-runtime.ts`、`src/app-watchlist.ts` | 应用组装与动作；AppRuntime 仍使用界面回调，共享会话投影类型归 `src/types` |
| `apps/desktop/` | Electron main/preload、PTY/xterm 与安装包 |
| `src/app/research-workspace/` | HTTP/SSE、研究管理器与原生 Web UI；不是目标 Host |
| `src/app/paper-execution/` | 显式私有模拟盘宿主与独立账本 |
| `site/` | 独立静态官网，不连接本地研究数据 |

共享代码仍在 `src/`：agent/runtime 管运行，research/quant/market 管证据与计算，source/storage 管数据，tools/skill/extensions 管能力，artifact/insight 管报告与笔记，performance/execution/alpha 管私有业绩、执行与回测。跨模块契约归 types，专属类型留在模块；详细机制见[模块导览](../quant-harness/README.md)。

<a id="current-web"></a>

当前 Web 原型的运行与取消由独立[研究宿主](../../src/app/research-workspace/manager.ts)管理，未保存进度只在内存中：页面刷新可接回，服务重启则只从显式保存的对话和固定证据重建上下文，不重放完整 journal 或自动获取新行情。关闭浏览器只断开订阅，不停止任务。首次研究须有结构化发布结果才能保存，后续解释型对话不冒充新研究；复核另开会话取证并关联旧版本。这些现状边界不能由下方目标 Host 的恢复承诺代替。

React 入口边界见 [Web 模块](../quant-harness/web-ui.md)；Host 尚未接入。

## 当前依赖契约

1. UI 经 facade 交互，不直接修改 Agent、调用 provider 或拼接 `.ohquant` 路径。`runtime` 不导入 CLI/TUI，包括类型；`AppState`、`UIMessage` 等共享契约归 `types`。
2. `quant` 仅依赖自身、无 IO 的 market 和共享类型，不依赖宿主、provider、文件、insight 或 CLI 结果类型。比较取数/身份/保存归 runtime，笔记读取归 insight。
3. source/storage 不相互导入。source 接受 cache/settings 注入，`runtime/data/source-runtime.ts` 绑定 storage；调用方经 storage resolver/API 定位文件。
4. `agent` 接收模型、工具、skills、repo、prompt 和证据端口，默认 IO 在 `runtime/session-dependencies.ts` 组装。`session.ts` 不直接依赖 storage/tools/source/tui；Pi 循环与协议只经 kernel 接入，版本精确对齐，禁止别名绕过。
5. `research` 可依赖 quant、market、storage、types，低层和 TUI 不反向依赖它。Agent/Artifact 共用归档核验；成功工具结果与事件提交绑定，工具不能等待自身 idle。
6. performance、alpha、execution、extensions、skill、quant 的跨模块生产导入只经 `index.ts`，含类型与再导出。performance 不读文件；私有历史适配归 CLI，年报组装归 runtime。执行账本不进入公开行情、组合存储或默认研究上下文。
7. 生产代码不依赖 `dev/`、测试/夹具或 `bun:test`。删除功能先撤入口，另验旧格式/会话兼容，不能顺带删除用户数据。静态依赖检查不是插件沙箱。

runtime 的 evidence 不依赖其他分组，evaluation 是可选消费者；命令目录、Overview 生命周期及展示投影归 workspace。复用[工具注册表](../quant-harness/quant-tools-design.md#registry)。

Pi 负责技能扫描、模型索引及 MCP 连接/认证；skill 负责安装事务，runtime 绑定路径、缓存失效和 MCP 模板，Agent 保留在途快照。安装保护用户修改，不恢复旧资格/审计体系，见[技能契约](../quant-harness/community-tools.md)。

## 目标目录：先拆职责，再迁入口

**图 1 · 多入口与共享执行层（待迁移目标）**

箭头表示调用而非完整 import 图；虚线为无需 Host/TUI 的单次命令。Web 为共享界面。

```mermaid
flowchart TB
  subgraph apps["apps / Entry and presentation"]
    CLI["cli / Launch modes"]
    TUI["tui / Terminal UI"]
    Desktop["desktop / Electron shell"]
    Web["web / Shared React UI"]
    CLI -->|interactive| TUI
    Desktop -->|load| Web
  end
  subgraph src["src / Shared execution"]
    Host["app / Host and bootstrap"]
    Commands["commands / Business commands"]
    Services["app / Application services"]
    Runtime["runtime / Dependency wiring"]
    Agent["agent / Session and loop"]
    Quant["quant + market / Pure computation"]
    Source["source / Providers"]
    Storage["storage / Journal and artifacts"]
    Host --> Services
    Commands --> Services
    Services --> Runtime
    Runtime --> Agent & Quant & Source & Storage
  end
  CLI -->|web mode: start or connect| Host
  CLI -.->|one-shot| Commands
  TUI -->|shared run| Host
  Web -->|HTTP / SSE| Host
  classDef entry fill:#f5f1e8,stroke:#9a793b,color:#282622
  classDef shared fill:#f2f2f0,stroke:#77766f,color:#282622
  class CLI,TUI,Desktop,Web entry
  class Host,Commands,Services,Runtime,Agent,Quant,Source,Storage shared
```

`whyj` 由 `apps/cli` 启动 `apps/tui`；`whyj -c "…"` 执行单次命令，不加载 TUI；`whyj web` 连接或启动 Host 后打开 Web；桌面图标由 Electron 加载同一 Web UI。TUI 保留自绘实现，不意味着改用 Ink，也不新增命令或独立发行包。

Desktop 已迁目录，关窗仍退出；Host 接入待 #47/#48，CLI 待 #76。

先提取 AppRuntime 的无界面服务，再接入口；业务状态和执行不反向依赖 apps。UI 可基于已审阅契约先行，完整交付依赖真实 Host；持久化与取消语义在接口设计时确定。本阶段不拆领域 packages、不迁移用户数据。同步 bin、构建、安装与测试发现，保留 CLI/npm 契约、Electron appId、用户目录及历史读取，再撤旧入口。

GUI 采用 React＋TypeScript＋Vite，服务采用 Bun HTTP/SSE；不假定 Bun API 可在 Electron Node 运行，不另建 IPC 业务传输。Electron renderer 禁用 Node，保留 sandbox、context isolation、CSP；preload 仅开放受校验的原生能力。

## 目标服务与 Host 契约

入口持有参数、焦点、窗口与订阅；应用服务拥有研究操作与身份/状态；Host 管执行所有权与连接；journal/storage 管已提交事件及不可变成果。[共享 Host 契约](./host.md)集中定义接口、实例兼容、锁/就绪、认证、关窗/退出和恢复边界，仍待对应 Issue 实现。

交付顺序为 #51 → #46 → #75 → #76 → #50 → #47 → #105/#77 → #78 → #48/#56。#98/#102 的现有工作应复用，#105 的对话连续性不等于 #77 的工作流恢复；具体前置条件与验收见[顺序表](./host.md#顺序复用与完成条件)。#78 可先补测试发现，跨入口验收在真实能力到位后执行。

单次 CLI 可直调无界面服务；同一工作区的共享运行通过 Host 维持唯一所有者。帮助/版本不启动 Host。关窗、退订和显式取消分别处理；停止后端需明确影响范围。全机退出、OS daemon 与休眠期间继续运行不在本轮承诺中。

## 测试布局

测试在 `src/<module>/test/`（保留 `source/tests/`）、`apps/tui/test/` 与 `tests/app/`；默认/watch/模块测试及类型检查覆盖 TUI，`dev` 探针不自动执行。[依赖回归](../../tests/architecture/module-boundaries.test.ts)覆盖 `src`/`apps`，除启动桥接外禁止共享层导入入口；[入口回归](../../tests/architecture/development-entrypoints.test.ts)验证发现与构建，违规基线为空。

后续目标：服务测试在 `src/app/services/test`，CLI 启动测试在 `apps/cli/test`。`tests/contracts` 复用直调服务与 Host API 的身份、状态和错误断言，验证单次命令不加载 TUI。

`tests/e2e` 用真实 Host、临时工作区和假模型贯通 Web 提交 → Desktop 接回 → 关窗继续 → CLI 取消 → 拒绝晚到事件，另验保存/追问及恢复不重复副作用。发现规则、依赖围栏和 CI 随迁移同步。

## 开发入口与 npm 命令

`dev` 保持 CLI/TUI，`workspace:dev` 运行旧研究宿主；`web:dev` / `web:demo` 运行共享 React 界面及显式演示。目标新增 `dev:web`（Host＋Vite）、`dev:desktop`（再加 Electron），均须有就绪、日志和退出清理。

工具保留各模块 `dev/`：构建归 cli，测量/评测归 runtime，绘制/报告归 tui/artifact，IO 基准归 storage。根 `scripts/` 已退役；探针不进入默认 Agent 能力。子进程回归固定 cwd、隔离配置并使用假服务。

`npm test` 覆盖 src/apps/tui/tests；`web:check` 验 Web 类型、测试及生产包不含演示数据，两者均纳入发布门槛。保留必需 CI 汇总检查，完整门槛 `bun run check:release` 见[CI/Release](../ci-release.md)。Linux 另验命令、JSON、退出码及无 GUI 运行；Windows 在干净目标机对同一候选哈希验安装、升级与数据保留；macOS 另验构建、原生依赖、签名/公证与安装升级，不能沿用 Windows 结论。
