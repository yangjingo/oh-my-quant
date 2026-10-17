# Skills 与 MCP：预制入口与 Pi 加载

更新：2026-10-16。JQ 只维护推荐目录、一键下载与加载入口。Skills 的目录扫描、元数据解析、忽略规则和模型索引直接复用锁定的 `@earendil-works/pi-coding-agent`；工作流、依赖和使用方法由上游 `SKILL.md` 维护。

<a id="toolkit"></a>

## 从研究任务找到工具

| 入口 | JQ 提供什么 | 如何开始 |
|---|---|---|
| 内置行情与量化工具 | 数据适配器、因子、回测、风险与报告 | `/config → Market Data`，按需填写凭证，检查并保存 |
| 预制 Skills | 两个仓库的下载版本和十个可选入口 | `/skill install` 查看选项，再按名称安装；`/skill remove` 移除 |
| MCP 扩展 | 预制目录、Pi 配置增删和模板导出 | `/mcp` 选择服务；连接与认证由 Pi 等 MCP 宿主负责 |

行情接入范围见[数据源](./source-data-providers.md)，配置见 [Market Data](./configuration.md#market-data-与凭证)。MCP 参数不放入 `.ohquant/settings.json`。安装 Pi SDK 以复用 Skills API，不意味着 JQ 自动启动了 Pi 的 MCP 会话。

### 预制研究技能

| 上游 | 默认入口 | 主要用途 |
|---|---|---|
| [LLMQuant/skills](https://github.com/LLMQuant/skills) | `llmquant-data`、`llmquant-macro`、`llmquant-equities` | 数据、宏观与公司研究 |
| 同上 | `llmquant-portfolio`、`llmquant-risk` | 组合与风险研究 |
| [Claude Trading Skills](https://github.com/tradermonty/claude-trading-skills) | `technical-analyst`、`market-breadth-analyzer` | 图表与市场广度 |
| 同上 | `position-sizer`、`macro-regime-detector`、`market-environment-analysis` | 仓位、跨资产宏观与市场环境 |

JQ 负责帮助用户找到并加载这些指令。Python 包、数据服务、账户权限和输入材料按各技能上游说明准备；安装成功只表示源码已下载，不是运行结果认证。

<a id="installation"></a>

## 一键下载与加载

```text
/skill install
/skill install technical-analyst llmquant-risk
/skill
/skill info technical-analyst
/skill run technical-analyst --image "C:\Charts\weekly.png" 分析这张周线图
/skill remove technical-analyst
/skill install technical-analyst
/skill reload
```

`/skill install` 不带名称时展示可选清单，等同 `/skill catalog`，不下载。`/skill install <name> [name ...]` 只启用选中的技能，需要首次下载时才使用 Git 和 GitHub 网络。`/skill install --all` 显式选择全部预制项。共享仓库会完整下载并缓存，但模型只看到所选技能；清单区分 available、cached 和 selected。启动不自动下载。选择变化后刷新发现缓存和建议列表，空闲会话在下一次独立请求加载新内容。

`/skill remove <name> [name ...]` 移除 JQ 管理的加载选择，不删除共享仓库源码或用户修改。选择保存在安装根的 `.selection.json`；空数组表示该仓库不加载任何技能，缺失记录兼容旧安装。再次 `/skill install <name>` 可离线启用已缓存技能。项目自带与用户外部技能仍在各自来源管理，不能由此命令删除。

要安装其他仓库或显式更新已有仓库，使用 `/skill install <owner/repo>`。修改本地 `SKILL.md` 后执行 `/skill reload`。进行中的请求和已排队续问保持原快照，避免一次研究中途替换指令。

| 预制仓库 | 下载版本 |
|---|---|
| LLMQuant/skills | [1918237](https://github.com/LLMQuant/skills/tree/1918237467c2dff4cc97a18ebc0892dfd46e8129) |
| tradermonty/claude-trading-skills | [a2506fd](https://github.com/tradermonty/claude-trading-skills/tree/a2506fd1bab662723fb7142734320fef23fc48fa) |

提交号仅用于可重复下载。JQ 不再维护逐文件哈希、逐技能 Python/网络探测、模式资格或报告审计。更新事务仍保护本地改动：已有仓库存在 tracked/untracked/ignored 变化时拒绝更新；新安装在临时目录准备成功后发布，失败或取消只清理本次临时内容。

<a id="discovery"></a>

## Pi 负责加载，JQ 负责路径和会话接线

项目祖先的 `.agents/skills`、`.pi/skills` 和 JQ 安装目录参与发现；`OHQUANT_SKILLS_DIR` 可指定安装根。External Skills 打开后才加入用户级 Codex、Claude、Agents 和 Pi 目录。删除本仓库的 `.claude` 配置不会删除用户自己的外部技能。

JQ 将选择的目录或精确文件路径交给 Pi 的 `loadSkills`（`includeDefaults: false`），用 `parseFrontmatter` 读取正文快照，用 `formatSkillsForPrompt` 生成模型索引。普通仓库用 `loadSkillsFromDir` 枚举 `skills/` 或根目录，之后按名称保存选择、按文件加载，避免同目录中已移除的 Markdown 技能重新出现。管理命令遇到多个仓库的同名技能会拒绝修改，需先在源仓库解决重名；项目与外部路径的发现优先级仍保留第一项。

这些函数通过一个 [Pi 适配文件](../../src/agent/src/pi-skills.ts)导入锁定版本的包内模块，避免 SDK 总入口带入完整应用与额外的模型注册。包内路径不是稳定的独立导出，升级 Pi 时须同步验证；Bun / Node 独立打包测试覆盖无运行时 SDK 安装的技能发现和提示词生成。

模型索引包含名称、描述和文件位置；`disable-model-invocation` 交给 Pi 的格式化规则处理。显式 `/skill:<name>` 和 `/skill run <name>` 共用一个入口，将技能正文交给现有会话。Pi 的命令展开器不是独立公开 API，因此 JQ 保留一个很小的正文包装适配，兼容现有会话快照和 `SKILL.<name>` 显示。

<a id="readiness"></a>
<a id="capabilities"></a>

## 依赖与调用边界

2026-10-16 起撤销 JQ 自建的 `requirements-met`、`needs-input`、`blocked`、`unverified` 技能状态，以及 `--check`、`--check-imports`、`--check-network` 和 `/skill audit` 命令。旧参数会被命令预检拒绝。详情只展示来源、路径、描述和模型可见性。

技能依赖由上游指令和实际工具调用处理。通用会话仍检查显式图片、保留取消与资源刷新语义；量化任务仍约束工具、对象和日期。项目可提供通用宿主扩展策略，但默认加载流程不再按具体技能名称维护资格。

<a id="supplied-evidence"></a>

解释用户提供的材料时，保留出处、日期、缺项和推断边界。读取技能只取得工作流指令，不会生成独立的行情或账户证据；实际量化结论仍由[研究任务](./README.md#tasks)与[工具计算](./quant-tools-design.md)的证据链负责。

<a id="mcp"></a>

### MCP 服务目录与连接参数

JQ 提供以下管理命令，使用 Pi 1.2.0 自带的 `loadMcpConfig`、`addMcpServerConfig` 和 `removeMcpServerConfig`，不实现传输或认证层：

```text
/mcp
/mcp info llmquant-data
/mcp install llmquant-data web-reader
/mcp remove web-reader
/mcp export llmquant-data
/mcp install web-search-prime --local
/mcp list --local
```

默认目标为 Pi 用户目录的 `mcp.json`（通常 `~/.pi/agent/mcp.json`，遵循 `PI_CODING_AGENT_DIR`）；`--local` 只编辑当前项目 `.pi/mcp.json`。不自动安装全套，不覆盖同名已有配置；增删保留其他服务和字段。导出只返回所选预制模板，不读取本地凭证，不写文件。环境变量占位符由 Pi 解析，其他客户端可能需要调整语法。

在 Pi 中执行 `/reload` 或重启后加载。HTTP 服务不需要下载；stdio 的 `npx` 包由 Pi 启动时获取。移除只删除选定作用域的配置项，不清理包缓存和 OAuth 凭证；移除项目覆盖项可能重新显露用户级同名服务。Tushare 的令牌位于 URL 中，Pi 不插值 URL，因此模板先禁用，填写账号提供的完整 URL 后在 Pi 中启用。

以下五项服务承接原 `.claude/mcp.json` 的选型信息。官方配置文档于 2026-10-16 核对；这里提供连接指南，未使用真实账号执行 MCP 调用。供应商的数据范围、权限与额度以其当前文档和账号为准。

| 服务 / 官方介绍 | 适合补充什么 | 连接方式与凭证 |
|---|---|---|
| [Financial Datasets](https://docs.financialdatasets.ai/mcp-server) | 美股财务报表、SEC 文件、价格与新闻 | 远程 HTTP；交互式客户端可用 OAuth，程序化访问可用 API key，参数见下表 |
| [Tushare MCP](https://tushare.pro/document/1?doc_id=463) | 国内金融数据查询 | 从 Tushare 个人中心的 MCP Server 获取连接配置；按账号权限使用 |
| [LLMQuant Data MCP](https://github.com/LLMQuant/data-mcp) | 金融知识、研究论文、SEC 文件、宏观与行情数据 | 本地 stdio：`npx -y @llmquant/data-mcp`，进程环境传入 `LLMQUANT_API_KEY`；需要 Node.js/npx |
| [智谱 Web Search Prime](https://docs.bigmodel.cn/cn/coding-plan/mcp/search-mcp-server) | 搜索新闻与公开资料，获取标题、链接和摘要 | 远程 HTTP；`Authorization: Bearer YOUR_ZHIPU_API_KEY`，需账号具备对应服务权限 |
| [智谱 Web Reader](https://docs.bigmodel.cn/cn/coding-plan/mcp/reader-mcp-server) | 读取已找到网页的正文与元数据 | 远程 HTTP；使用同样的 Bearer 鉴权，服务权限单独确认 |

远程客户端中选择 HTTP / Streamable HTTP，按需复制对应 URL 和请求头：

| 服务 | URL | 请求头 / 登录 |
|---|---|---|
| Financial Datasets · OAuth | `https://mcp.financialdatasets.ai/` | 完成客户端的 OAuth 登录 |
| Financial Datasets · API key | `https://mcp.financialdatasets.ai/api` | `X-API-KEY: YOUR_FINANCIAL_DATASETS_KEY` |
| Tushare | `https://api.tushare.pro/mcp/token=YOUR_TUSHARE_TOKEN` | 使用个人中心提供的完整 MCP 配置 |
| Web Search Prime | `https://open.bigmodel.cn/api/mcp/web_search_prime/mcp` | `Authorization: Bearer YOUR_ZHIPU_API_KEY` |
| Web Reader | `https://open.bigmodel.cn/api/mcp/web_reader/mcp` | `Authorization: Bearer YOUR_ZHIPU_API_KEY` |

LLMQuant 本地 stdio 示例，适用于接受 `mcpServers` 结构的客户端：

```json
{
  "mcpServers": {
    "llmquant-data": {
      "command": "npx",
      "args": ["-y", "@llmquant/data-mcp"],
      "env": {
        "LLMQUANT_API_KEY": "YOUR_LLMQUANT_API_KEY"
      }
    }
  }
}
```

将 `YOUR_...` 替换为自己的凭证，保存在客户端的本地配置中；配置文件位置、HTTP 类型字段和环境变量插值语法由客户端决定。WhyJ 内的 `WHYJ_QUANT_*` 行情配置不会自动注入外部 MCP 进程。上例沿用上游 npx 安装入口，不代表 WhyJ 已审阅或锁定该 MCP 包版本；预制 Skills 的提交版本仅用于可重复下载。

配置后，先在目标客户端确认工具列表能加载，再用一个公开标的或网页执行样本查询。WhyJ 的 `/doctor --phase data` 检查内置行情适配器，不能代替 MCP 客户端的连接验证。接上 LLMQuant Data MCP 也不会自动提供所有组合工作区服务；具体工作流依赖按上游说明准备。

<a id="implementation"></a>

## 实现与验证

社区插件仍由当前 [WhyJ 扩展宿主](../agent-runtime/extensions.md)显式注册，不能把任意 Pi npm 插件直接装入 JQ。复用 Pi PackageManager、资源过滤和插件协议的后续工作见 [#33](https://github.com/yangjingo/oh-my-quant/issues/33)；目前保留的 Git 下载与选择文件属于兼容既有安装目录的接线。

| 位置 | 职责 |
|---|---|
| [预制目录](../../src/skill/catalog.ts) | 仓库、下载提交与技能名称 |
| [安装器](../../src/skill/installer.ts) | Git 下载、更新保护与取消 |
| [运行时安装入口](../../src/runtime/skills/skill-store.ts) | 安装根、选定路径与缓存失效 |
| [Pi 加载适配](../../src/agent/src/skills.ts) | 调用 Pi 加载器，附加来源与正文快照 |
| [命令](../../src/cli/handlers/skill.ts) | catalog、install、remove、reload、list、info 和 run |
| [MCP 预制目录](../../src/runtime/skills/mcp-presets.ts) / [配置入口](../../src/runtime/skills/mcp-config.ts) | 所选模板、Pi 配置增删、无凭证导出 |
| [MCP 薄适配](../../src/agent/src/pi-mcp.ts) | 锁定版本的 Pi 配置 API，无传输实现 |

```powershell
bun test src/skill/test src/agent/test/skills.test.ts src/runtime/test/skill-store.test.ts
bun run typecheck
bun run check:architecture
```

[图表会话回归](../../src/agent/test/chart-image-session.test.ts)保留图片传输和取消检查；[会话依赖回归](../../src/agent/test/session-dependencies.test.ts)保留刷新、快照和恢复检查。第三方工作流质量与真实服务访问需分别验证，不由加载成功推断。

### 命令界面复现

2026-10-17，issue #32 分支 `refactor/32-pi-community-tools`：Windows、Bun 1.3.14、Chromium 截图；使用当前 QuantTui 的实际字符缓冲区、命令处理器与 PageUp 按键解码，文件和配置全部为隔离 fixture。以下命令输出 SVG、ANSI 和浏览器索引，再用浏览器按宽度分组截图：

```powershell
bun run src/tui/dev/render-terminal-audit.ts --community --output output/community-review
python -m http.server 8132 --bind 127.0.0.1 --directory output/community-review
```

[60×20 窄终端连续帧](../assets/community-tools-60x20.png)与 [120×32 宽终端连续帧](../assets/community-tools-120x32.png)覆盖缓存 Skill 的选择、PageUp、移除，以及 MCP 空配置、添加、移除和未知名称错误。窄屏长清单需要滚动，名称和来源按文本换行；Composer 的短错误沿用单行省略显示。未新增加载面板，网络下载取消由安装器回归测试覆盖。这些是实际渲染器的 SVG 投影截图，不是原生终端字体、IME 或真实服务连接验收。
