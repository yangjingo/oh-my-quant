# 08｜桌面优先之后，CLI 如何延续同一份研究？

Agent Engineering / oh-my-quant · 初稿 2026-10-13 · 修订 2026-10-21 · 产品形态与架构演进

用户今天比较两组标的，明天再问“换一个基准会怎样”。在终端里可以接着说，换到桌面应用以后，研究还能接得上吗？如果需要重新输入日期、解释数据来源、寻找旧报告，我们交付的就只是两个入口，而不是一份能够继续的工作。

本文以当前实现为起点，讨论已经选择的维护方向：**优先维护 Desktop，同时保留 CLI**。当前 `desktop/` 仍是 Electron 中的终端宿主；下面的 `apps/cli`、`apps/desktop`、共享包和独立桌面界面均是改造提案，尚未实施。目录与发布方法仍以[模块架构](../quant-harness/module-architecture.md)和[桌面宿主文档](../quant-harness/desktop.md)为准。

## 一次研究，为什么要在两种界面里延续？

自然语言适合尚未成形的问题。用户可以先表达研究意图，再逐步明确对象、窗口、币种和基准。但一段回答不是全部研究状态：下一次工作还需要知道采用了哪个组合版本、哪些数据能重算、报告固定了什么，以及失败后有没有可用的草稿。[产品范围与验收](../quant-harness/product-guide.md#requirements)因此把主要路径串成“配置 → 获取数据 → 分析与比较 → 报告 → 恢复”。

已有[键盘流程回归](../../src/tui/test/research-workflow.test.ts)经过设置自动报告、维护两组观察标的、带日期与基准的比较、`/clear` 和报告恢复。这条路径提醒我们：局部的取数、计算、导出都成功，仍不保证研究能连续进行。恢复必须保留原数据引用与报告版本，不能为了“打开成功”悄悄换成今天的数据。

两种入口并非两份独立产品。CLI 仍适合终端研究、明确的 JSON one-shot 读取和可组合命令；Desktop 优先承担安装、发现、配置与长时间工作的体验。这里优先的是日常产品迭代与体验验收，不是取消 CLI 的兼容、测试或发布维护。桌面应用让用户不必先组织终端环境，也给对象、参数与报告更稳定的展示位置；这仍是需要验证的产品判断，不是已经测得的效率提升。

真正应该共享的是研究事实，而不是窗口布局。配置快照、会话分支、任务条件、数据引用和报告身份应有一致解释；焦点、滚动、面板展开和暂时的输入状态属于各自界面。强行复用整个 TUI 布局会限制桌面体验，复制业务逻辑又会让两个入口产生不同答案。我们需要的是同一套约束下的两种投影。

## 终端复用降低了成本，也划出了桌面体验的边界

当前方案有充分的合理性。[桌面构建](../../desktop/scripts/build.ts)把根 `src/index.ts` 编译成随包运行的 WhyJ，Electron [主进程](../../desktop/src/main.ts)通过 node-pty 启动它。[Bridge](../../desktop/src/bridge.ts)主要传输终端输入、尺寸、输出和确认，再提供剪贴板、工作目录与链接能力。复用既有 CLI/TUI，减少了研究行为分叉，也避免要求桌面用户先安装整套开发工具。

但终端字符流不是研究对象协议。Renderer 接到输出，不能据此可靠地拿到“当前报告版本”“配置保存代次”或“这次失败的请求身份”。如果下一步需要可点击的数据来源、并列比较的报告、独立设置页，就不能用解析屏幕文字来构造第二份业务状态。保留 PTY 作为过渡入口合理，把它当成独立桌面工作台的完整边界则不够。

共享核心也还没有自然长出来。`src/runtime/` 已经受不依赖 CLI/TUI 的架构约束，但顶层 [AppRuntime](../../src/app-runtime.ts)仍导入 CLI 目录/执行器以及 TUI 的 `CurrentSessionMeta` 类型。把它原样放进 `packages/core`，只会把终端依赖换一个名字。必须先分开应用服务、命令适配与界面回调，再讨论包边界。

因此，问题不是把 `desktop` 改叫 `app`。`src/app/` 已经容纳显式选择的模拟执行与账户宿主；再增加一个单数 `app/` 会混淆“可发布产品”与“领域宿主适配器”。`apps/cli` 和 `apps/desktop` 更清楚地表达两个产品入口，但迁移目录本身不会解除上述依赖，也不会获得新的用户体验。

## 把桌面做成工作台，让两端共享研究事实

我们的候选终态如下。它是用于讨论责任的地图，不是本 PR 的文件移动清单；其中 `packages/quant-harness` 也不是把所有领域代码合成一个无边界总包。

```text
apps/
  desktop/    Electron main、preload、renderer 与桌面打包
  cli/        公共 whyj 命令、JSON 入口与终端适配
packages/
  agent-runtime/   通用会话、模型循环与生命周期
  quant-harness/   量化应用服务、领域模块与显式契约
tests/
  architecture/   仓库依赖与入口边界
  integration/    跨模块、跨入口的行为契约
  e2e/            实际产品工作流，按端分别验收
docs/
  agent-runtime/
  quant-harness/
  blog/
site/         产品网站、Docs、Blog、手册与公开 Demo
```

沿用[现有文档划分](../README.md#design)，Agent Runtime 负责通用会话运行机制；数据、计算、执行、报告、产品与 UI/UX 均属于 Quant Harness 的应用体系。文档归属不要求所有界面代码住在同一个共享包：具体渲染留在各 app，跨界面确实复用的状态契约和应用服务再进入共享层。现有 `source`、`storage`、`quant`、`execution` 的依赖与授权规则仍需保留。

桌面工作台应围绕意图、对象和结果组织，而不只是增加页面。研究对话承接探索；对象区明确观察分组、日期、币种与基准；报告区固定版本与来源，并能返回对应会话。准备、运行、取消、空结果和失败要分别可见，不能都呈现为一个停止转动的加载图标。观察 Portfolio 仍不是用户真实持仓，研究完成也不授予下单权限。[界面职责](../quant-harness/quant-uiux.md)、[执行边界](../quant-harness/execution.md)、[账户业绩](../quant-harness/performance.md)

![研究工作流由准备、研究、留存和继续构成；聊天负责表达意图，本地控制负责确定动作，固定报告与分支支持恢复。](./images/08-workbench.svg)

*图 8：沿用研究连续性示意，解释两端应共同维护的工作链；不是新桌面界面的截图，也不是上述目录已经迁移的证明。*

进程边界同样不能由视觉布局决定。Electron main 管理窗口、宿主资源与后台运行的生命周期；preload 只开放有限、带类型和参数校验的能力；renderer 不直接读取凭证、文件或启动 Python。这与 Electron 的[进程模型](https://www.electronjs.org/docs/latest/tutorial/process-model)一致，当前已有[隔离设置](../../desktop/src/main.ts)和 [preload](../../desktop/src/preload.ts)，但它们并不证明未来业务接口已经实现。共享应用服务应由可信宿主接线。究竟放在 main、独立后台进程还是 utility process，采用哪种传输协议，还需要结合取消、崩溃恢复与打包成本验证，本文不预先承诺 JSON-RPC 或某个框架。

目录改造按三个可停止的阶段推进，每一步都应独立可回退：

| 阶段 | 先交付什么 | 必须保住什么 |
| --- | --- | --- |
| 入口归位 | 先迁 `apps/cli` 与 `apps/desktop`，共享实现暂留根 `src/`；同步构建、测试、CI 和安装路径 | npm 包名与 `whyj` 命令、Electron appId、用户数据目录、安装更新与历史读取 |
| 一条工作链贯通 | 从 AppRuntime 分离应用服务；先让配置保存、状态投影与诊断消费同一已提交配置快照及其保存代次，再接研究、取消、报告恢复 | 旧 PTY 可以继续工作；renderer 不解析字符流充当业务接口，不新增重复真值；共享工作区先限定单写者，并发保护验收前不开放两端同时写入 |
| 边界稳定后成包 | 再形成 Agent Runtime / Quant Harness 工作区；迁移测试和发布配置 | 无 GUI 的 CLI 可独立构建/运行，领域内部入口约束不被总包抹平 |

**后续前端实现的交接约束。** 根据 [PR #22 的归属讨论](https://github.com/yangjingo/oh-my-quant/pull/22#issuecomment-6193433860)，网站继续由 `site/` 独立维护；本阶段不迁网站，也不把真实研究工作台放进官网。正式产品界面归 `apps/desktop` 的 renderer，窗口、preload、系统能力与打包归桌面宿主。共享实现第一阶段仍可留在根 `src/`；“入口归位”不等于把研究服务、计算、Source 或 Storage 搬进 renderer。

[PR #27](https://github.com/yangjingo/oh-my-quant/pull/27) 的 `src/app/research-workspace/web/` 与本地 HTTP 服务是已声明的过渡验证入口，不是最终产品目录。后续正式前端应依赖本方案和入口迁移：浏览器界面归 renderer，开发用 HTTP/SSE 入口作为宿主适配器，研究编排和状态契约独立于传输与界面。桌面接入复用这些服务，不复制研究逻辑；仅修改目录或注释不足以证明接入完成。入口迁移、研究闭环和桌面打包分别验收，保持 CLI/npm 命令、appId、用户目录和历史数据兼容。

当前说明确定职责与迁移顺序，不确定前端框架、业务进程或 IPC 协议。[Issue #29](https://github.com/yangjingo/oh-my-quant/issues/29) 的技术栈仍是讨论项；网站上线、本地浏览器验证与 Desktop 实际打包运行必须分别记录。本方案合入只交付架构依据，后续实现继续通过对应 Issue/PR 验收。

未来根 package 可以成为 private workspace 编排器，以 `dev` 优先启动 Desktop、`dev:cli` 显式启动 CLI；公共 `whyj-quant` 仍由 CLI 产品发布。[npm workspaces](https://docs.npmjs.com/cli/v11/using-npm/workspaces/)可以管理本地包与命令，但不会自动解决依赖方向。现在没有必要同时发布十几个 npm 包，也不应在入口尚未清楚时引入统一插件平台。这些脚本与发布调整都属于后续实现，不改变本轮现行 README 命令。

## 先减少工作中断，再决定拆到哪一层

这次得到的是维护方向、责任边界和可分步验证的路线，而不是已经交付的独立桌面 UI。原连续工作流在 2026-10-09 的 F05 范围内完成过本地布局与流程验收；它不能外推为“两端共享工作区”或首次真实账号到任意研究均通过，本轮也没有重跑历史模型与行情验收。

还有一个不能藏起来的成本：共享服务不等于已经共享磁盘。当前桌面默认使用自己的用户数据目录，CLI 也可能指向不同工作区。让两个客户端恢复同一份研究，需要明确选择同一工作区，并在开放同时写入之前规定写入所有权、冲突和文件格式兼容。不能因为改了目录，就自动合并凭证、账户或用户存档，也不能默许两个进程同时覆盖设置。第一阶段不迁移用户数据。本轮没有实现或验收跨端共享工作区及并发写入保护；手动指向相同目录也不能充当完整支持的证明。

后续实现应以完整任务验收，而不是以迁了多少文件验收：

- 桌面首次安装可启动与完成配置，不要求另行安装 Bun 或 Node；Python 能力缺失能被明确解释，而非冒充已可用。
- 保存数据配置后，诊断、研究工具与两端状态投影使用同一已提交快照；旧请求迟到不能把显示改回旧版本。
- 取消不发布“完成”报告，输入与可恢复工作仍可达；空数据与服务失败有不同反馈。
- 明确选择同一工作区后，两端恢复同一报告身份与原数据引用；故障与并发冲突不静默覆盖历史。
- CLI 在无桌面依赖的环境中继续支持既有命令与 JSON 契约，升级安装保留既有用户状态。

这些是待实现的验收条件，不是本篇博客的运行成绩。独立完成比例、反复输入次数和隔天恢复损失也需要先建立基线，目前没有可信的提升数字。

如果用户的主要工作仍是提示、读取报告和终端操作，现有 PTY 可能继续是成本最低的方案。只有当对象控制与研究恢复反复被字符流限制时，独立 renderer 才有足够理由承担新的状态协议、交互测试和发布成本。Desktop-first 不意味着越早重写越好；它意味着让下一次工程投入优先修复桌面用户的真实中断，并用 CLI 的兼容约束守住共享事实。

## 实现索引

- 当前产品与宿主：[产品范围与验收](../quant-harness/product-guide.md#requirements)、[Desktop](../quant-harness/desktop.md)、[main](../../desktop/src/main.ts)、[Bridge](../../desktop/src/bridge.ts)、[构建](../../desktop/scripts/build.ts)。这些链接定位现状，不是未来 apps 目录的实现证据。
- 当前边界与待解耦点：[模块架构](../quant-harness/module-architecture.md)、[AppRuntime](../../src/app-runtime.ts)、[通用运行时](../agent-runtime/README.md)。
- 可复用的验收基础：[连续键盘流程](../../src/tui/test/research-workflow.test.ts)、[配置](../quant-harness/configuration.md)、[报告与恢复](../quant-harness/artifacts-design.md)。
- 相关讨论：[布局与视觉语言](./10-layout-and-visual-language.md)、[功能发现](./11-discoverable-interactions.md)、[失败后的继续工作](./12-recovery-as-ux.md)。

[← 上一篇](./07-artifacts-and-boundaries.md) · [下一篇：模块边界 →](./09-boundaries-for-change.md)
