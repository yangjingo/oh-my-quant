# 共享 Host：身份、所有权与退出契约

本页是 #51 的目标契约，初稿基于 main `5ae8012`，并对照 main `3b15066` 更新；#46 提取的无界面服务见[服务说明](./services.md)，目标 Host 能力不等于已交付能力。当前目录与依赖规则见[模块架构](./architecture.md)，持久化提交点见[存储](./storage.md)。实现必须逐项提供运行证据，不能以本文替代验收。

## 从现有代码提取，不增加第二份业务真值

[AppRuntime](../../src/app-runtime.ts)同时维护研究操作和 `onMessages`、`onPanel`、`onComposerStatus` 等界面回调。共享投影类型虽已移出 TUI，构造 AppRuntime 仍不等于获得无界面服务。

[旧研究管理器](../../src/app/research-workspace/manager.ts)已有 `start/get/current/list/subscribe/cancel/continue/followup/save/delete`：订阅释放不取消，保存经 workspace store 提交，复核通过 `parentId` 关联固定研究。它管理单股研究，不能直接冒充通用 Quant 会话。`continue` 为新执行分配新 runId 并保留原会话和历史，避免迟到事件污染新执行。旧保存格式保持兼容读取。

[React 客户端端口](../../apps/web/src/client/contract.ts)已有 workspace/session/run 身份与显式取消。界面改进 PR #98 和真实 Quant Agent 接入 PR #102 已合入 main：后者提供初步本机 HTTP/SSE 服务与工作区锁，但尚不提供本契约要求的发现、跨入口复用或重启后的执行恢复。#46 已提取无界面研究服务，复用现有 Quant/Pi 核心、旧研究保存规则及已有适配器；终端尚未接入该服务。TUI、HTTP 和 React 只做适配；一个运行只能由一个服务实例持有 Agent。

## 服务操作与身份

以下为 #46 的应用接口语义，直调和 HTTP 使用同一实现与参数校验；具体能力与边界见[无界面服务](./services.md)。跨入口 DTO 归 `src/types`；目标是不导出 Agent、文件路径、凭证或界面回调。当前工具返回的文本可能包含本地报告路径，修复与验证由 [#142](https://github.com/yangjingo/oh-my-quant/issues/142) 跟进。

| 操作 | 输入与结果约束 |
| --- | --- |
| 创建/读取会话 | 返回稳定 sessionId、workspaceId 和修订号；读取不发起模型或工具调用 |
| submit | workspaceId、sessionId、requestId、输入及 expectedRevision；分配新 runId，返回已接受的运行身份 |
| cancel | 完整 workspace/session/run 身份；只取消匹配的活动运行，重复取消幂等，旧 run 不能取消新 run |
| continue / followup | 显式动作，引用先前 run 和会话修订；创建新 runId，保留 sessionId；continue 还检查恢复与副作用资格 |
| save / reload | 保存绑定终态 run、固定 evidence 和 expectedRevision；返回 artifactId、版本及内容哈希；重开只读取，继续需另行提交 |
| review | 从指定不可变 artifact 另开会话与运行，保留来源关系；新行情不写回旧成果 |
| delete | 明确删除对象与 expectedRevision；拒绝删除活动运行；保留 #44 的版本链、损坏文件和陈旧写入保护 |
| subscribe | 返回释放函数；只观察、不续跑、不取消。重连先取完整快照 |

workspaceId 绑定 storage resolver 选择的同一本地数据根：规范化绝对真实路径，按文件系统规则消除路径别名后生成不透明标识。默认根与 `OHQUANT_DIR` 的优先级保持不变；不根据当前窗口建立新工作区，不自动合并旧历史或凭证。跨机器同步和移动数据根后的身份迁移不在本轮范围。

sessionId 标识对话；runId 标识一次执行；artifactId/version/hash 标识固定成果，三者不能互换。新建会话不启动 Agent。修改请求必须匹配 workspaceId、sessionId 和修订；不匹配分别返回可区分的 `WORKSPACE_MISMATCH`、`SESSION_NOT_FOUND`、`REVISION_CONFLICT` 或 `RUN_CONFLICT`。同一 requestId 的相同输入返回同一接受结果，输入不同则冲突；#46 提供存活期间去重，跨崩溃的提交记录由 #77 接管，未交付前重连不得自动重试提交。

