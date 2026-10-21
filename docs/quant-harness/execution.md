# 执行适配契约

更新：2026-10-13。[F16 当前范围与接口验收](#2026-10-13f16-当前范围与接口验收)按用户“暂时留好文档和接口”的选择完成；以下带日期的 paper/Alpaca 记录保留原验证范围。独立执行端口、请求校验和调用边界保留；已实现固定 paper API 地址、私有意图绑定与按原 ID 对账。真实 Alpaca 账户、凭证和成交尚未验收；实盘服务仍未接入。

执行能力由独立适配器提供，不复用研究模型或行情凭证。宿主或显式 CLI 创建本地 paper 服务；外部 Alpaca Paper 由另一个显式 CLI 路径装配。默认研究 Agent 不加载账户/下单工具；显式 `whyj paper agent` 启动另一条私有本地 Agent 会话，不增加 slash 命令。账户、余额、订单和成交都是私有执行状态，不能写入公开行情缓存、自动报告或既有观察组合文件。

## 端口与不变量

`ExecutionAdapter` 绑定 adapterId、accountRef 和 paper/live 模式，提供账户快照、预检、提交、按 clientOrderId 查询及取消请求。每个订单意图显式携带同一目标、交易场所、标的、报价币种、方向、数量、限价、有效期和限价估值上限。本版只定义限价订单；市价、止损、杠杆、做空及账户资金操作需要另定契约，不通过缺省字段推断。

数量、价格和金额用十进制字符串，意图规范化会消除无意义的尾零；`maxOrderNotional` 是 quantity × limitPrice 的上界，不包含手续费，也不承诺限制卖出时更优价格带来的成交收入。校验使用十进制整数运算，不用浮点数比较。价格步长、最小交易单位、交易时段、账户权限、余额/可卖数量和额外费用由适配器预检；通用接口不假定任何市场的交易规则。最多 30 位整数和 18 位小数，拒绝指数记法、负数量及未知意图字段。

意图按固定字段顺序形成 SHA-256 摘要。预检与实盘授权必须绑定完整摘要和有效截止时间；等待授权后再次检查预检是否过期。实盘需要宿主注入授权回调，返回可信授权引用，而不是接收模型提交的 authorized 布尔值。该引用由执行服务验证；TypeScript 接口本身不构成身份认证或恶意代码沙箱。

授权同时绑定 submit/cancel 动作，提交授权不代替取消授权。调用前复核适配器目标，防止等待授权时切换账户。checkedAt、expiresAt、observedAt 和成交 at 均为 UTC epoch 毫秒；预检/授权使用调用方时钟，真实服务还必须独立验证授权有效性和权限。

`clientOrderId` 的唯一性范围是 adapterId + accountRef + mode。适配器必须跨并发、跨重启去重：相同 ID/相同摘要在权威服务可见时返回同一逻辑订单；同 ID/不同摘要明确拒绝。只在进程内保存一个 Map 不满足生产幂等契约。通用 execution 层不建立私有订单缓存；显式本地 paper 宿主把订单和账户放在调用方选择的绝对目录中，与默认 `.ohquant` 公开缓存隔离。Alpaca Paper 用 broker 的重复 ID 拒绝和用户选择的私有意图日志共同约束派单；已预留但 broker 尚不可见时只返回不确定状态，不能再次 POST。paper 凭证只留在显式命令进程内。

提交前的校验、预检或授权失败返回 not-submitted；调用提交接口后的超时、异常、取消或非法回执返回 reconcile-required。不能由 HTTP 超时推断订单未成交，不能自动重复提交或换一个 ID 重试。调用边界每次最多提交一次；不承诺替不具备服务端幂等能力的适配器制造 exactly-once。

恢复使用原 ID 与摘要查询权威服务。not-found 只是未观察到记录，不能据此自动重下；服务可能仍在处理先前请求。取消请求的 requested 仅表示已接收；最终状态可能是 cancelled，也可能已 filled。取消不等于撤销成交，已成交数量/费用必须保留。

订单快照包含目标、ID、意图摘要、状态、原始数量、累计成交量、完整成交明细和观测时间。重复成交 ID、超量成交、数量/明细不一致和来源错配都不能当成功回执；部分成交后取消仍保留已成交部分。真实服务若分页返回成交，适配器必须先收齐同一快照再提交给边界校验。

## 显式本地模拟盘（2026-09-15）

[宿主出口](../../src/app/paper-execution/index.ts) 接受 paper 目标、绝对账本目录、首次开户余额/持仓和可选时钟；仅首次创建目录需要开户快照，重启后从既有账本恢复。`orders.json` 用单一跨进程文件锁串行化提交、查单、撤单、账户和合成成交，完整文件原子替换；读取时核对摘要及订单/成交契约，损坏时停止读写。摘要防止意外损坏，不是抵御能改写文件与摘要的恶意用户的认证机制。账本目录的私有访问权限由宿主负责；该服务不读取默认设置或任何交易凭证。

本地服务只接受 GTC 限价意图：没有交易所日历，不能正确模拟 day/IOC。预检和提交锁内再检查可用现金或可卖数量；开放订单按未成交数量和限价占用资金/持仓，相同 ID/摘要再次提交返回原订单，同 ID/不同摘要拒绝。宿主通过 `recordFill` 注入明确的合成成交；价格必须符合限价，数量不能超出剩余，手续费与报价币种一致，账户现金/仓位以精确十进制更新。费用未包括在意图估值上限内，因此成交如果使现金或其他订单的留存资源不足，会被拒绝；本地服务不静默融资或四舍五入。取消在同一锁内产生已确认终态，部分成交与费用保留；取消后新成交拒绝。没有自动撮合、真实报价订阅、公司行动或真实订单路由。

宿主可这样显式运行，`root` 应是自己管理的私有绝对路径：

```ts
import { createLocalPaperService } from "./src/app/paper-execution/index.ts";
import { prepareOrderIntent, submitOrder, lookupOrder, cancelOrder } from "./src/execution/index.ts";

const paper = createLocalPaperService({
  root, target: { adapterId: "local-paper", accountRef: "my-paper-account", mode: "paper" },
  openingAccount: { balances: [{ currency: "USD", cash: "1000" }], positions: [] },
});
const result = await submitOrder(paper.adapter, intent); // intent 必须含同一 target、GTC 和完整限价字段
if (result.status === "submitted") {
  const reference = { clientOrderId: intent.clientOrderId, intentHash: prepareOrderIntent(intent, paper.adapter.target).intentHash };
  // 仅在宿主确认一笔合成成交后调用；不会连接市场。
  await paper.recordFill(reference, { id: "synthetic-1", quantity: "1", price: "10", fee: { currency: "USD", amount: "0" }, at: Date.now() });
  await lookupOrder(paper.adapter, intent);
  await cancelOrder(paper.adapter, intent);
}
```

这是一套可运行的本地纸面账本，不是券商/交易所的官方 sandbox。两个真实 Bun 进程并发提交同一 ID 的回归验证本机文件幂等与重启恢复；不代表网络断连、交易所成交顺序或外部服务的 exactly-once 保证。

## 显式本地模拟盘文件终端入口（2026-09-16）

[paper 命令编排](../../src/runtime/paper-command.ts) 从真实 `whyj` 入口提供开户、账户、限价提交、查单和撤单。账本根目录与意图 JSON 文件都须由用户显式选择绝对路径，且不得放进应用状态目录；首次创建账本目录时，其父目录须已存在。没有默认账户、自动入金、Agent 下单或实盘路由。首次开户设定一个初始币种和纸面现金；重启后只读取原账本，重复 `init` 不重置余额。`--json` 返回 `visibility: private-paper` 和所选纸面账户/订单内容，应仅用于用户选择的私有终端或文件。坏模型设置不影响这条入口。

```powershell
whyj --json paper init --root C:\private\quant-paper --account demo-usd --currency USD --cash 1000
whyj --json paper account --root C:\private\quant-paper --account demo-usd
whyj --json paper submit --root C:\private\quant-paper --account demo-usd --intent-file C:\private\order-intent.json
whyj --json paper lookup --root C:\private\quant-paper --account demo-usd --intent-file C:\private\order-intent.json
whyj --json paper cancel --root C:\private\quant-paper --account demo-usd --intent-file C:\private\order-intent.json
```

意图文件必须包含同一个 `paper` 目标、订单 ID、场所、报价币种、方向、数量、限价、估值上限和 `gtc` 有效期。例如：

```json
{"version":1,"target":{"adapterId":"local-paper","accountRef":"demo-usd","mode":"paper"},"clientOrderId":"demo-order-1","instrument":{"symbol":"AAPL","venue":"NASDAQ","currency":"USD"},"side":"buy","type":"limit","quantity":"2","limitPrice":"10","maxOrderNotional":"20","timeInForce":"gtc"}
```

相同 ID/相同完整意图再次提交返回原订单；同 ID/不同意图失败，不分配新 ID。`lookup` 的 `not-found` 只表示尚未观察到订单，不触发重下。调用边界在提交后不确定时返回 `reconcile-required`，用户应以原意图查单。纸面订单只有宿主显式注入合成 `recordFill` 才会成交；CLI 的 `submit` 不模拟自动撮合。文件终端的三组真实子进程测试覆盖坏设置隔离、跨重启去重、冲突、账户预留/撤单、错误目标、无效路径和状态目录拒绝；与原执行端口及模拟盘专项一起运行。

```powershell
bun test src/cli/test/paper-command.test.ts src/app/paper-execution/test/paper-execution.test.ts src/execution/test/execution.test.ts
bun run test
bun run typecheck
bun run check:architecture
bun run test:fence
bun run build
```

三文件专项 **29 pass / 0 fail、155 次 expect**；完整 `bun run test` **1692 pass / 0 fail、199 文件、22188 次 expect、214.89 秒**，日志 `%TEMP%/whyj-paper-cli-full-2026-09-16.log`。根 typecheck、architecture（0 baseline violations）、test fence 和 build（3011 modules / 6.91 MB）通过；构建后的 Node CLI `--json --help` 显示 `whyj paper ...`，独立临时私有目录中的 `init`/`account` 也由该 Node 构建产物成功执行并核对初始余额，随后清理该临时目录。专项先于模块位置整理，最终全量包含整理后的 runtime 入口及新增断言。此验收覆盖的是本地模拟盘与文件终端，不升级为外部券商、真实成交或默认 Agent 下单能力。

## 显式私有 paper Agent（2026-09-16）

先用 `paper init` 在用户选择的应用状态目录外绝对路径创建私有账户，再运行：

```powershell
whyj paper agent --root C:\private\quant-paper --account demo-usd
```

[私有会话编排](../../src/app/paper-execution/agent-session.ts)只加载[两项模拟盘工具](../../src/app/paper-execution/agent-tools.ts)：`paper_account` 查询所选账户，`paper_order` 使用完整 GTC 限价意图执行 submit/lookup/cancel。账户目标由宿主绑定，模型参数不能指定另一账户、live 模式或授权布尔值。提交和撤单先展示动作、账户、完整数量/限价/币种与意图 SHA-256；终端要求输入 `approve <action> <clientOrderId> <hash 前 12 位>`，输入不匹配即拒绝。审阅通过后网关重新预检，并在账本锁内复核可用资金/数量；不确定回执须用相同完整意图查单，不能换 ID 自动重下。Lookup 无需变更授权；订单不会自动撮合，只有可信宿主显式注入的合成成交才改变持仓。

该命令使用配置的模型服务，但纸面账本不读研究/行情凭证。私有账户和订单上下文会进入模型请求与该独立 Agent 的转录；转录位于所选私有根目录的 `agent-sessions/`，默认研究 Agent、自动报告、公开缓存和观察组合不加载这些工具或数据。账户目录不存在、位于应用状态目录内、相对路径、JSON 模式及不认识的参数都在打开私有 Agent 前拒绝。`/exit` 关闭终端会话；命令不执行实盘下单或真实成交。

验证包括四项直接工具反例（模型自授权、账户切换、错哈希/动作/时效、资金不足）、重新打开文件账本读单和另行审阅撤单；一项真实 Pi localhost 工具调用确认提交后的纸面订单及转录路径；两项真实 source CLI 子进程确认启动/退出与失败参数；终端审阅另核对精确确认短语和取消。专项命令：

```powershell
bun test src/app/paper-execution/test/agent-tools.test.ts src/app/paper-execution/test/agent-session.test.ts src/runtime/test/paper-agent-command.test.ts src/cli/test/paper-agent-entry.test.ts
bun run typecheck
bun run check:architecture
bun run test
bun run build
```

这完成了用户显式选择的私有本地模拟盘 Agent 路径。默认研究 TUI 没有订单上下文；Alpaca Paper 已有独立文件终端适配器，但所选真实账户、broker 行为与 live 授权仍需单独验收，因此 F16 保持部分完成。

新增四文件专项 **10 pass / 0 fail、72 次 expect**；最终完整回归 **1716 pass / 0 fail、204 文件、22357 次 expect、255.64 秒**，日志 `%TEMP%/whyj-paper-agent-full-2026-09-16.log`。类型、架构（0 baseline violations）、测试围栏及构建（3015 模块 / 6.93 MB）通过。本机安装版 `whyj --help` 列出 `paper agent`；`--json paper agent` 与缺少参数的调用退出 1，不打开交互终端。真实 Pi 工具调用使用 localhost SSE 与合成纸面账户，不验证个人模型账户、券商授权或物理终端输入法。

## Alpaca Paper 外部适配器（2026-09-16）

暂以 Alpaca 美股 Paper 为首个外部服务目标；最终市场选择仍可调整。[官方鉴权](https://docs.alpaca.markets/us/v1.1/docs/authentication-1)将 paper API 与 live 分离。[适配器](../../src/app/alpaca-paper/adapter.ts)只构造 `https://paper-api.alpaca.markets/v2/` 请求；[文件终端](../../src/runtime/alpaca-paper-command.ts)只在显式 `alpaca-paper` 入口读取 `ALPACA_PAPER_KEY_ID` 与 `ALPACA_PAPER_SECRET_KEY`，不使用模型或行情凭证，也不把凭证写入应用设置。调用方提供独立私有目录、账户 ID 和完整意图 JSON，目标固定为 `adapterId: "alpaca-paper"`、`mode: "paper"`，场所使用逻辑路由 `ALPACA-US`，报价币种为 USD。适配器暂只接受美股整股、GTC 限价、普通订单和多头持仓；当前不涵盖盘前/盘后、卖空、期权或实盘。

预检读取纸面账户余额/持仓，并通过[官方按代码获取资产接口](https://docs.alpaca.markets/us/reference/get-v2-assets-symbol_or_asset_id)核对美股类别、当前 active 与 `tradable: true`；即便 active 的标的也可能不允许开仓，这是[官方资产 FAQ](https://docs.alpaca.markets/us/docs/broker-api-faq)区分的状态。派单前重新查询资产与账户，防止预检后状态变化。暂保守地拒绝不可交易资产的卖出；券商仍可能因交易限制或资金冻结在派单时拒绝订单，不把这项预检解释成保证成交。

```powershell
$env:ALPACA_PAPER_KEY_ID = "<所选 paper 账户的 key ID>"
$env:ALPACA_PAPER_SECRET_KEY = "<所选 paper 账户的 secret>"
whyj --json alpaca-paper account --root C:\private\alpaca-paper --account <该 paper 账户的 ID>
whyj --json alpaca-paper submit --root C:\private\alpaca-paper --account <该 paper 账户的 ID> --intent-file C:\private\alpaca-intent.json
whyj --json alpaca-paper lookup --root C:\private\alpaca-paper --account <该 paper 账户的 ID> --intent-file C:\private\alpaca-intent.json
whyj --json alpaca-paper cancel --root C:\private\alpaca-paper --account <该 paper 账户的 ID> --intent-file C:\private\alpaca-intent.json
```

意图示例：

```json
{"version":1,"target":{"adapterId":"alpaca-paper","accountRef":"<该 paper 账户的 ID>","mode":"paper"},"clientOrderId":"my-paper-order-001","instrument":{"symbol":"AAPL","venue":"ALPACA-US","currency":"USD"},"side":"buy","type":"limit","quantity":"2","limitPrice":"10","maxOrderNotional":"20","timeInForce":"gtc"}
```

[官方创建订单](https://docs.alpaca.markets/us/reference/postorder)接受 `client_order_id`；[官方 CLI](https://docs.alpaca.markets/us/docs/alpacas-cli)说明重复 ID 被拒绝，并提供[原 ID 查单](https://docs.alpaca.markets/us/reference/getorderbyclientorderid)。适配器在第一次 POST 前用跨进程文件锁把完整意图与 ID 写进用户选定的私有日志；断线后的调用只查同一 ID，不再 POST。日志已预留但 broker 查不到时返回 `reconcile-required`/`unknown`，需要人工查清，不能换 ID 重试。同一 ID 的完整意图摘要冲突或外部先占用的 ID 不会提交。日志摘要只检查意外损坏，不是对目录管理员的认证；目录访问权限由宿主负责。

[官方 FILL 活动](https://docs.alpaca.markets/us/reference/getaccountactivitiesbyactivitytype-1)按订单 ID 分页返回成交，[trade activity 字段](https://docs.alpaca.markets/us/docs/account-activities)有数量、价格、时间和 ID，却没有可归属于每笔成交的 fee 字段。这里的“逐笔费用无法核实”是按官方字段作的工程推断；执行合同把 `Fill.fee: null` 作为明确未知，不能解释成零。本地纸面账本仍要求已知费用，未知费用不能更新现金。[撤单 API](https://docs.alpaca.markets/us/reference/deleteorderbyorderid-1)的 204 只返回 `requested`，需后续查单确认终态。

隔离测试用假 HTTP 服务验证一次提交、断线后重启查单、预留后 broker 暂不可见、冲突 ID、真实账户 ID 错配、active 但不可交易资产、101 笔成交跨页、费用未知和撤单请求/终态分离。没有向 Alpaca 提交真实 paper 订单，也没有验证所选账户的全部交易限制、费用来源、交易日历或真实成交时序；F16 仍为部分完成。专项命令：

```powershell
bun test src/app/alpaca-paper/test/adapter.test.ts src/cli/test/alpaca-paper-entry.test.ts src/execution/test/execution.test.ts src/app/paper-execution/test/paper-execution.test.ts
```

最终四文件专项 **38 pass / 0 fail、478 次 expect**；完整回归 **1728 pass / 0 fail、206 文件、22717 次 expect、269.08 秒**，日志 `%TEMP%/whyj-alpaca-paper-asset-full-2026-09-16.log`。typecheck、architecture（0 baseline violations）、test fence 与 build（3021 modules / 6.96 MB）通过；构建版 Node CLI 的 `--json --help` 列出 `alpaca-paper`，缺 paper 凭证的账户命令退出 1。此证据只包含假 HTTP 与本机私有日志，不等于所选 Alpaca Paper 账户的真实交易验收。

## 后续接入门槛

选定市场与服务后，单独提供凭证读取、限额与预检实现，并用官方 sandbox/模拟盘验证服务端幂等、接受后断连、部分成交撤单、状态恢复和订单查询一致性。真实提交须有用户明确授权及独立账户验收；本地合成 fixture 不能证明上述真实服务能力。

## 当前模块与使用

| 入口 | 职责 |
|---|---|
| [类型契约](../../src/execution/types.ts) | 账户/余额/持仓、限价意图、完整订单/成交、预检、授权、查询与取消 |
| [确定性校验](../../src/execution/validation.ts) | 目标/字段检查、精确十进制预算、稳定摘要、价格约束及累计成交核对 |
| [调用边界](../../src/execution/gateway.ts) | 预检和授权绑定、取消观察、一次提交、未知结果与查询/撤单分离 |
| [公开出口](../../src/execution/index.ts) | 宿主可显式 import；不读 settings 或环境凭证 |
| [合成服务](../../src/execution/test/fixtures/service.ts) | 仅供测试，多个独立客户端共享内存权威记录；不作为生产适配器分发 |
| [本地 paper 宿主](../../src/app/paper-execution/index.ts) | 显式绝对目录的私有文件账本、账户预检、合成成交、查询/撤单与跨进程去重；不进默认 Agent |
| [文件终端编排](../../src/runtime/paper-command.ts) | 显式选择私有目录/意图、开户、账户、提交、查单与撤单；不读模型配置或默认应用缓存 |
| [私有 Agent 会话](../../src/app/paper-execution/agent-session.ts) | 绑定单一 paper 目标、私人转录目录及两项工具，弃用默认研究/skill/shell 资源 |
| [Agent 工具](../../src/app/paper-execution/agent-tools.ts)与[终端审阅](../../src/runtime/paper-agent-command.ts) | 宿主审核完整意图后才提交/撤单；查单读原 ID，终端输入通道独立于模型 |
| [Alpaca Paper 适配器](../../src/app/alpaca-paper/adapter.ts)与[私有意图日志](../../src/app/alpaca-paper/journal.ts) | 固定 paper 域名、原 ID 对账、完整成交分页及费用未知口径；日志预留后不自动再次 POST |
| [外部 paper 文件终端](../../src/runtime/alpaca-paper-command.ts) | 用户选账户/私有目录/完整意图，独立 paper 凭证仅在该命令中读取 |

宿主函数可以这样接入，适配器和可信授权函数由宿主提供：

```ts
import { prepareOrderIntent, submitOrder } from "./src/execution/index.ts";
import type { AuthorizeLive, ExecutionAdapter, OrderIntent } from "./src/execution/index.ts";

export async function submitReviewedIntent(
  adapter: ExecutionAdapter, intent: OrderIntent,
  authorizeLive: AuthorizeLive, signal: AbortSignal,
) {
  // 校验失败会在任何适配器调用前抛出具体契约错误，供宿主显示。
  const prepared = prepareOrderIntent(intent, adapter.target);
  return submitOrder(adapter, prepared.intent, { authorizeLive, signal });
}
```

调用方为网络操作提供 deadline/cancel signal；若省略，通用接口不会猜测超时时限。中断观察会消费迟到 promise 的拒绝，但不能撤销远端已发生的动作。原始适配器错误可能包含凭证，因此调用边界仅返回稳定阶段原因；具体预检详情应在受信任的账户界面中处理。

| 结果 | 应用含义 |
|---|---|
| `submitted` + order | 收到与意图一致的订单快照；继续检查 order.status，可能为 rejected，不能直接称为已成交 |
| `not-submitted` | 此次边界调用未进入适配器 submit；不宣称同 ID 在更早调用中从未提交 |
| `reconcile-required` | 调用已进入 submit/cancel，最终结果不确定；用原 clientOrderId/intentHash 查询，不自动重试 |
| lookup `not-found` / `unknown` | 未观察到记录 / 查询不可信；均不能自动重下 |
| cancel `requested` / `resolved` | 取消请求被接收 / 已拿到终态；resolved 中仍可能是 filled，保留所有成交明细 |

`lookupOrder` 从原始意图重新计算摘要，校验结果的模式/账户/订单身份与完整成交；不调用 submit。`cancelOrder` 使用同一引用并要求独立的 live cancel 授权。费用单独保留币种与非负金额，返佣/负手续费、成交分页和公司行动的扩展语义尚未定义，不能擅自改写成当前合同。

## 测试方式与范围

```powershell
bun test src/execution/test/execution.test.ts
bun test src/app/paper-execution/test/paper-execution.test.ts
bun run typecheck
bun run check:architecture
bun run test
bun run build
```

20 项合成测试覆盖十进制边界、模式/账户/未知字段拒绝、授权动作/摘要/时效、授权期间账户切换、预检失败与过期、调用者变更隔离、共享服务幂等、接受后丢回执、取消前后区别、部分成交取消及成交回执反例。fixture 的 Map 只演示适配器所需行为，不验证生产跨进程持久化；没有连接市场或真实账户。架构检查禁止 execution 读取研究、行情、UI 或存储模块，并禁止这些层反向引入执行状态。

2026-09-15 新增六项本地 paper 专项测试、36 次断言、0 失败：真实双进程同 ID 并发与重启、买入资金留存/部分成交撤单、卖出限价及重复成交 ID、竞争订单争用、损坏账本失败关闭、live 与 day/IOC 拒绝。最终全量 1650/1650、195 文件、21945 次断言，用时 176.66 秒；`bun run typecheck`、`bun run check:architecture` 和 `bun run build` 通过，架构基线违规为 0，构建 3001 modules / 6.86 MB。它们只覆盖本机合成账本；外部模拟盘与真实账户验收仍待选定服务。

R12 历史验证（2026-09-14）：全量测试 1086 项通过、0 项失败，覆盖 145 个文件、10589 次断言，用时 81.92 秒；类型检查、架构检查及构建均通过，架构基线违规为 0。构建包含 2680 个模块、产物约 6.0 MB；执行接口尚未绑定到默认 CLI，因此构建成功不代表交易入口已接入。相关四份文档的 145 个本地链接全部有效，`git diff --check` 通过。上述结果不包含真实账户验收或生产服务持久化幂等验证。

## 2026-10-13：F16 当前范围与接口验收

[产品指南的已确认选择](./product-guide.md#scope)保留的用户选择为“暂时留好文档和接口”。此前完成度把所选真实 paper/broker/live 账户也列作本阶段门槛，超出了这一明确范围。本次按原要求重新核对当前工作区的公开端口、独立实现、调用边界与文档，完成 F16 接口阶段；没有把合成测试升级为真实交易证明。真实服务/市场/账户的选择、权限与提交仍按上文后续接入门槛单独处理。

| 当前要求 | 权威实现与验证 | 核对结果 |
|---|---|---|
| 可替换执行端口及接入说明 | [公开出口](../../src/execution/index.ts)、[类型](../../src/execution/types.ts)，本页宿主接入示例；合成服务与本地 paper 均实现同一合同 | 接口、导出和调用示例齐备 |
| 显式 paper/live、账户、余额、持仓、订单、成交、查询/撤单结果 | 类型合同与 [回执校验](../../src/execution/validation.ts)；模式/账户/数量/成交明细及未知费用回归 | 目标、状态和费用未知不混用 |
| 完整意图与限额/稳定摘要 | 同一校验模块；十进制边界、未知字段、调用者变更及错摘要反例 | 校验前不触发适配器操作 |
| 独立预检/授权及动作、摘要、时效绑定 | [网关](../../src/execution/gateway.ts)、[合同测试](../../src/execution/test/execution.test.ts)；授权等待中的账户切换与预检过期反例 | 不接收模型自授权布尔值 |
| 单次派单、不确定结果及原 ID 查单 | 网关与接受后丢回执、取消前后、not-found、部分成交撤单回归 | 不因超时/查无记录自动重下 |
| 私有状态和凭证与研究/公开存储隔离 | 同页所有权说明、架构两条 execution 规则及显式 paper 私有根目录 | 当前架构检查 0 baseline violations |
| 可运行的宿主接入证据 | 本地 paper 双进程/重启专项，构建后独立 CLI `init/submit/account/lookup/cancel` | 同 ID 去重、资金留存与撤单释放符合合成账本 |
| 后续真实服务责任清楚 | 本页预检、持久化幂等、授权、断连、成交分页、未知费用与后续接入门槛 | 服务端保证与本地证据分别列出 |

当前九文件专项 **51 pass / 0 fail、587 次断言、37.28 秒**。包含通用合同、本地 paper、独立 paper Agent 及 Alpaca 假 HTTP 接口测试；其中本地双进程与重启使用实际文件账本，Alpaca 仍是替身。[构建 CLI 回执](../../output/execution-interface-compiled-cli-2026-10-13.json)使用八个独立进程、同一个临时合成账本和故意损坏的隔离模型设置：纸面余额 100、提交 2×10 后可用余额 80、重复提交返回同一订单、原 ID 查单、撤单终态和可用余额回到 100 全部通过。这些是固定合成输入，未读取真实账户、模型凭证或行情，临时账本已清理。

[接口验收快照](../../output/execution-interface-validation-final-2026-10-13.json)绑定当前公开端口、核心测试、CLI 证据和日志哈希。生产源码/测试没有变动，沿用上一轮最终全量 **1986/1986、235 文件、25667 次断言、235.39 秒**及 typecheck/build（2682 modules / 7.55 MB）；本轮另执行上述专项和当前架构检查，不重复宣称运行了全量。本轮另行发起的 33 例真实模型套件只使用合成研究输入，进度与结果单独记录，与 F16 账户接入无关。

```powershell
bun test src/execution/test/execution.test.ts src/app/paper-execution/test/paper-execution.test.ts src/app/paper-execution/test/agent-tools.test.ts src/app/paper-execution/test/agent-session.test.ts src/cli/test/paper-command.test.ts src/runtime/test/paper-agent-command.test.ts src/cli/test/paper-agent-entry.test.ts src/app/alpaca-paper/test/adapter.test.ts src/cli/test/alpaca-paper-entry.test.ts
bun run check:architecture
```

F16 状态为按原文界定的文档/接口阶段完成，PRD 当前 **17 完成 / 8 部分完成**。历史段落中的“F16 部分完成”保留其当时把真实服务纳入整体门槛的含义；不抹去真实账户、实盘服务、真实费用/日历与网络故障验收仍未交付的事实。
