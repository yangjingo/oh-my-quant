# Quant 配置

本页只说明量化研究相关设置：数据连接、观察组合、报告、行情展示与回测引擎。通过 Settings 选择对应分组；配置保存在工作区 `.ohquant` 中。

CLI Web 入口沿用 `OHQUANT_DIR` 选择工作区，不迁移或合并配置。Host 默认使用当前 CLI 的 Node/Bun 运行时；`WHYJ_BUN_EXECUTABLE` 可显式指定替代运行时，这是入口环境，不保存为模型或行情设置。连接、退出与尚未完成的 TUI 接入见 [Host](./host.md)。

## Market Data 与凭证

| 数据源 | 主要范围 | 凭证/依赖 |
|---|---|---|
| AKShare | A 股、指数、基金 | 无 token，需要所选 Python 环境中的依赖 |
| Tushare | A 股、基金 | `WHYJ_QUANT_TUSHARE_TOKEN` |
| LLMQuant Data | 美股、港股 | `WHYJ_QUANT_LLMQUANT_API_KEY` |
| Financial Datasets | 美股价格与快照 | `WHYJ_QUANT_FINANCIAL_DATASETS_KEY` |

在 Market Data 选择兼容的市场/源，填写凭证、可选端点和样本范围，先 Check data，再 Save verified。检查只请求当前源，不保存配置或行情，不用其他源回退证明成功。输入、有效环境凭证或端点变化后须重新检查；关闭面板取消检查，迟到结果不发布。

保存的 key/端点优先于进程环境；移除 key 回到环境凭证，清空端点移除本地覆盖。成功只证明本次日线/NAV 样本，不代表所有端点权限或实时性。保存后刷新行情一次，关闭面板不重复刷新。来源、覆盖及回退规则见[数据源](../quant-harness/source-data-providers.md)。

## 观察组合与展示

| 设置 | 作用 |
|---|---|
| Portfolios | 管理观察标的、名称与分组；当前观察组合不等于实盘账户持仓 |
| Overview Dock | 默认显示行情概览，关闭后释放分析区宽度 |
| Market Colors | 默认红涨绿跌，可切换绿涨红跌；保存只重绘，不额外取数 |

`/portfolio select GROUP` 选择一个已有观察组合；`GROUP` 可以是组合 ID 或带引号的名称。缺少参数、多余参数、未知名称或有歧义的名称不会修改当前选择。

配色不翻转风险、失败和缺失值的语义；新报告冻结所选配色，旧版本不改写。历史 `currentPortfolioFile` 仅用于旧文件导入去重，不决定当前 Overview。交互见[UI/UX](../quant-harness/uiux.md)，比较规则见[组合比较](../quant-harness/portfolio-comparison.md)。

## 研究报告

Auto Artifacts 默认关闭。开启后，合格研究完成且轨迹落盘才自动生成报告；普通命令、恢复会话或打开设置不触发生成，中断的研究轮次不自动生成报告。设置变更不刷新行情。报告来源、版本和分享边界见[成果契约](../quant-harness/artifacts-design.md)。

## Alpha 回测引擎

`WHYJ_QUANT_AKQUANT_PYTHON` 指定引擎使用的 Python；保存设置优先于同名进程环境变量，工具参数不能覆盖解释器。行情样本通过不证明引擎依赖可用，历史结果读取也不要求 Python。安装、版本检查与研究参数见[Alpha 回测](../quant-harness/alpha-backtest.md)。

<a id="diagnostics"></a>

## 数据与工具验证

Tool capabilities 展示工具参数、依赖和副作用；Endpoint check 只读检查单个端点，不保存行情或设置。修改参数/连接使回执失效，端点通过不替代数据草稿的保存检查。sample-verified/local 标签也不表示完整工具已执行，见[工具注册表](../quant-harness/quant-tools-design.md#registry)。

数据诊断须分别识别缺凭证、缺依赖、鉴权、权限、空数据、超时和取消；HTTP 200 的空响应不能算通过。三阶段 Doctor 的 exit 0、ok/ready 只表示报告生成，须读取所选 data phase 的状态并排除网络跳过；单端点 `--tool` 则要求 data.status 为 ready 才成功退出。

数据保存冲突时保留草稿并重新打开最新设置；检查结果不保存为长期权限证明。回归见[数据草稿](../../src/runtime/test/data-settings.test.ts)与[数据诊断](../../src/cli/test/doctor-data.test.ts)，离线 fixture 不替代真实账号验证。

## 社区数据与研究方法

Skills 与 MCP 的选择和连接见[Community Tools](../quant-harness/community-tools.md)。MCP 凭证独立维护，不从这里的行情配置自动复制。