Bun HTTP/SSE 运行于独立 Bun 进程。Node/Electron 调用 bootstrap 时必须显式提供 Bun 可执行文件或编译的 Bun Host；不能把 Bun server 导入 Electron Node 并假定兼容。Desktop 构建 Host 与静态资源，安装包和目标机器验收由 #48 完成。

状态至少区分 idle、running、needs_input、settled、cancelled、failed、interrupted。取消提交终态后拒绝该 run 的后续写入；继续创建新 run，不能把 cancelled 改回 running。Host 每次启动生成 instanceId，SSE 信封携带实例标识和会话修订；服务快照本身不携带 instanceId。客户端只应在同一实例内比较 revision，实例改变时重新读取；入口侧完整拦截旧实例迟到事件仍须在 #50/#76 验证。

## 工作区发现与启动

#75 的 bootstrap 返回 `workspaceId/instanceId/url/protocolVersion/serviceContractVersion`、连接能力及本次是否启动 Host。应用版本用于诊断；初版只复用协议版本、服务契约版本和工作区身份全部相等的 Host，不靠端口开放或版本字符串相近猜兼容。现有 #102 HTTP 接口是迁移输入，不自动满足本契约。

1. storage API 解析工作区，在该私有根下管理 Host 登记与锁。登记包括 schemaVersion、身份、PID、协议/契约版本、loopback 地址和启动时间；原始路径不进入浏览器快照。
2. bootstrap 在启动锁内再次读取登记并探测认证就绪端点。兼容实例直接复用；活着但不兼容的实例返回冲突，不启动第二个写入者、不结束旧进程。
3. 无实例时启动 Bun 子进程，由 Host 持有工作区执行所有权锁直至退出；启动锁仅覆盖发现到就绪。就绪应在服务初始化、静态资源检查和监听完成后发布，登记原子写入。单次可写 CLI 服务也必须服从该所有权锁；检测到共享 Host 时转发或明确拒绝，不能在相同工作区另建 Agent。
4. 初始就绪等待上限为 15 秒，可在测试中注入更短预算。失败只清理本次启动且尚未发布就绪的子进程；已复用实例永不被启动失败清理。PID 不是独立的所有权凭证，清理须匹配启动实例及保留的进程句柄。
5. 失效登记只有在锁内确认对应实例已退出后才能替换。仅连接超时、心跳过期或 PID 查询失败不足以宣告实例死亡；返回诊断。损坏或未知版本登记保留原字节，不覆盖为一个看似正常的新实例。

HTTP 绑定 `127.0.0.1`，拒绝错误 Host、非白名单 Origin、缺失/错误 token、越界输入和未声明方法。无 Origin 的 CLI 请求仍需 token。开发 Vite Origin 必须显式配置，不允许通配。读取会话和 SSE 也需授权；token 不进入普通状态、日志或查询字符串。

浏览器沿用 #102 的同源 bootstrap 获取短期 Host capability，入口须先验证固定 Host 标识；bootstrap 同样校验 Host/Origin/Fetch Metadata，不开放跨域读取，也不返回模型凭证。页面重载可重新握手，Host 重启轮换 token；业务请求和流式 fetch 用请求头携带 token，不通过 URL 或公开状态传递。CLI/Electron 启动连接经受控管道或受限登记传递，不放在可见命令行参数。#75 验证认证，#47 验证 preload 和导航限制；本机 HTTP 不承担同账户恶意程序隔离。

## 关窗、取消、退出各自作用于什么

