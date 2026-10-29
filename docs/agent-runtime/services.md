# 无界面研究服务

`src/app/services/research.ts` 持有通用 Quant 会话、运行和观察者。构造服务不需要 TUI、浏览器或 HTTP Server；`src/app/workbench/service.ts` 保留兼容导出，HTTP RPC 调用同一服务与参数校验。Quant/Pi 仍拥有模型上下文、工具和 journal，服务不复制 Agent 执行循环。共享输入和投影类型位于 `src/types/workbench.ts`。

旧单股研究的协调逻辑在 `services/research-workspace.ts`，继续使用原 manager 和 study store。继续操作保留 conversationId、固定证据和原终态历史，为新执行分配 runId；原取消运行不会被改回 running。删除先读取完整元数据，再按修订保存并返回持久化后的完整项目列表，保留 #44 的并发修改和损坏文件保护。它与通用 Quant 服务使用各自已有的数据格式，不互相冒充或自动迁移。

## 身份与提交

工作区由 storage resolver 选择的 `.ohquant` 根确定。服务先解析真实路径，消除链接或 junction 别名；Windows 仅在大小写变体确实指向同一文件系统对象时折叠大小写。当前入口的 `cwd` 不另造工作区。路径不进入公开状态；移动数据根、迁移旧别名下的历史和跨机器同步不在本接口范围内。

`submit` 要求 workspaceId、sessionId、requestId、expectedRevision 和 text。接受提交前校验身份、修订、活动运行与恢复限制，先持久化接受状态再执行 Agent。同一存活服务内，相同 requestId 与相同操作/输入返回原接受结果，改变任一字段则冲突。回执只在内存中；服务重启后不得自动重试未知结果的提交。

`continue` 与 `followup` 还要求 previousRunId。两者保留 sessionId、创建新 runId，并在用户轮次中记录操作与前序身份。追问要求上一轮已完成；继续要求存在未完成的原上下文。未知、已取消或仍在执行的工具结果阻止继续；已失败工具仅在注册表声明其全部效果为 local-read 时允许继续。未知工具及涉及网络、写入或其他副作用的失败仍须核对。中断确认不等于允许重放工具；更完整的副作用对账由 #77 负责。

重命名要求 workspaceId、sessionId、expectedRevision 和 title；中断确认还要求 runId。两者拒绝陈旧修订及保存、复核、删除中的并发修改。读取参数与可编辑偏好也使用共享校验；偏好的只读展示字段不能作为写入字段提交。

`needs_input` 来自服务组装的 `ask_user` 工具成功提出明确问题。该工具通过现有 Quant/Pi 执行并记录 journal，仍受已声明任务的工具范围限制；普通问句或任务证据 blocked 不会被猜测为等待输入。问题最多 1000 字，公开投影隐藏已知凭证。澄清请求给出后，服务阻止后续工具执行；Pi 按现有批次终止规则结束本轮，界面显示问题并停止运行计时。取消或错误仍优先于完成投影。

等待输入的状态与问题写入 checkpoint；重开只读取，不重问或续跑。用户通过带 previousRunId 和修订的 `followup` 回答，创建新 run 并保留旧轮次；普通 `submit` 在等待期间会被拒绝；其他研究可新建会话。不能以无回答的 `continue` 代替，也不能将未解决的澄清保存为已完成成果。

`cancel` 必须传递完整 workspace/session/run 身份。重复取消同一终态运行不再执行；旧运行不能取消新运行。释放订阅仅移除观察者，既不取消也不续跑。关闭服务拒绝新的修改，等待已接受的保存/复核操作并收束活动运行。

## 保存、只读重开与独立复核

`save` 要求完整 run 身份、expectedRevision 和 expectedArtifactRevision（首次保存为 null）。仅保存已完成且拥有固定 journal 位置的运行。终态在现有私有 checkpoint 中记录可选 coreLeafId；旧 checkpoint 仍能读取，但缺少此位置时不会猜测最新 journal 内容并保存为旧成果。

保存使用已有 artifact generator 和不可变 report store。每个工作台会话拥有自己的报告版本链，结果包含 artifactId、递增版本、内容哈希、创建时间和来源 runId。报告头的预期哈希在存储写锁内校验；旧版本仍按固定哈希读取。完整 HTML、原始轨迹与源文件路径留在本机私有存储中，不作为普通 RPC 状态返回。

保存期间，该会话拒绝新的提交、重命名、删除或第二次保存；只有 checkpoint 提交后，读取与订阅才显示新成果。对话 checkpoint 与 report head 分别原子提交，并非跨文件事务：如果报告已提交而 checkpoint 随后失败，服务返回失败并保留已生成的不可变报告，不删除它伪装回滚，也不自动重试。需核对磁盘记录再处理，不能把未知结果当作成功保存。

`reload` 选择所属会话中的固定 artifactId/hash，返回该运行截至保存点的公开对话、报告元数据与固定证据引用。它不读取新行情、不生成新报告、不调用模型、不改变当前运行。损坏版本返回错误，不退回更新版本或重建原报告。公开对话是工作台投影，不等于私有 HTML 的完整审计轨迹。

`review` 另外要求 requestId、来源会话的 expectedRevision 和复核问题。服务校验报告引用及原 journal 分支哈希，通过已有 SessionRepo.fork 在报告的固定 leaf 创建新核心会话，再创建新的工作台 session/run。分叉前后均核对磁盘 checkpoint 修订；另一客户端已修改来源时拒绝启动复核。新会话保留 source 中的报告身份；不会移动原会话的 leaf，也不会把报告保存后追加的问题带入旧版本复核。原分支损坏或注入的仓库不支持 fork 时拒绝复核，不改用空上下文。复核的接受回执同样只在当前服务中去重。

## 删除与失败边界

`deleteSession` 明确删除工作台会话 checkpoint，要求 workspaceId、sessionId 和 expectedRevision。活动运行及保存/复核中的会话不可删除。存储在同一写锁内验证文件格式、工作区身份和字节修订后删除；已损坏的文件即使哈希已知也保留。它不删除核心 journal 或不可变报告版本，也不等同于旧单股项目的删除。

删除最后一个会话后，列表为空，identity 返回 SESSION_NOT_FOUND；客户端可显式 createSession。已删除会话不再提供其工作台重开投影，底层固定报告仍保留。当前 Web 页面没有新增这些报告/删除操作按钮，交互接入归 #50；终端共享连接与旧命令兼容由 #76 负责。

直调和 HTTP 使用同一运行时参数校验，拒绝额外字段、任意路径、缺失身份和无效修订。模型凭证不作为偏好或普通快照返回。这里的本机可信存储不是同一账户内恶意进程的隔离边界；Host 的唯一写入者、发现与退出协议由 #75 负责。

回归位于 `src/app/services/test/research.test.ts`、原单股研究测试和 storage 的 artifact/checkpoint 测试，覆盖两客户端陈旧写入、请求去重、精确取消、固定分支、损坏保留与异步关闭。完整门禁为 `bun run check:release`；受控模型测试不证明真实 provider 质量或已安装 Desktop 行为。
