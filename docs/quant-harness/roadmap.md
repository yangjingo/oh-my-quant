# WhyJ Quant 实施路线

更新：2026-10-13。特性范围、状态与验收条件以 [产品范围与验收](./product-guide.md#requirements) 为准；本文只安排切片与依赖，不再复制阶段完成度。旧路线的[模块治理取舍](../blog/01-own-the-harness.md#ownership)与[Alpha 边界](../blog/09-boundaries-for-change.md#alpha)直接进入博客。下表保留切片编号以说明依赖，不是所有项目仍待实施；未完成部分的优先级是建议，无人力或日历承诺。

保留已经验收的模型 API-key 引导、观察组合 CRUD、报告生成恢复和组合元数据存储。Pi 内核已接入不代表扩展宿主完成；旧文件存在不代表公开入口可用。

## 2026-10-22：Desktop 与共享 Host 的新计划

[确认后的架构文章](../blog/agentic/agent-desktop-lifecycle.html)选择 Electron＋React＋TypeScript＋Vite，首阶段使用 Bun HTTP/SSE Host。CLI/TUI 与浏览器入口保留，Desktop 目标改为共享 React GUI；关闭窗口与取消任务分开，关窗后通过托盘/Host 继续运行。显式退出整个应用、常驻 daemon 和系统休眠不在“关窗继续”的承诺内。这替代早期默认 PTY、框架待定的提案，**不表示 main 已实现这些能力**。

依赖按可独立验收的模块组织，未承诺排期或代替贡献者认领：

1. [#51](https://github.com/yangjingo/oh-my-quant/issues/51) 收敛当前 Docs 与目标契约，明确 `apps/{cli,desktop,web}` 薄入口、`src/app` 服务/Host、`src/commands` 和 `src/tui` 的归属。其余领域模块留在 src，官网仍是 site。
2. [#46](https://github.com/yangjingo/oh-my-quant/issues/46) 提取无界面的应用服务；[#75](https://github.com/yangjingo/oh-my-quant/issues/75) 实现 Host 发现、复用、启动锁、就绪与断连语义，保证跨入口连接同一运行实例。
3. [#50](https://github.com/yangjingo/oh-my-quant/issues/50) 负责共享 React UI；[#76](https://github.com/yangjingo/oh-my-quant/issues/76) 保留 CLI/TUI 兼容并加入 `whyj web`；[#47](https://github.com/yangjingo/oh-my-quant/issues/47) 负责 Electron 窗口、托盘和原生桥接。三者消费前述契约，避免各自创建独立 Agent。
4. [#77](https://github.com/yangjingo/oh-my-quant/issues/77) 负责中断恢复、副作用核对和资源回收；[#78](https://github.com/yangjingo/oh-my-quant/issues/78) 将跨入口真实操作、测试发现和迁移后的交付检查接入 CI。保存过成果不等于任务已可恢复。
5. [#48](https://github.com/yangjingo/oh-my-quant/issues/48) 构建固定 Windows 候选；[#56](https://github.com/yangjingo/oh-my-quant/issues/56) 对同一哈希执行目标机器验收，可验收未合并候选以避免循环依赖。正式发布单独授权。

#46、#50 复用并重新打开；#49 比较框架的试点已被选型取代，保持关闭；[#29](https://github.com/yangjingo/oh-my-quant/issues/29) 保留为历史决策入口，当前契约由 #51 承担。博客已获授权先上线，博客 PR 按要求保持未合并，邀请 @Liears 讨论组织、执行所有权和迁移顺序；完成 Issue 描述不等于完成实现或验收。

## 既有领域能力切片

| 切片 | 优先级 / 特性 | 修改边界与退出条件 |
|---|---|---|
| R01 | P0 / F13 | 回测与指标：独立股数/现金账本；修正权益、复利年化、费用和日期契约；人工反例与参考实现交叉校验 |
| R02 | P0 / F08、F21–F22 | 数据与存储：来源/时点/版本一致，刷新正确性、并发写入和输出私密边界可测试；先测各阶段耗时再定刷新目标 |
| R03 | P1 / F02 | 数据与工具配置：市场选择、凭证、依赖、权限和最小探测；取消/失败保留已有可用设置 |
| R04 | P1 / F03–F07 | UI/UX：统一设计 token 与命令语义；多尺寸完整任务；固定输入的性能基线与 HUD 设置 |
| R05 | P1 / F10 | 组合研究：公开入口与 Agent 工具，自动补数据，权重/共同日期/缺失成员透明，比较不改原组合 |
| R06 | P1 / F12、F18–F20 | Quant Harness：研究目标/状态/证据端口，Session 依赖注入，取消/压缩/恢复的量化语义任务集 |
| R07 | P1 / F23–F24 | Skills/Tools：预制下载、Pi 加载、安装失败可见，升级保留本地改动；任务工具范围与会话快照一致 |
| R08 | P2 / F17 | 扩展宿主：确定 Pi API 兼容层次；manifest、加载/禁用、冲突与故障隔离；一个内置及一个独立 fixture 扩展 |
| R09 | P2 / F11 | 情绪：确定 Yahoo 来源/市场，时间窗、新闻去重、引用、失败与冲突观点；建议与价格/因子证据连接 |
| R10 | P2 / F15 | 年报：年度模板、组合/基准/币种/数据版本、投资大师出处，数字与引用一致性检查 |
| R11 | P2 / F25 | Alpha spike：先核验 akquant 运行形态；固定 Bars/DatasetRef 输入、引擎版本、超时与输出契约，再接工具 |
| R12 | P3 / F16 | 按用户“暂时留好文档和接口”完成执行契约、接入说明和本地模拟验证；[当前阶段已验收](./execution.md#2026-10-13f16-当前范围与接口验收)。所选真实服务/账户作为另行授权的后续接入阶段 |
| R13 | P2 / F01 | Pi 兼容补齐：分别决定 OAuth/订阅登录与 auth.json/models.json 互通，验证凭证所有权和迁移边界 |

R01 是评分及报告可信度的前置；R05 依赖 R01 的收益口径与 R02 的数据，跨币种还需汇率契约；R04 的独立面板/视觉检查可先做，但完整研究任务验收依赖 R05；R08 依赖 R06/R07；R10 依赖数据版本和研究证据；R12 依赖扩展执行隔离与私有状态契约。已有 API-key 配置可继续使用，R13 不阻碍日常研究闭环。

文档交付 F26/F27 包含当前 Docs、中文博客、用户手册与演示，状态只在 PRD 维护。旧快照、跳转页、归档汇编和独立决策账已删除；错误判断与淘汰代价直接更新[对应博客](../blog/07-artifacts-and-boundaries.md#documentation)。R04/R06 等切片的旧“仍需完成”流水不再在本页保存，以免覆盖 PRD 的后续验收边界。

## 每个切片的完成条件

1. 用户入口、发现方式、输入/结果和失败/取消行为能实际演示。
2. 增加对应风险的测试；数值用独立账本，数据用有时点的 fixture，真实服务单独记录。
3. 不引入反向模块依赖；可替换性须用独立实现或 fixture 证明。
4. 同步配置/命令参考与 PRD，附日期和证据；更新计划不自动提升状态。
5. 代码变更按范围运行类型、架构、测试和构建；文档变更检查链接、需求覆盖和读者理解。

不要把“全部绿测”“注册了工具”“写了 prompt”分别当成数值正确、依赖齐备或 Agent 任务完成的替代证据。