| 动作 | 目标行为与负责 Issue |
| --- | --- |
| Web 关闭、TUI detach | 释放连接/订阅，运行继续；#75、#76 |
| Desktop 关窗 | 隐藏/释放视图，保留托盘返回入口；重新打开附着同一 Host/run；#47 |
| 显式取消 | 请求服务取消指定 run，Host 和其他会话继续；#46 |
| 退出当前入口 | 释放本入口的客户端登记；不能因本入口曾启动 Host 就停止其他客户端使用的实例；#76、#47 |
| 停止工作区后端 | 单独的明确动作，提示活动运行和其他客户端的影响；拒绝新提交、标记中断/终止在途工作、关闭订阅并释放锁；#75、#77 |
| Host 崩溃 | 界面显示断连，重启后通过持久化记录识别 interrupted；不自动继续；#77 |

Host 跟踪已附着客户端及活动运行；网络断连不表示用户授权结束后端。入口退出时，只有它启动的实例已无其他客户端且无活动运行，才能请求正常停机；清理失败报告实例信息，不按可执行文件名称批量杀进程。后端停止设置有限清理预算，超时只处置确认属于该实例的子进程。#75/#47 须分别验证复用 Host、其他客户端仍在、活动运行、启动失败和显式停止。

以上不是 OS daemon、开机启动、全机退出或睡眠期间继续工作的承诺。服务事件不暴露隐藏推理、原始 provider 凭证或任意文件读取能力。

## 恢复与资源预算

不可变成果按 storage 提交链读取，运行进度优先复用 Quant journal。#105 的会话连续性已通过 PR #106 和集成 PR #134 进入 main：版本化 checkpoint、浏览器草稿和原 journal 上下文按[会话连续性](../quant-harness/workbench-sessions.md)重开；它不认证研究成果，也不完成 #77 的工作流恢复。#77 负责 durable run 身份、显式恢复资格、外部副作用的状态记录与对账边界，以及长期资源上限；不假定外部服务具备幂等能力。未知副作用必须可见并经明确确认或对账，不自动重放。

完成或取消后释放 Agent、订阅和临时缓冲，旧历史按需读取。当前旧研究管理器的 50 次研究、12 轮历史保护不能因引入 Host 被直接移除；先记录重复会话和跨日 fixture 的 Agent/observer 数、内存、快照字节、重连耗时，再在 #77 提出有证据的替代预算。初版保留全量快照；只有测量证明需要时才引入含序号、保留窗口和缺口重同步的增量协议。

## 当前工作区 Host 实现

`src/app/bootstrap.ts` 持启动锁发现并认证兼容实例；没有存活或无法确认的所有者时才启动 Bun Host。storage 在私有 `.host/` 中原子发布非空锁目录和登记；只在确认进程死亡时回收，损坏、未知或不兼容的状态保留并报错。锁目录不递归删除，PID 和文件时间戳不单独作为终止或抢占凭据。

Host 仅监听 loopback，校验 Host、Origin、Fetch Metadata 与连接 token；显式停止还要求私有控制能力和匹配的 instanceId，浏览器 bootstrap 不提供该能力。就绪登记含实例、工作区与协议版本，Host 关闭时释放自身登记和锁。登记权限依赖本机文件系统及 Windows 账户 ACL，不承诺同账户恶意程序隔离；工具结果中可能出现本地路径的限制仍由 #142 跟进。

Web SSE 断连只释放观察；客户端登记以 90 秒租约维持存在，过期不取消研究。空闲停止检查其他客户端、观察者、在途操作与活动运行；显式停止拒绝新操作并收束运行。旧单股前台入口同样取得执行锁。CLI/TUI 和 Electron 接入分别由 #76、#47 负责；崩溃后的副作用对账仍属 #77。

`bun run web:start` 构建界面后启动或复用 Host，`bun run web:host` 使用现有产物，`bun run host:stop` 显式停止。Windows/Bun 使用隐藏 PowerShell broker 保留启动子进程句柄至就绪；Node/Electron 必须显式提供 Bun 可执行文件。并发启动、认证、真实进程停止及重连由 Host 测试覆盖，不能以浏览器测试代替安装包或目标机器验收。

## 顺序、复用与完成条件

