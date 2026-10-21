# Artifact：报告、轨迹与固定版本

更新：2026-10-13（本次仅合并历史入口）。本文只维护现行报告边界；代码地图见 [Artifact 模块](../../src/artifact/README.md)，设计取舍见 [系列第七篇](../blog/07-artifacts-and-boundaries.md)。旧 recorder、独立 trajectory JSONL 与 DAG 方案、未采用的代价及重审条件见 [演进记录](../blog/07-artifacts-and-boundaries.md#artifacts)，不作为已实现接口。

## 报告的三种证据

| 内容 | 来源 | 可以说明什么 |
|---|---|---|
| Verified research results | 原工具参数、固定数据引用、独立重算与保存结果比对 | 指定输入与方法下的计算一致性 |
| Research inputs | Bars / NAV 的不可变归档 | 这次研究实际观察了哪些数据 |
| Session interpretation / Trajectory | 所选 session 分支的文本与事件 | 模型如何解释、工具如何执行；不自动成为核验事实 |

入口是 `runtime/research/artifact-reports.ts`；`artifact/report-input.ts` 读取分支及来源，`research/input.ts` 核验数据和结果，artifact 负责 HTML 渲染。当前轨迹由 session 派生，不维护第二份实时 DAG 账本。工具调用记录也不能证明模型每句话有正确的证据。

## 生成、保存和恢复

Auto Artifacts 默认关闭。开启后，符合条件的研究 turn 完整落盘，再生成报告。`/artifact` 浏览已有版本；实际命令和键盘行为由 [Slash 参考](./product-guide.md#commands) 与 [Quant UI/UX](./quant-uiux.md) 维护。

HTML、元数据与 provenance 保存为不可变版本。恢复选中的 `id@revision` 时核对源 entries、顺序、leaf/parent 及内容指纹，准备成功才替换活动会话。打开原版本 HTML，不用当前行情重画历史报告。来源追加后续记录可以接受；原记录被改写或来源失效不能静默恢复。

归档缺失时保留缺项，不以最新缓存替代旧 DatasetRef。报告引用存在、报告字节可读、原数据仍能核验，是三个不同条件。结构化任务如何撤销失效报告的完成状态见 [研究状态](./README.md#research-state)。

## 分享与渲染边界

完整报告可能含用户输入、模型文本和轨迹，不能当成公开文件直接分享。Share preview / Download HTML 使用独立白名单 DTO：公开行情、来源、日期、核对后的无金额结果和匿名组合；不复制完整会话再依赖字符串删密钥。

完整报告部分图表使用 ECharts CDN，K 线有静态回退。分享副本使用内联 CSS/SVG/Raw 表，预览和下载同一版本字节，不执行上传。普通字段脱敏与公开分享投影承担不同职责。

年度研究与私有账户输出分别见 [年度报告](./annual-reports.md)、[账户业绩](./performance.md)；观察组合、模拟结果和真实账户绩效不能混称。

## 验证与维护

重点回归位于 [report-pipeline](../../src/artifact/test/report-pipeline.test.ts)、[report-recovery](../../src/artifact/test/report-recovery.test.ts)、[report-share](../../src/artifact/test/report-share.test.ts) 和 [artifact-versions](../../src/storage/test/artifact-versions.test.ts)。当前生成与恢复行为以上述回归和本页契约为准；本轮未重做浏览器验收。

新增结果类型要同时定义参数绑定、原数据读取、重算规则和分享字段。渲染成功只证明可展示，不能替代这些检查。存储真源为 [存储策略](./ohquant-storage-policy.md#artifacts)。
