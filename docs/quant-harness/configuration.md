# WhyJ Quant 配置参考

WhyJ Quant 的配置保存在 `.ohquant/settings.json`；`OHQUANT_DIR` 可指定其他配置目录。使用 `/config` 或 `Ctrl+P` 打开 Settings，选择 `Model`。Doctor 的 `Configure → Model connection` 打开同一个编辑器。

<a id="terminal-keys"></a>

## 研究操作快捷键

默认 `Ctrl+G` 停止当前研究请求，`Ctrl+R` 仅重试失败的 Overview 标的。可在 `settings.json` 中配置，下一次启动生效；空数组禁用对应操作：

```json
{
  "keybindings": {
    "interruptResearch": ["ctrl+x"],
    "retryFailedQuotes": ["ctrl+r"]
  }
}
```

键名不区分大小写，只接受受支持的 Ctrl 字母组合；退出、Settings、Tab、Enter 和 Backspace 已用的控制键保留，两项操作不能占用同一组合。中断保留已保存研究记录，输入“继续”才发起后续请求。它不改变模型 Thinking 设置，也不自动生成被中断轮的报告。

## 模型连接

1. 选择 `Provider`，输入厂商名称或 ID 搜索。
2. 选择 `Model`，搜索实际模型 ID；列表显示名称、上下文容量和 reasoning 能力。目录里没有的模型使用 `Enter custom model ID`。
3. API-key 连接填写 `API key` 或选择 `Provider setup`，例如 Cloudflare 的 key/account/gateway、Bedrock 的 bearer token/AWS profile。OAuth 连接使用下述 `Sign in & Save`。
4. 选择 `Thinking`。可选级别来自 Pi 对当前模型的能力定义；不支持 reasoning 的模型只显示 `off`。
5. 选择 `Save`，或选择 `Save & Verify` 保存并发送一次小型模型请求。

`Connection details` 中可修改端点、协议、当前模型的上下文/输出限制、reasoning 能力，并移除保存的密钥。普通 provider 使用目录默认值，无需手填 URL。自定义连接始终显示这些字段，URL 必填。

普通编辑只修改草稿。Enter 确认当前输入，Esc 退回或丢弃草稿；多步 `Provider setup` 中取消会保留原凭证。输入框支持左右方向键、Home/End、删除和退格；密钥始终遮蔽。空密钥输入保留原值，清除用 `Remove saved key`。