旧单股 `workspace:dev` 前台入口也取得同一执行锁；它不冒充兼容的通用 Host。Desktop 关窗隐藏到托盘，身份持续续期；重新打开连接同一 Host。普通退出等待在途连接收尾并解除身份，只对本入口启动的 Host 请求空闲停止；有活动研究或其他观察者时保留服务。托盘中的显式停止需要确认并停止全部入口的活动研究。服务不可用时显示恢复界面，手动重连不重放请求。CLI 迁移仍由 #76 负责。

Desktop 用稳定的 `app://desktop` 来源加载工作台；主进程仅将资源和工作台接口转发到当前认证的 loopback Host，不开放后端控制接口。Host 端口改变时，按工作区与会话隔离的视图草稿仍可读取；模型凭据和 Host 停止能力不交给 renderer。常见连接错误使用可操作的提示，未知异常不将本机路径或原始异常正文传给界面。

原规划按下列顺序逐项实施；#51、#46 和 #105 已合入，其他事项各自保留独立 Issue/PR。后续分支基于当时最新 main；确需未合入依赖时显式记录临时堆叠关系，最终目标仍为 main。目录迁移与会话连续性中已交付的部分不重做。

| 顺序 | 负责事项 | 进入下一阶段的证据 |
| --- | --- | --- |
| 1 · #51 | 本页契约与当前架构说明 | 明确接口、身份、退出及恢复边界，列明审阅与未决事项 |
| 2 · #46 | 共享服务 | 无 TUI 直调、版本/删除保护、精确取消；复用现有核心与研究 manager |
| 3 · #75 | Host/bootstrap | 并发启动、兼容复用、认证、断连保活、退出清理；对接 #102 已有实现 |
| 4 · #76 | CLI/TUI 适配 | 原命令兼容、whyj web、共享 run 操作；消费已完成的 #93 目录迁移 |
| 5 · #50 | 共享 Web 工作台 | 复用已交付 UI 与 #98/#102，补齐保存/复核及真实服务交互 |
| 6 · #47 | Electron/tray | 真实 Electron 关窗接回、显式退出、输入与错误态 |
| 7 · #105 → #77 | #105 会话连续性已合入；#77 工作流恢复待完成 | 复用 checkpoint/journal，明确中断与副作用处理，验证资源回收 |
| 8 · #78 | 跨入口契约与 CI | Web 提交 → Desktop 接回 → 关窗继续 → CLI 取消；真实进程崩溃恢复；保留本地已有发现检查 |
| 9 · #48 → #56 | 固定 Windows 候选与干净目标机验收 | 同一候选哈希的安装、升级、数据保留与生命周期证据；发布另行授权 |

#78 不替代前置实现，也不重复搬运模块测试；其发现规则可提前实施，完整集成验收依赖前述能力。#48 的现有 PTY 包及 #56 的旧安装证据不能证明共享 Host 候选通过。

历史架构审阅见 [Liears 对 #79 的评审](https://github.com/yangjingo/oh-my-quant/pull/79#pullrequestreview-5610180434)：认可的论证与发布证据不能代替新协议的实现审阅。本文新增的兼容判据、锁与凭证交付、退出条件须在 #51 PR 审阅；#105 的 checkpoint schema 已随其实现审阅，恢复动作/副作用分类和资源预算仍在 #77 审阅。不把“历史有人看过”记为本次批准。

React 界面将会话修订及报告摘要随相应操作发送给 Host；版本冲突由服务拒绝，不由界面自动重发。查看固定研究只读，复核创建独立会话；切换界面不停止运行。Electron 使用同一 Host，跨入口验收见 #47。

并发进程锁、就绪失败、失效登记、鉴权、客户端 detach 和退出由 `src/app/host/test/` 验证；桌面共享入口以隔离 Host 和受控模型验证跨入口运行；既有服务测试保留真实 Host kill/restart、精确取消与 SSE 接回。测试使用隔离工作区和确定性模型，不能证明真实行情完整性、模型质量、安装包接入或目标机器验收。完整恢复资格、未知工具副作用对账和长期资源预算仍由 #77 负责。
