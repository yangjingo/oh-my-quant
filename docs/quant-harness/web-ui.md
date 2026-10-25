# 共享 Web UI：展示、客户端与服务边界

`apps/web` 是供浏览器与 Desktop renderer 复用的 React + TypeScript + Vite 模块。它承接 #84 的终端式布局，并复用 [PR #81](https://github.com/yangjingo/oh-my-quant/pull/81) 的包基础与订阅/取消契约。原来的 `prototypes/web-terminal` 已撤除，不再维护第二套 HTML 字符串渲染器。

本页说明已实现的模块边界。[架构](../agent-runtime/architecture.md)定义 Host、服务、runtime 与 storage 的职责；[UI/UX](./uiux.md)和 [DESIGN](../../DESIGN.md)维护交互与视觉原则。真实 HTTP/SSE Host、桌面加载与跨入口接续仍需要各自集成验收，不能以浏览器演示代替。

## 代码按职责组织

| 位置 | 责任 | 不承担的责任 |
| --- | --- | --- |
| `src/main.tsx`、`mount.tsx` | 选择客户端并挂载共享 Workbench | 不创建 Agent 或读凭证 |
| `src/components/` | Header、Sessions、Transcript、Overview、Composer、Settings 与 Footer | 不调用 provider、storage 或业务服务 |
| `src/state/workbench-store.ts` | 读取客户端快照、订阅事件、选择会话和呈现错误 | 不作为运行或持久化真值 |
| `src/client/contract.ts` | 带 workspace/session/run 身份的 UI 端口 | 不是已发布的 HTTP 协议 |
| `src/client/disconnected.ts` | 明确拒绝没有 Host 的操作 | 不回退为虚构成功 |
| `src/features/composer/` | 纯文本触发范围与候选替换 | 不遍历本地文件或解析研究证据 |
| `src/styles/`、`public/assets/` | 共享主题、局部样式、品牌与许可字体/图标 | 不存放 PR 验收截图 |
| `dev/`、`test/` | 显式演示适配器、验证入口与契约回归 | 不进入正常生产数据路径 |

组件通过 `WorkbenchClient` 读取会话、行情、证据、成果及偏好，并提交、取消或订阅。`mountWorkbench(element, client)` 是集成入口。实际服务实现属于 `src/app`；依赖组装属于 `src/runtime`；文件与 journal 属于 storage。renderer 不通过相对导入绕过这些边界。

正常入口使用未连接适配器，展示可诊断错误并禁用提交。只有显式 `demo` 模式加载 `dev/demo-client.ts`；生产构建检查拒绝示例运行和会话标记。演示模式复用同一组件树，并明确标注合成行情、证据及报告；其偏好可存入独立浏览器键，模拟会话只在内存中。

## 会话状态与运行生命周期

草稿、当前会话、面板开关、字号与滚动位置属于视图。运行身份、状态、对话和成果来自客户端。切换会话或卸载界面只释放观察者；取消必须是显式操作，并传递准确 runId。

状态投影用选择代次拒绝旧会话读取覆盖新选择；快照读取期间收到事件时重新同步。事件按会话身份分流，取消后的同一运行不被迟到更新复活。提交失败保留草稿并显示错误；提交期间编辑或切换会话也不清除其他草稿。最终跨客户端顺序、重连和持久化恢复仍由真实 Host 集成定义，开发适配器的计时器不提供这些保证。

## 组件与可观察行为

Header 保持紧凑图标与版本信息，运行时品牌标记呈 thinking 动画，尊重减少动画偏好。Sessions 提供搜索、选择与新建；主区保留问题、回答、过程状态、结论和证据/报告入口。过程区只呈现客户端提供的执行状态，不伪造模型推理。

Composer 使用原生 textarea，空输入光标从首行起点开始；英文提示为 `Ask anything · @ to reference · / for commands`。提示符与发送图标使用金色强调。Enter 发送、Shift+Enter 换行，输入法组合期间不发送。

`/` 菜单提供新建、会话切换、设置、观察组、证据、报告与帮助等界面动作。尚不支持的命令保留草稿并说明原因；这里不是第二套业务命令执行器。`@` 候选由客户端按会话查询，覆盖文件、目录、会话和证据，插入带类别/身份的 token；↑/↓ 选择，Tab/Enter 补全，Esc 收起，替换保留光标之后的文本。真实本地文件授权、读取、证据核验及 token 解析属于 Host；演示候选不能证明本机引用已接通。

Overview 只展示客户端提供的行情与分组，缺失值保留为空。刷新时间与数据日期分开；切换未连接数据源后不继续伪装为已取到行情。Settings 提供界面偏好、客户端模型/数据源/观察组偏好、运行状态、会话名称、证据和报告版本；当前导出是展示快照的 Markdown 摘要，不冒充存储中的不可变报告文件。

宽屏并列显示会话和概览，窄屏侧区可关闭；正文滚动与底部输入分离。弹窗使用原生 dialog、键盘导航与关闭后焦点恢复。桌面加载、系统输入法和屏幕阅读器仍需在目标环境验收。

## 开发与验证

根 `web:dev` 运行正常入口，`web:demo` 运行显式演示；`web:build` 生成正常产物。具体安装、独立 demo 构建和浏览器采集入口见 [apps/web README](../../apps/web/README.md)。只部署构建产物，不上传源码目录、测试或本地凭证。

`web:check` 覆盖 TypeScript、纯编辑逻辑、客户端生命周期、会话隔离、异步选择、失败提交、依赖边界、Vite 生产构建和示例数据排除，已纳入根 `check:release` 与两平台 CI。浏览器验收另覆盖宽/窄屏、正常/空/运行/错误状态、候选键盘操作、会话切换及设置。截图保存到忽略目录或 CI 制品，PR 证据须注明所测版本；旧原型截图不证明当前 React 修订。

本次不迁移用户数据，不改变 CLI/npm 与旧研究宿主入口，也不关闭 Host、Electron 或 #50 的后续集成事项。