支持 OAuth 的 provider 提供 `Sign in & Save`：先选模型和 Thinking，再按 Pi 提示选择登录方式；授权链接用 `Ctrl+O` 打开、`PgUp/PgDn` 滚动查看，设备码按提示输入浏览器，手动授权码在终端遮蔽。成功后立即保存，后续 Esc 不撤销该登录；登录中 Esc 取消，关闭父面板也会取消。`Sign out` 立即删除当前本地登录或 Pi 链接，OAuth 仍保持选中；Pi 登录本身保留。`Use API key` 是需要 Save 的显式切换草稿。完整流程和验证边界见 [OAuth 生命周期](./configuration.md#oauth)。

保存后，新提交的 prompt/skill、手动压缩或分支摘要读取新设置，无需重启；历史对话和 session ID 保留。当前分析及其工具调用、排队续问保持原连接，直到此次运行结束，避免新密钥被发往旧端点。运行中保存后可用 `Save & Verify` 单独测试新连接。重启并恢复历史会话时，使用当前保存的连接。

模型保存、External Skills 和 Auto Artifacts 开关通过配置通知生效，不附带 Overview 行情刷新。`Save & Verify` 只增加指定的模型诊断；数据 `Save verified` 则刷新行情一次，关闭 Settings 不再次刷新。浏览、取消或保存冲突不发布成功通知。键盘与运行时回归入口见 [UI/UX 契约](./quant-uiux.md)。

模型目录、原生协议、默认 URL、模型能力、API-key/环境凭证解析与 OAuth 协议来自精确锁定的 `@earendil-works/pi-ai`，版本以 [package.json](../../package.json)和 [bun.lock](../../bun.lock)为准。实现参考 [Pi AI provider API](https://github.com/earendil-works/pi/tree/main/packages/ai)，实际契约以安装版本的类型与源码为准。OAuth 本地流程和构建已回归，真实账号另行验证；启动不自动导入 Pi 的 auth.json/models.json。已显式链接的 OAuth 连接在后续模型请求中读取 Pi 的当前账号。

<a id="pi-import"></a>

## 从 Pi 导入连接

启动不自动导入；API-key、请求头与模型元数据是显式导入时快照，OAuth 则可建立共享文件链接。文件格式映射依据 [Pi 0.85.1 models.md](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/models.md)、[provider-composer](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/src/core/provider-composer.ts)和 [AuthStorage](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/src/core/auth-storage.ts)；这是格式依据版本，不是当前运行库版本。当前可接受字段仍由本地校验器和锁定依赖决定，不自动支持未来上游字段。

### 预览与提交

默认读取 `PI_CODING_AGENT_DIR`，未设置时读取用户目录下的 `.pi/agent`。可以用 `--from` 选择其他目录，含空格的路径使用引号。读取缺失文件视为空内容；全部缺失、JSON 损坏或超过单文件 4 MiB 时停止。

`models.json` 支持 BOM、`//` 行注释与尾逗号，对齐 [Pi 0.85.1 的模型文件解析](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/src/utils/json.ts)。WhyJ 使用固定 `strip-json-comments` 5.0.3，也接受块注释；块注释不是此 Pi 版本的兼容保证。字符串内的 `http://`、引号和注释符号保留。`auth.json`、`settings.json` 仍使用严格 JSON。review 哈希基于原始字节，修改注释也必须重新预览；导入阶段不会格式化或写回源文件，链接后的 OAuth 刷新行为见下文。

```text
/config --pi list
/config --pi preview --provider deepseek --model deepseek-v4-pro
/config --pi apply --provider deepseek --model deepseek-v4-pro --review <预览返回的令牌>
```

apply 重新核对源文件原始字节、环境解析结果和 WhyJ settings revision；任一变化都要求重新 preview，不修改现有设置，全部一致后才原子保存。预览只返回模型属性、覆盖范围、凭证来源和 review 令牌，不返回密钥值；预览通过不等于网络可用。

省略 provider/model 时使用 Pi settings.json 的 defaultProvider/defaultModel；缺少所需默认值时明确指定。两次操作须使用相同的目录和选择。preview 检查可映射性，不测试网络；apply 更新活动模型/可支持的 thinking，替换选定模型的元数据，保留同一 provider 的其他已保存模型。该 provider 共用的端点、默认协议和凭证按本次源文件替换，因此预览提示这些字段影响其所有模型；已有模型自己的协议不被新模型的协议覆盖。其他 provider、数据凭证、观察组合、界面偏好和会话保留。

依次选择不同 provider/model 重复 preview/apply，即可保存多个连接。导入后进入 `/config → Model`，Provider 搜索原名称，Model 搜索已保存的模型 ID；切回某 provider 会恢复它上次选择的模型。多个 provider 可使用相同模型 ID，其端点、密钥与能力互不共用。界面的 Protocol 编辑只作用于当前模型；Base URL 和 API key 属于整个 provider。尚未导入的 Pi 模型不会自动全部添加。

CLI JSON 调用：

```powershell
bun run src/index.ts -- --json -c '/config --pi list'
bun run src/index.ts -- --json -c '/config --pi preview --from "C:\Pi Config\agent" --provider local --model my-model'
```

检查 `ok`、`data.applied` 和预览中的覆盖说明；只有 apply 成功才是导入完成。未导入即退出相当于取消。API key 仍保存在 WhyJ 原有明文 settings 存储中；OAuth 只保存本地指针和 Pi 文件路径，不复制 access/refresh token，也不把原始文件内容放入回执。

<a id="pi-mapping"></a>

### 映射与边界

| Pi 输入 | 当前映射 |
|---|---|
| 内置 provider / 目录模型 | 保留 provider ID，使用锁定 Pi 目录 |
| 自定义 provider | 保留名称并声明 custom=true；独立保存、搜索、选择，与旧 custom 连接并存 |
| models 数组中的选定模型 | 替换该模型的目录元数据；默认 input=text、reasoning=false、context=128000、maxTokens=16384、价格=0 |
| modelOverrides 中的选定模型 | 在目录或 models 自定义定义之后应用；支持部分价格覆盖，samplingParams/thinkingLevelMap 按键合并 |
| api / baseUrl | 自定义定义的模型 api/baseUrl 优先于 provider 默认值；仅导入内置 modelOverrides 时保留目录原协议。未显式改 provider 地址时不将选定目录模型的地址固定给整个 provider |
| name / input / cost | 保存 provider/模型显示名、模态、四个基本费率和完整 tiers；由 Pi 按总输入（含缓存）与阈值计算费用 |
| compat | 合并 provider → model → modelOverrides；路由与 chatTemplateKwargs/chatTemplateArgs 的对象按键合并，数组替换 |
| compat.allowedFallbackModels | Anthropic 服务端 fallback 目标列表；保留 provider/model/完整 cost（含 tiers），数组按模型覆盖优先级整组替换 |
| samplingParams | 模型定义后合并 modelOverrides，再交给 Pi 请求构造器；OpenAI 兼容协议中这些字段可覆盖 Pi 生成的请求体字段，其他协议按 Pi 行为忽略 |
| thinkingLevelMap | 保留字符串/null 和缺项，null 标为不支持；Thinking 选项和实际请求使用 Pi 的约束与映射 |
| headers / authHeader | provider 及模型请求头按导入环境解析并保存在凭证快照；模型头优先，authHeader=true 先用解析后的 key 加 Bearer，模型显式 Authorization 可覆盖；false 不表示禁用协议自己的鉴权 |
| auth.json api_key | key/env 属于选定 provider；未选择的 OAuth 不会迁移 |
| auth.json OAuth | 所选 provider 支持 OAuth 且记录有效时，`oauthId` 指向本地链接文件；模型请求通过该文件定位 Pi 当前账号，Pi 负责刷新与鉴权派生；不复制 token |
| `$NAME`、`${NAME}`、`$$`、`$!` | 按导入时凭证 env/进程 env 解析；普通全大写字符串仍是字面值 |
| !command / 未知字段 / 无效 OAuth | 拒绝选定连接的导入，不静默删除或改成 API-key 连接 |

模型头在原始 Pi 文件中的合并顺序与能力字段不同：modelOverrides.headers → models.headers，之后覆盖 provider 请求头；实际鉴权合并不区分大小写。预览只显示请求头数量、采样参数数量、兼容字段名及阶梯数量，不输出头值。头部环境变量变化同样使 review token 失效。

单模型 baseUrl 导入后在编辑器显示 Model URL，清空该项恢复 provider 默认地址。共用 Base URL 仍可独立编辑。元数据校验和合并在 [model-metadata.ts](../../src/agent/src/model-metadata.ts)，传输和计费由 Pi 实现。

`allowedFallbackModels` 使用当前锁定 Pi 的类型契约。每项必须提供非空 provider/model 和完整非负费率，tiers 延续现有价格校验；空列表让 Pi 省略 `fallbacks`。Anthropic 请求只发送目标 model ID，不发送本地价格。服务返回的模型与同 provider 的目标匹配时，Pi 使用该目标价格及阶梯，并在回复中保留实际模型 ID；这不是 WhyJ 发起的跨供应商重试，也不证明供应商一定接受这些 fallback 目标。实现证据见 [Pi Anthropic 传输](https://github.com/earendil-works/pi/blob/v0.85.1/packages/ai/src/api/anthropic-messages.ts)。

模型元数据、API key、请求头和设置不是双向同步：Pi 后续改动需重新预览/导入。链接的 OAuth 凭证例外，模型请求从 Pi `auth.json` 读取当前账号并在需要时刷新。通用自定义端点支持 Completions、Responses、Anthropic Messages、Gemini；内置 API-key provider 还保留其目录声明的原生协议。专用原生路径如下，鉴权和请求均经 Pi 自身 provider，不改成通用 custom 连接。

| Pi provider ID | 原生协议 | 导入后保留的配置 |
|---|---|---|
| `azure` | `azure-openai-responses` | API key、AZURE_OPENAI_BASE_URL / AZURE_OPENAI_RESOURCE_NAME / AZURE_OPENAI_API_VERSION 等环境设置 |
| `amazon-bedrock` | `bedrock-converse-stream` | Bearer token 或 AWS_PROFILE / IAM 等凭证链；无 key 的 profile/IAM 不生成 local token |
| `google-vertex` | `google-vertex` | API key 或 GOOGLE_APPLICATION_CREDENTIALS / project / location；服务账户文件仅保留路径，不导入文件内容 |
| `mistral` | `mistral-conversations` | Mistral API key、原生模型与地址 |

协议选择器显示当前 provider 的原生协议及通用兼容协议。需要原生传输时使用原 provider ID；自定义名称配 Bedrock/Vertex 等专用协议会拒绝，避免缺失其凭证解析流程。无需固定 URL 的内置连接可留空，面板显示 Provider environment/default。预览展示模型配置地址，最终原生请求地址由 Pi 结合环境配置计算，例如 Azure 的 AZURE_OPENAI_BASE_URL 优先于模型 baseUrl。

OAuth-only provider 可导入有效的选定 OAuth 记录，不能用 type=api_key 伪装成可用连接。兼容字段使用固定白名单，不能推定已支持 Pi 全部字段或未来版本。WhyJ 的独立 OAuth 登录仍可使用，见 [OAuth 文档](./configuration.md#oauth)。共享链接与 Pi [AuthStorage](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/src/core/auth-storage.ts) 使用同一 `auth.json` 文件锁；后续刷新只写选定 provider，保留其他记录及文件权限。`Sign out` 删除 WhyJ 的本地链接，不退出 Pi 或撤销供应商账号；链接缺失或损坏时不自动回退到 API key。用户不执行 apply 就不会建立链接。选定 OAuth 的真实账号权限与令牌轮换尚未验证；独立 API-key 检查不证明 OAuth 并发轮换，也不执行 Pi shell credential。


导入 API-key 优先取选定 provider 的 auth.json，其次 models.json；环境解析保存实际值，不把环境变量名称当 key。OAuth-only provider 不能被 API-key 冒充，损坏或无效的已选 OAuth 必须拒绝，不回退为另一种认证。

实现与回归：[导入映射](../../src/agent/src/pi-config-import.ts)、[文件快照](../../src/storage/src/pi-config.ts)、[模型元数据](../../src/agent/test/pi-model-metadata.test.ts)、[原生协议](../../src/agent/test/pi-native-protocols.test.ts)、[fallback](../../src/agent/test/pi-model-fallback.test.ts)、[OAuth 链接](../../src/runtime/test/pi-oauth-link.test.ts)。这些测试使用临时文件/合成凭证或 localhost，不读取个人账号。

<a id="pi-verification"></a>

连接导入后，可用 `/doctor --phase model` 验证 WhyJ 当前选定的连接；构建后的非交互入口是 `node dist/index.js --json doctor --phase model`。这会发送真实模型请求并产生用量，不验证 Pi CLI 的并发使用、共享 OAuth 刷新、完整研究任务或长期可用性。

2026-10-15 移除了早期双 CLI 检查脚本：它硬编码 `deepseek/deepseek-v4-flash` 和旧 `@mariozechner/pi-coding-agent` 安装布局，只有 `--output` 参数，并没有此前文档声称的模型选择与帮助入口。那次观察不能充当任意当前连接的复验方法。Pi 导入与 OAuth 的确定性回归仍按上方实现索引运行；若需要重新验证双 CLI 并发，必须显式选择实际安装版本、连接与隔离目录，不从单侧 Doctor 成功推断双侧通过。

<a id="oauth"></a>

## OAuth 的所有权与失败语义

`providers[id].oauthId` 只保存引用；独立登录和 Pi 共享链接都位于 `.ohquant/model-auth/{uuid}.json`。独立凭证是明文原始记录，原子写入并请求 0600 权限，不是系统密钥链，也不保证 Windows ACL 隔离。版本 2 的 Pi 链接只记录 provider 与 auth 文件路径，不复制 access/refresh token；路径也是私有信息，不进入公开报告或行情缓存清理。

每次独立登录生成新 UUID，在途请求继续拥有旧引用；旧凭证不自动按“历史无用”删除。同一 Pi 账号链接重复导入可复用指针；Pi 改换账号后，下一独立请求读到当前记录。设置有 OAuth 引用时，缺失、坏 UUID/JSON、provider 不匹配或刷新失败均要求修复/重新登录，不降级到 API-key。编辑器显示 linked/saved 只证明本地引用存在，不证明远端权限。

`signInModelConnection` 在 Pi 授权后重新核对工作区、取消状态和 settings revision，再提交设置。冲突或提交前取消清理本次临时凭证，保留原连接；`onSaved` 同步父面板，不做第二次保存。过期窗口、刷新请求和派生鉴权交给锁定 Pi；派生 headers（含 null 移除）与 base URL 必须保留。Bun 构建显式注册 OAuth flow loader，避免动态路径模块未打入单文件包；独立 bundle 的登录提示/取消测试不等于真实账号授权。

刷新锁与同步 settings 锁分开：独立凭证采用 5 秒心跳、90 秒失效、最多 60 秒等待的异步租约；共享链接沿用 Pi auth.json 同路径的 proper-lockfile，30 秒失效、5 秒心跳。等待可取消，锁内重读凭证，别的请求已刷新则复用；Pi 文件只更新选定账号，保留其他记录和权限。Windows 对同一凭证锁路径的 mkdir/rmdir 竞争使用有界 40 ms 重试，不把所有文件错误变成可重试。

刷新失败保留原凭证字节；轮换已返回新 token 后即使请求随后取消，仍保存已确认轮换结果，调用方收到取消。租约失效拒绝晚到提交，也不能释放其他持有者的锁。崩溃接管回归使用真实子进程、人工老化锁时间；它不证明实际等待 90 秒或任意文件系统恢复。远端已轮换但响应丢失、或本地提交前崩溃，仍可能需要重新登录。

Sign out 与刷新使用同一文件锁，必须等删除和锁释放整个操作完成；完成后旧等待者不能重新创建凭证。退出只移除本地凭证或 Pi 链接，不远端撤销授权、不删除 Pi 登录，也不召回已发出的请求。文件消失不是 UI 操作已完成，相关反思见[失败恢复](../blog/12-recovery-as-ux.md)。

实现入口：[runtime 登录与退出](../../src/runtime/models/model-oauth.ts)、[Pi 鉴权适配](../../src/agent/src/model-oauth.ts)、[凭证存储](../../src/storage/src/model-auth.ts)、[共享链接](../../src/storage/src/pi-oauth.ts)。[生命周期回归](../../src/runtime/test/model-oauth.test.ts)、[链接回归](../../src/runtime/test/pi-oauth-link.test.ts)和[面板回归](../../src/tui/test/model-oauth-panel.test.ts)覆盖合成账号、并发/崩溃、取消、冲突及隔离，不证明个人订阅、浏览器授权或真实 Pi/WhyJ 两个终端的令牌轮换。

## 保存冲突与文件恢复

设置保存使用进程间锁和原子替换，并校验打开草稿时的文件版本。另一终端或外部编辑器已修改文件时，保存会提示 `Settings changed`，保留当前草稿且不执行 Save & Verify 的网络验证。记录需要保留的修改后，退出并重新打开 `/config`，在最新配置上重新编辑。`Settings busy` 表示另一个写入尚未结束，可在当前草稿上重试保存。

JSON 损坏或关键字段类型错误时，应用保留原文件并提示修复，不自动覆盖成默认配置。修复或从自己的备份恢复 `.ohquant/settings.json` 后重新启动；没有备份时，先保留损坏文件的副本，再按下方配置示例修复。`whyj --help` 在配置损坏时仍可使用；`whyj --json doctor` 会返回 `ok: false`、`error.code: settings_unavailable` 和非零退出码，不输出原始文件内容。凭证仍保存在原来的本地配置中，此机制不增加密钥历史副本。

## 连接字段与优先级

| 字段 | 含义 |
|---|---|
| `provider` | Pi provider ID、已声明的自定义 provider 名称，或 `custom` |
| `providers[id].custom` | true 显式声明非内置的命名端点；Pi 导入自动填写，未声明的未知 provider 报错 |
| `model` | 实际模型 ID，保留大小写、命名空间和 `[1m]` 等后缀 |
| `providers[id].apiKey` | 仅该 provider 使用的保存密钥 |
| `providers[id].oauthId` | 本地 OAuth 登录或 Pi 账号链接引用；优先于 API-key，缺失/刷新失败时要求重新登录；由 Sign in & Save 或已审阅的 Pi apply 生成 |
| `providers[id].headers` / `authHeader` | 导入的请求头快照及显式 Bearer 设置；值不在预览中输出 |
| `providers[id].compat` | provider 兼容默认值；模型层可覆盖 |
| `providers[id].env` | 该 provider 的环境设置，由 Pi 设置流程填写，也可编辑 JSON |
| `providers[id].baseUrl` | 覆盖此连接端点；留空使用 provider 默认值 |
| `providers[id].api` | provider 的默认协议覆盖；留空使用当前模型的 Pi 原生协议 |
| `providers[id].model` | 上次选用的模型，切回 provider 时恢复 |
| `providers[id].models[modelId]` | 仅该模型的协议/能力覆盖；api/baseUrl 优先于 provider 默认值，支持 contextWindow/maxTokens/reasoning/name/input/cost（含 tiers）、headers/compat/samplingParams/thinkingLevelMap；完整定义标记 replaceCatalog |
| `thinkingLevel` | 请求的推理级别，保存/请求时按模型能力约束 |

未选择 OAuth 时，模型凭证优先使用当前 provider 保存的 key，再按 Pi 规则读取其环境变量，例如 `OPENAI_API_KEY`、`GEMINI_API_KEY`、`DEEPSEEK_API_KEY`。环境值优先级为 `providers[id].env` → `settings.env` → 进程环境。不同 provider 不共享保存的 key；显式 `provider` 模式不会回退到旧的 `WHYJ_QUANT_API_KEY` 全局槽位。

已导入的命名自定义 provider 和模型会出现在同一搜索列表中；切换 provider 恢复其上次使用的模型。Protocol 编辑当前模型的覆盖，选择 Provider default 清除该模型覆盖；Base URL 和 API key 仍由同一 provider 的所有模型共用。不同工作区的自定义目录互不污染 Pi 内置目录。

若模型包含独立地址，编辑器另显示 Model URL，清空后使用 provider 默认地址。兼容/采样/请求头等元数据通过 Pi 文件导入或本地 JSON 配置保存；精确合并顺序、采样参数覆盖请求体的行为和当前协议边界见 [导入契约](./configuration.md#pi-mapping)。

端点与协议分别设置，不通过 `/v1` 或厂商名字猜测协议。例如 OpenAI 默认是 `openai-responses`，DeepSeek 默认是 `openai-completions`，Google 是 `google-generative-ai`，MiniMax CN 是 `anthropic-messages`。原生 provider 的其他协议仍由 Pi 分派；Custom 支持上述四种协议。空凭证的 Custom 用固定 `local` 占位 token，可供忽略鉴权的本地兼容服务使用。

Azure、Bedrock、Vertex、Mistral 的原生协议也可导入并在各自 provider 的 Protocol 列表中选择。环境凭证保留原类型：AWS profile/IAM、Vertex ADC 不替换成伪 API key。无需固定 URL 的内置连接显示 Provider environment/default；原生 SDK 仍按其环境变量优先级解析最终端点。字段、测试和自定义名称的边界见 [Pi 原生协议导入](./configuration.md#pi-mapping)。

`contextWindow`、`maxTokens` 必须为正整数，输出限制不超过窗口。覆写能力仅描述服务实际支持的限制，不会提升服务端容量。自动压缩阈值仍使用 `env.WHYJ_QUANT_COMPACT_TRIGGER_TOKENS`，默认 `contextWindow - 16384`，上限为当前模型窗口。

`/config`、`/doctor` 与 `/artifact` 的 TUI/非 TUI 边界见 [Slash Command 参考](./product-guide.md#commands)。

## 用户可见设置

| Settings 分组 | 面板选项 | JSON 字段 | 默认值 | 语义 |
|---|---|---|---|---|
| Agent Runtime | `Model` | `provider`、`model`、`providers`、`thinkingLevel` | 编辑器初始为 DeepSeek V4 Pro；凭证未配置 | 打开上述统一模型连接编辑器；Thinking 在其中按模型能力选择。 |
| Research Data | `Market Data` | `preferences.source`、`preferences.defaultMarket` | `llmquant-data` / `A`；编辑器选择兼容的样本市场 | 打开 Data connection 草稿编辑器。验证后保存，Overview 与 Agent 的后续刷新/调用使用新配置；普通取数仍保留定义的 fallback 链。 |
| Research Data | `Data Token` | 对应 `env.WHYJ_QUANT_*` key | 未配置 | 打开同一个 Data connection 编辑器并聚焦密钥输入；AKShare 不需要 token。只在样本验证成功并执行 Save verified 后保存。 |
| Research Data | `Portfolios` | `.ohquant/panel-portfolio.json` | 空组合列表 | 打开自定义组合编辑器；保存代码、名称、instrument 与分组关系。所有组合展示在 Overview，报价自动刷新。 |
| Workspace Experience | `External Skills` | `skillIntegrations.external` | `false` | 开启后额外加载用户级 Codex、Claude、Agents 和 pi skills；项目量化 skills 始终加载。 |
| Workspace Experience | `Overview Dock` | `showPortfolioPanel` | `true` | 显示右侧 Overview dock；关闭后 Analyzing 面板使用完整终端宽度。 |
| Workspace Experience | `Auto Artifacts` | `artifactGeneration.auto` | `false` | 开启后在量化分析 turn 完整结束时生成 Dashboard + Trajectory 并打开浏览器；关闭时不自动生成。`/artifact` 始终只浏览、恢复和打开已有报告。 |
| Workspace Experience | `Market Colors` | `preferences.marketColorScheme` | `red-up` | 红涨绿跌；可选 `green-up` 绿涨红跌。同一工作区的 A/HK/US/基金统一使用所选约定，立即重绘且不额外刷新行情；新报告保存该选择，历史版本不改写。 |
| Workspace Experience | `Status HUD` | `preferences.hudMode` | `full` | `full` 显示上下文、延迟和轮数；`context` 隐藏延迟；`off` 隐藏这些指标，保留模型和来源。立即生效，重启保留，不触发行情请求。 |
| Workspace Experience | `Compact At` | `env.WHYJ_QUANT_COMPACT_TRIGGER_TOKENS` | 模型窗口减 16384，最低 1 | 输入 1 到当前窗口之间的 token 数，或 `auto` 恢复自动值；Esc 取消。显示解析后的实际阈值，下一次 prompt 按现有自动压缩流程检查。 |

行情变化、评分/风险和命令结果使用不同语义：切换 Market Colors 不翻转回撤/VaR、成功/失败的颜色；显示精度下的零变化及缺失值保持灰色。完整约定见 [DESIGN](../../DESIGN.md)。

模型性能基准入口、失败/取消语义及 HUD 统计口径见 [模型性能测试](./evaluation.md#model-performance)。Status HUD 只控制展示，不修改模型上下文窗口；Compact At 控制压缩触发，不能扩大供应商窗口。环境中的旧阈值仍按原优先级读取；在面板保存 `auto` 会明确使用自动值。

`Auto Artifacts` 只对自然语言量化研究请求生效。运行时会在 turn 完成、session JSONL 已写入后生成报告；证券、基金或组合分析会要求 agent 先形成可审计的技术与风险指标链。仅打开设置、恢复 session 或执行普通本地命令不会生成报告。

## 扩展管理

扩展管理使用 `/config --extensions list|enable|disable|reload [id]`，详见 [Slash 参考](./product-guide.md#commands)。`disabledExtensions` 是当前构建扩展 ID 的禁用数组，缺失或空数组表示默认启用全部注册扩展。它由 storage 校验、去重并排序，未知 ID 保留但显示 unavailable；类型错误或非法名称拒绝读取并保留原文件。启停保存复用 settings revision 与进程锁，其他运行中的终端需重启读取新选择。此字段不包含包路径、脚本或凭证；不决定独立 Overview/Doctor 数据服务的可用性。

## Market Data 与凭证

内置行情源使用本节的统一配置入口。可选 MCP 服务的介绍、官方链接和连接参数见 [Skills 与 MCP 指南](./trader-skills.md#mcp)；`/mcp install <name>`、`/mcp remove <name>` 按需维护 Pi 配置，`/mcp export <name>` 导出模板。本页行情设置不会自动转成 MCP 凭证。

| Market Data | 主要市场 | Data Token |
|---|---|---|
| `akshare` | A 股、指数、基金 | 不需要 |
| `tushare` | A 股、基金 | `WHYJ_QUANT_TUSHARE_TOKEN` |
| `llmquant-data` | 美股、港股 | `WHYJ_QUANT_LLMQUANT_API_KEY` |
| `financial-datasets` | 美股价格与快照 | `WHYJ_QUANT_FINANCIAL_DATASETS_KEY` |

`/config → Market Data` 或 Doctor 的 `Configure → Market Data` 打开同一个编辑器：

1. 在 `Market`、`Source` 按 Enter 切换；顶部列出所选市场兼容的源及 Python/凭证要求。
2. 编辑 `API key`、可选 `Endpoint`、`Symbol` 和 `Start` / `End`。密钥遮蔽，空输入保留原值；`Remove saved key` 在草稿中移除保存值并回到环境凭证。端点空输入移除本地覆盖，依次使用环境端点、provider 默认值。
3. 选择 `Check data`，仅请求当前源的样本。不会保存配置或行情。通过后显示有效行数、数据截止日及有限能力范围。
4. 选择 `Save verified` 才写入配置并触发运行时刷新。修改任何检查输入后须重新检查；有效环境凭证或端点变化同样使保存资格失效。保存冲突/遇锁时保留草稿。

检查期间 Esc 取消请求并留在编辑器，再按 Esc 退出、丢弃草稿；编辑输入时 Esc 仅取消当前输入。关闭父面板、切换面板或退出应用会取消请求，晚到结果不再更新界面。异步检查完成会主动刷新面板，无需按键。检查标的/日期和成功证据只用于本次草稿，不写成长期权限证明。

Tushare 配置示例：选择市场 `A`、源 `tushare`，填写 token，执行 `Check data → Save verified`。日线和 symbol 搜索均会使用该 token；紧凑快照不会调用需要额外积分权限的 `daily_basic`，避免把权限错误误报为配置未生效。

`/doctor --phase data` 只读检查当前数据源，复用实际行情适配器，检查期间不保存配置或行情缓存。保存的行情 key/端点优先于进程环境；诊断开始时固定配置快照。默认采用兼容市场的样本和最近 30 天窗口，文本的 `data sample` 与 JSON 的 `config.dataRequest` 明示范围。AKShare 必须通过同一 Python 环境的包检查并实际取得有效行情，HTTP 200 或包可导入都不足以判定可用。

JSON 的 data phase 另含 `data.status`、标的/日期、行数、asOfDate、凭证来源和依赖版本。`ready` 仅证明这份日线/单位 NAV 样本；缺凭证、缺 Python/包、鉴权失败、权限不足、无有效数据、超时和取消分别报告。诊断不使用其他 provider 的回退结果证明所选源可用；其他端点需单独检查。

### Tool capabilities 与端点检查

Data connection 中选择 `Tool capabilities`，或在 Doctor 中按 `v`。输入工具名称搜索，Enter 查看实际参数、市场、provider、依赖、权限和副作用。列表来自同一份可执行注册表；`sample-verified` 是样本输入通过，`local` 仅表示不需要行情 provider，二者都不是工具已执行。

详情按 `p` 打开 `Endpoint check`。在 Endpoint 行按 Enter 切换该工具的兼容端点；Parameters 编辑 JSON 对象，按界面列出的 required 参数填写，选择 Check 才发出请求。例如基金净值端点参数为 `{"symbol":"270042","indicator":"单位净值走势"}`。API key 仍来自当前数据草稿或环境，不放进参数 JSON。

检查只读取一个 source 端点，不写入行情、研究记录或设置。显示端点、参数、非空行数、检查时间及失败原因；通过只证明这次响应，未验证实时性或其他权限。取消、修改参数和连接、关闭父面板使旧证据失效；结果不跨编辑器长期保留。端点检查不代替 `Check data → Save verified` 的配置保存条件。完整协议见 [工具注册表](./quant-tools-design.md#registry)。

<a id="diagnostics"></a>

### Doctor 诊断的范围

Doctor 的 `Run diagnostics` 检查已保存的模型、工具和数据，不保存草稿。关闭 Doctor、进入 Configure 或启动另一轮 Doctor 会取消旧诊断；旧状态不能重新打开面板或覆盖新一轮结果。模型编辑器的 `Save & Verify` 仍是保存模型后独立检测模型，与数据的验证后保存流程不同。

诊断按 Model、Tools、Data 三阶段运行：小型模型响应、实际工具注册/schema/依赖、所选源日线或 NAV 样本。普通阶段失败仍继续其他阶段，取消才中止；`--phase` 之外的阶段必须保持未测，不能合成为全系统通过。单源诊断不用缓存、其他 provider 回退或悄悄扩大日期窗口证明成功，HTTP 200 的空数据也失败。

缺凭证、缺 Python/包、鉴权、权限、空响应、超时与取消分别呈现；分类是已知作用范围，不承诺找出所有底层根因，也不回显可能含密钥的供应商原始异常。Doctor 不后台监控、不自动修复、不全量扫描端点，更不是性能或历史数据质量验收。

三阶段 Doctor 的 exit 0 / `ok` / `ready` 只表示报告生成；自动化须读取 overall、requestedPhases、各阶段 status，并排除 `WHYJ_DOCTOR_SKIP_NETWORK` 引发的跳过提示。`/doctor --tool` 是不同契约：选定端点确实 ready 才 exit 0。具体调用见[命令参考](./product-guide.md#commands)，不要混用两种退出码。

实现与回归：[Doctor](../../src/cli/doctor.ts)、[数据检查](../../src/runtime/data/data-readiness.ts)、[配置草稿](../../src/runtime/test/data-settings.test.ts)、[诊断导航](../../src/tui/test/doctor-navigation.test.ts)。离线 fixture 只证明相应分支；真实账户和端点需显式复验。

## 可选 Alpha 引擎

`alpha_backtest` 使用 `env.WHYJ_QUANT_AKQUANT_PYTHON` 指定的 Python 可执行文件；也可在启动前设置同名进程环境变量，保存配置优先。解释器路径由用户配置，工具参数不能覆盖。AKQuant 0.3.58/规则 1.5.4 的安装、检查、调用示例和复跑方式见 [Alpha / AKQuant](./alpha-backtest.md)。Tool capabilities 显示缺失前提，`alpha_engine_status` 执行实际导入/版本检查；行情端点通过不代表引擎可用。历史 `alpha_runs` 不需要 Python。

## 规范化配置示例

```json
{
  "version": 3,
  "env": {
    "WHYJ_QUANT_TUSHARE_TOKEN": "your_token"
  },
  "provider": "deepseek",
  "model": "deepseek-v4-pro",
  "providers": { "deepseek": { "apiKey": "your-provider-key" } },
  "thinkingLevel": "high",
  "showPortfolioPanel": true,
  "artifactGeneration": {
    "auto": false
  },
  "skillIntegrations": {
    "external": false
  },
  "permissions": {},
  "preferences": {
    "defaultMarket": "A",
    "defaultBenchmark": "000300.SH",
    "defaultCash": 100000,
    "defaultFast": 20,
    "defaultSlow": 60,
    "currentPortfolioFile": "holdings.json",
    "source": "llmquant-data"
  }
}
```

`preferences.currentPortfolioFile` 仅供显式旧文件导入时的去重排序，已经不决定 Overview 内容或自动读取路径。组合入口见 [Slash Command 参考](./product-guide.md#commands)。

## 兼容迁移

没有 `provider` 的旧设置继续使用角色别名和 `WHYJ_QUANT_*` 模型变量。打开编辑器时将当前连接转换为明确的 provider/实际 ID 草稿，保留实际端点、密钥及窗口覆盖；只有 Save 才写入新连接。新模式中的实际 ID 不受旧 `WHYJ_DEFAULT_*_MODEL` 映射强制改写，窗口改用当前模型的能力覆盖。未编辑的旧默认配置仍保存 `model: "sonnet"`，其默认解析为 `deepseek-v4-pro`。

加载设置时会执行规范化并写回：

- v1、v2 配置统一升级并写回为 `version: 3`。
- v2 的 `artifactGeneration.mode: "auto" | "manual"` 会迁移为 `artifactGeneration.auto: true | false`；旧字段不再写回。
- 旧的 `skillIntegrations.codex` 或 `skillIntegrations.claude` 只要任一为 `true`，迁移为 `skillIntegrations.external: true`；旧字段不再写回。
- 旧的无运行时效果的 `insightEnabled` 字段会被移除。
- `Thinking: off` 是合法持久化值，不会再被改回 `high`。
- 未知的 thinking level 或 market-data source 会回退到对应默认值。

密钥不得输出到日志、Artifact 或完整配置摘要中。`/config` 和 `/doctor` 只显示存在状态或脱敏值。

## 测试方式

```powershell
bun test src/tui/test/settings-refresh.test.ts src/tui/test/research-workflow.test.ts
bun test src/runtime/test/model-benchmark.test.ts src/runtime/test/hud.test.ts tests/app/app-hud.test.ts src/tui/test/hud-settings.test.ts
bun test src/tui/test/market-colors.test.ts src/artifact/test/market-colors.test.ts
bun test src/agent/test/model-connection.test.ts src/agent/test/model-request.test.ts src/tui/test/model-settings-panel.test.ts
bun test src/storage/test/durable-preferences.test.ts src/tui/test/settings-conflict.test.ts
bun test src/runtime/test/data-readiness.test.ts src/cli/test/doctor-data.test.ts
bun test src/runtime/test/data-settings.test.ts src/tui/test/data-settings-panel.test.ts tests/app/app-doctor.test.ts
bun test src/runtime/test/tool-readiness.test.ts src/cli/test/doctor-tools.test.ts src/tools/test/tool-cancellation.test.ts
bun test src/runtime/test/tool-probe.test.ts src/tui/test/tool-capabilities-panel.test.ts
bun run typecheck
bun run check:architecture
bun run test
bun run build
```

单元测试使用真实 Pi 目录和 SDK 请求构造器；集成测试仅连接 `127.0.0.1` 临时服务，覆盖切换、会话保留、空响应、401、超时、配置修复和 smoke 结果判定。面板测试覆盖搜索、草稿、分步凭证设置、密钥遮蔽及 60×20/80×24/120×32 渲染。

持久化测试使用独立临时目录，覆盖同版本草稿的八进程竞争、组合的八进程修改、旧草稿冲突、迁移遇锁、损坏文件保留和 CLI 错误。面板回归覆盖 80×24 的冲突提示、保存重试、取消密钥草稿和失败开关回滚，不使用真实账户。

账户连通性需要单独验证：运行 `Save & Verify`，或 `bun run src/index.ts -- -c "/doctor --phase model"`。只检查模型时，未检测的 Tools/Data 保持 pending；JSON 的 `requestedPhases` 说明本次范围。`bun run test:providers` 发送真实最小请求，读取当前配置，任何错误、空回答或超时都返回失败；会产生供应商请求用量。离线测试通过不代表真实账户已通过验证。

Doctor 保留原有命令返回约定：退出码 `0`、JSON `ok: true` 和 `ready: true` 表示诊断报告已生成，不保证模型或数据服务可用。自动化检查需读取 `data.phases` 中 `phase: "model"` 的 `status === "pass"`，同时确认没有 `Network probe skipped` 警告。模型返回 401 时报告应为 `partial_fail`，模型 phase 为 `fail`。需要按连通性设置进程退出码时使用 `bun run test:providers`。

连接选择与请求绑定分别由 [配置回归](../../src/agent/test/model-config.test.ts)和[连接回归](../../src/agent/test/model-connection.test.ts)检查；它们不证明真实账号权限。

单独的 `/doctor --tool …` 是端点请求检查：`data.status === "ready"` 才返回 `ok: true` 和退出码 0，失败/空响应为非零；不是三阶段诊断报告的 `ready` 约定。用法见 [Slash 参考](./product-guide.md#commands)。
