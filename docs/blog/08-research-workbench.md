# 08｜换一个入口，如何继续同一份研究？

Agent Engineering / oh-my-quant · 初稿 2026-10-13 · 修订 2026-10-22 · 产品形态与架构演进

**TL;DR**：产品有两种形态：Desktop 面向 Windows/macOS 用户，CLI/TUI 面向 Linux 专业用户。CLI 已有可延续的命令与研究基础；Web 是共享界面和开发/验证入口。下一阶段选择 React UI 和 Bun HTTP/SSE Host，先明确执行所有权，再迁移薄入口。以下是目标与待验证契约，不是新桌面已完成的声明。

## 换了界面，研究为什么会断？

用户今天比较标的，明天再问“换一个基准会怎样”。重新输入日期、解释来源、寻找报告，意味着之前的工作没有被新入口接住。自然语言能承接意图，却不能替代组合版本、数据引用、会话分支和运行身份。[产品指南](../prd.md)因此围绕配置、取证、报告与继续研究组织，而不是按窗口拆成几份产品说明。

已有[键盘流程回归](../../src/tui/test/research-workflow.test.ts)覆盖设置、观察组合、研究、清空与恢复。这些检查约束原有行为，不能证明新的 GUI 或跨入口流程已交付。打开旧报告必须保留原数据与版本，不能为了“恢复成功”悄悄换成今天的数据。保存成果也不意味着中断的任务能继续执行。

两种形态服务不同的使用习惯。Linux 专业用户沿用已有 CLI/TUI 做终端研究、确定性单次读取与脚本组合；Windows/macOS 用户通过 Desktop 安装、配置和持续研究。它们复用研究契约，各自维护交互体验；不能因为桌面改造而把 CLI 变成临时过渡。当前安装包覆盖 Windows，macOS 仍需独立交付验收。浏览器用于共享 UI 的开发、验证与可选访问；官网 `site/` 只承载公开内容和演示。

## 复用终端解决了启动，却没有形成对象协议

当前[桌面构建](../../desktop/scripts/build.ts)打包同一 CLI，[主进程](../../desktop/src/main.ts)通过 node-pty 启动它，[Bridge](../../desktop/src/bridge.ts)交换终端输入、尺寸与输出。这样能保留原有研究行为，也减少用户安装开发环境的负担。当前关窗仍退出 CLI，不能把未来的托盘保活写成已有能力。

字符流没有稳定表达“报告版本”“配置保存代次”和“请求身份”。若从屏幕文字推断这些对象，独立设置页、来源链接和报告比较就会形成另一份业务状态。现有 `src/app/research-workspace/` 已验证本地 HTTP/SSE 研究入口，但仍有自己的生命周期和资源限制，不等于已完成统一 Host。

共享代码也存在耦合。[AppRuntime](../../src/app-runtime.ts)仍导入 CLI 执行器与 TUI 类型；直接放进 `packages/core` 不会解除终端依赖。早期方案先讨论 `apps/cli`、`apps/desktop` 和领域 packages，却没有充分回答谁持有正在运行的 Agent、关窗后谁继续执行、两端如何找到同一实例。

