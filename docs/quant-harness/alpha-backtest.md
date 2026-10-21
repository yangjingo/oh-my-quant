# Alpha / AKQuant 回测边界

采用独立 `src/alpha` 模块：接收固定 Bars 与可选 DatasetRef，生成策略信号，调用外部 Python 引擎，再核对成交与净值。模块本身不读账户或 `.ohquant`；默认工具通过 runtime 获取行情、强制绑定 DatasetRef 并保存研究档案。依赖安装由用户显式执行。

## 引擎与运行方式

上游功能与 API 见[官方仓库](https://github.com/akfamily/akquant)、[安装元数据](https://pypi.org/project/akquant/0.3.58/)和 [API 文档](https://akquant.akfamily.xyz/reference/api/)。本项目适配锁定 0.3.58，使用 `NextOpen()`，不沿用已移除的 `execution_mode` 参数；本页只维护接入、模拟假设和核验边界。

调用方显式提供 Python 可执行文件。请求从 stdin 传 JSON，stdout 只传协议结果；引擎日志走 stderr。进程退出、缺依赖、版本不符、超时、主动取消、输出过大或非 JSON 均失败，不回退成已有 TypeScript 引擎的结果。

## 输入和模拟假设

- 单一标的、升序且唯一的有效日线；不自动删除、补齐或重排输入。OHLC 必须自洽，volume 非负；供应商未给成交额时 `amount` 可为 `null`，已给定时必须为非负有限数。
- 策略为 SMA 或显式 0/1 信号，加固定整数股数。SMA 只使用当日及此前 close；显式信号的历史可得性由调用方负责。
- 信号在当日收盘后产生，次根 Bar 开盘撮合。每日取消未成交余单后重新计算目标；最后一根只取消余单，不发新单，不强制清仓。
- 使用通用股票模拟、UTC 日期标签、整股、T+0、无借款/卖空，成交参与率 100%。这些是假设，不是 A/HK/US 交易规则证明；不包含节假日、涨跌停、复权、分红或历史可交易性校验。
- 佣金为成交金额乘费率，双边收取；百分比滑点买入加价、卖出减价，无最低佣金、印花税或过户费。成本字段必须显式提供，不按市场猜费率。
- DatasetRef 若提供，必须匹配标的、日期和 Bars 的 SHA-256；引用仅表明输入关联，不证明归档文件目前存在。结果同时保存输入摘要、引擎版本/规则版本、参数与来源引用。

## 输出核验

保留订单状态、逐笔成交、逐日净值；依据成交从初始模拟现金独立重建现金和股数，再逐日核对引擎权益。拒绝错标的、重复成交、越界日期、超量/卖空、费用/成交价不符、缺失净值及不一致订单。浮点核对容差为 `max(1, abs(expected)) × 1e-8`。没有成交是合法结果；没有净值不是成功。

风险口径复用本地共享计算：总收益与最大回撤来自逐期复利；CAGR 使用首尾日历跨度，波动率/Sharpe 使用显式年化交易期数，Sharpe 无风险收益设为 0。回撤持续期的既有 `maxDdDays` 字段实际计观察期。指标非有限数或累计收益与首尾权益比不一致时明确失败。订单拒绝保留在结果中，不称为成功成交。

## 模块调用与复跑

入口为 [createAkquantEngine](../../src/alpha/index.ts)，共享 DTO 位于 [types/alpha.ts](../../src/types/alpha.ts)。请求校验、Python 协议、子进程生命周期和回执核验分别维护；架构 gate 禁止 alpha 导入 source/storage/CLI/TUI/执行模块。示例请求见 [合成行情 fixture](../../src/alpha/test/fixtures/sample.ts)。

```typescript
import { createAkquantEngine } from "./src/alpha/index.ts";
import { sampleRequest } from "./src/alpha/test/fixtures/sample.ts";

const engine = createAkquantEngine({
  python: { command: "C:/path/to/venv/Scripts/python.exe" },
  timeoutMs: 60_000,
});
const result = await engine.run(sampleRequest(), AbortSignal.timeout(60_000));
console.log(result.metrics, result.engine, result.inputHash);
```

默认测试不要求 Python，也不下载包。它使用手工账本响应及真正的 Bun 子进程验证协议和终止行为：

```powershell
bun test src/alpha/test
bun run typecheck
bun run check:architecture
```

真实引擎复跑需要显式建立可选环境。当前固定依赖快照验证于 Windows / CPython 3.14.3；不声明其他平台组合已经测试。以下环境位于临时目录，不改变应用现有 Python：

```powershell
$alphaEnv = Join-Path $env:TEMP 'whyj-akquant-0.3.58'
uv venv --python 3.14 $alphaEnv
$alphaPython = Join-Path $alphaEnv 'Scripts/python.exe'
uv pip install --python $alphaPython -r src/alpha/dev/akquant-requirements.txt
uv pip check --python $alphaPython
bun run src/alpha/dev/check-akquant.ts --python $alphaPython
```

已有环境可直接执行最后两步，勿重新创建。安装使用 [固定版本清单](../../src/alpha/dev/akquant-requirements.txt)；运行入口不自动安装或升级。`unavailable` 表示 Python 或依赖不可用，`version` 表示版本不符；`input`、`timeout`、`cancelled`、`process`、`output` 分别标记输入、期限、取消、进程失败和响应不可信。原始 stderr 不回传到研究结果；超过 256 KiB 或 stdout 超过 16 MiB 会停止进程。默认进程期限 60 秒，可显式调整至不超过 600 秒，真实检查脚本每例 180 秒。取消/超时等待子进程 close 后才返回。

真实检查脚本覆盖次根开盘与成本、部分成交后重算目标、最后一日不下单、SMA 预热、现金不足及缺失成交额；具体输入和预期在[合成样本](../../src/alpha/test/fixtures/sample.ts)与[检查脚本](../../src/alpha/dev/check-akquant.ts)维护。它只消费合成 Bars，不联网取行情、调用模型或访问账户；普通 Bun 协议 fixture 不冒充真实引擎验证。

缺失成交额保留 `amount:null` 和对应输入哈希，Python 只接收撮合所需 OHLCV。旧归档误填的零值无法从 v1 数值反推出原始缺失状态，不能凭这次修正赋予旧数据新的字段来源证明。

## 默认 Agent 入口

默认静态注册表已包含三个 Alpha 工具，随 whyj.core 启用。它们通过自然语言调用，没有新增 slash 命令：

| 工具 | 行为 |
|---|---|
| `alpha_engine_status` | 检查配置的 Python、AKQuant 0.3.58 与规则 1.5.4；ready 仅证明导入与版本 |
| `alpha_backtest` | 先检查引擎，再取日线；固定数据版本、验证成交/账本、原子保存 UUID 档案 |
| `alpha_runs` | 不带参数列出历史；带 `id` 读取原档案并复核原数据/账本，不运行撮合引擎 |

在上面的可选环境安装完成后，于 PowerShell 启动：

```powershell
$env:WHYJ_QUANT_AKQUANT_PYTHON = $alphaPython
bun run src/index.ts
```

也可把绝对路径写入 `settings.json` 的 `env.WHYJ_QUANT_AKQUANT_PYTHON`，保存值优先于进程环境。工具参数不能指定解释器或 Python 代码。该配置与 AKShare 数据环境独立；未配置、包缺失或版本不符会在取行情前失败，不改用其他回测引擎。

示例输入：先检查 Alpha 引擎，然后用 AKQuant 回测 AAPL，2024-01-02 至 2024-12-31，SMA 5/20，假设现金 100000、固定 10 股、佣金 0.001、滑点 0.01、每年 252 期，采用 generic-stock-next-open 模拟。全部假设需要显式给定；基金 NAV 不作为 OHLC 输入。实际运行仍需兼容行情源或覆盖该窗口的缓存。

Tool capabilities 会显示额外的引擎要求；已配置不等于已经通过导入检查，日线端点成功也不升级引擎状态。`alpha_engine_status` 的结果不写成长期权限证据。

## 归档、报告和恢复

`.ohquant/alpha/runs/{uuid}.json` 保存原始研究参数、数据来源/运行时 cache 状态、固定 Bars/DatasetRef、引擎版本、订单、成交、账本和指标，外层 SHA-256 检查完整性。共享 storage 负责锁和原子写入，runtime 负责语义核验；失败/取消不提交回测档案。行情服务已成功取得的公开数据可能先行归档。

历史读取不以最新行情替换丢失版本。报告核验同时匹配工具调用参数、UUID 档案、原始 DatasetRef、成交和账本；重算账本与指标，不声称重新运行撮合引擎。研究状态保留 run ID、假设和核验结果，重启后从原分支重新建立。

完整报告保留转录；独立分享只导出公开行情、单位初值 1 的曲线、指标和固定模拟假设，排除现金、股数、成交/订单 ID、run ID 和原始对话。Auto Artifacts 开关与既有报告浏览/恢复机制相同。

## 接入验证

```powershell
bun test src/alpha/test src/runtime/test/alpha-research.test.ts
bun run src/runtime/dev/check-alpha-research.ts --python $alphaPython
```

新增集成测试覆盖默认注册工具、缺依赖前置失败、参数 schema、空数据、陈旧来源、取消、伪造账本、请求不符、损坏/缺失归档、历史数据修订、报告过滤和研究任务验收。默认测试不依赖安装 Python。

独立检查脚本使用真实 Pi 循环与 AKQuant，模型由本地 SSE 固定，行情来自临时目录的合成缓存；检查默认工具可达、成交/账本、HTML 报告、固定来源和重启恢复。不使用真实模型或联网行情，也不证明自然语言策略选择、市场数据质量或实盘可用。

引擎接口测试、默认 Agent 接入和真实市场研究是三种不同验收。完成度由 [产品范围与验收](./product-guide.md#requirements)维护，早期独立模块构建与后续产品入口之间的误判见[模块边界反思](../blog/09-boundaries-for-change.md#alpha)；本页不保存中间测试数量和构建体积。