后续[定稿文章](https://oh-my-quant.vercel.app/blog/agent-desktop-lifecycle/)将生命周期放在目录之前：先分离应用服务和宿主所有权，UI 与薄入口再消费它们。前端框架和首阶段传输已经选定；原先“技术栈仍待定”“正式 UI 只属于 Desktop renderer”的表述不再作为实施依据。

## 同一份服务之外，还需要同一个运行实例

目标目录将启动与交互分开：`apps/cli` 选择终端、单次命令或浏览器模式，`apps/tui` 管终端布局、输入与快捷键，`apps/desktop` 管窗口、托盘、preload 和打包，`apps/web` 放共享 React UI。四个代码目录不等于四种产品；TUI 不新增命令或独立包，单次命令不加载界面。无界面服务和 Host 留在 `src/app`，业务命令渐进归入 `src/commands`，领域模块保留在 `src/`。迁移 TUI 时同步专属测试和发现规则，当前自绘实现是否改用 Ink 另行决定。本阶段不拆领域 packages，也不移动网站。

React＋TypeScript＋Vite 负责 GUI，Electron 提供受限原生桥接，首阶段采用 Bun HTTP/SSE Host。不能假定 Bun API 在 Electron Node 中可用，也不同时建设另一套业务 IPC。Renderer 不直接读凭证、写研究文件或启动 Python；具体依赖与安全边界见[模块架构](../agent-runtime/architecture.md)。

关键过程是：明确选择工作区，发现兼容实例，连接或持锁启动，等待就绪，再打开视图。同一份源码可能创建两个 Agent；只有连接同一 workspace/session/run 和实际实例，才能跨入口观察与取消。帮助查询不启动后台服务，独立 one-shot 可直接调用服务；需要共享运行的操作才连接 Host。

![准备、研究、留存与继续构成同一条工作链；入口呈现不同，研究事实与报告身份应保持连续。](./images/08-workbench.svg)

*图 8：研究连续性。沿用工作流示意，说明 Desktop 与 CLI 共同维护的事实；不是已实现的共享 GUI 或 Host 拓扑。*

关窗和断连只释放视图订阅；显式取消针对一个 run；退出应用或停止后端须按所有权处理，不能误杀其他客户端使用的服务。Host 崩溃后应找到中断状态，再根据持久化证据决定是否恢复。daemon 与系统休眠不包含在“关窗继续”的承诺里。

已有 journal 可成为进度持久化的基础，但报告快照不能替代它。恢复时必须核对未知副作用，不能一律重放；终态之后释放 Agent、订阅与缓存，历史按需加载。现有数量限制应先测资源增长再调整，不能把删除上限当成解决长期运行的问题。

## 用一条跨入口任务检验目录设计

迁移顺序是服务解耦与 Host 契约、两种产品及共享 UI、恢复与资源治理、各平台候选验收。依赖边界见[架构](../agent-runtime/architecture.md)，任务进展由 GitHub Issues/PR 追踪；测试发现和 CI 随迁移更新。Linux 检查 CLI 命令、JSON、退出码与无 GUI 运行；Windows/macOS 分别检查桌面构建、安装与升级。Windows 包通过不能证明 macOS 已交付。每一步都保住 CLI/npm 契约、appId、用户目录与历史读取。

共享服务验收可在同机执行一条任务：浏览器验证入口提交，Desktop 接回同一 run，关窗后仍继续，CLI 取消，迟到事件不能覆盖终态；再验证保存、追问及崩溃恢复不重复副作用。这是技术契约检查，不要求用户日常跨产品切换，也不承诺 Windows/macOS 与 Linux 机器自动同步。使用真实 Host、隔离工作区与假模型验证协议，各平台产品操作与真实供应商另外验收。

当前桌面与 CLI 默认数据根不同。共用工作区须显式选择；目录迁移不自动合并凭证、账户或存档。Host 登记与锁协议、版本兼容判据、凭证传递和多客户端退出交互仍需实现前审阅，不能从一张目录图推导出并发写入已安全。

本轮交付的是一致的文档和验收边界，尚未迁移运行代码，也没有新的效率或恢复率数字。此前 F05 的局部流程验收不能外推为两种产品已共享运行。独立 GUI 增加协议、状态投影和发布成本；它是否值得，最终要看是否减少用户反复输入、丢失上下文和无法继续的真实中断。

## 实现索引

**References**

1. oh-my-quant，[产品定义（PRD）](../prd.md)、[模块架构](../agent-runtime/architecture.md)，2026-10-22 修订。维护现状、目标与验收边界。
2. oh-my-quant，[Electron 主进程](https://github.com/yangjingo/oh-my-quant/blob/0548a92b6d98d7d1270091de46eb9f00cf81bed4/desktop/src/main.ts)、[AppRuntime](https://github.com/yangjingo/oh-my-quant/blob/0548a92b6d98d7d1270091de46eb9f00cf81bed4/src/app-runtime.ts)，源码基线 `0548a92`。定位当前终端宿主和待解耦点，不是未来结构的实现证明。
3. oh-my-quant，[Agent 时代的技术选型](https://oh-my-quant.vercel.app/blog/agent-desktop-lifecycle/)，已确认的架构文章；[报告与恢复契约](../quant-harness/artifacts-design.md)、[配置契约](../agent-runtime/configuration.md)提供保留行为的依据。

[← 上一篇](./07-artifacts-and-boundaries.md) · [下一篇：布局与视觉语义 →](./10-layout-and-visual-language.md)
