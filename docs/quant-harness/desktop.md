# Windows 桌面版

更新：2026-10-14。CLI 与桌面源码统一为 1.4.0；已发布安装包、构建结果和安装验收分别以对应 Release/工作流记录为准。

桌面版合入 `main` 后与 CLI 在同一分支维护；实现位于 `desktop/`，设计属于 Quant Harness。版本号同时来自根目录和 `desktop/package.json`，构建时必须一致。

## 安装与使用

从 GitHub Release 下载对应版本的 `WhyJ-Quant-Setup-<version>-win-x64.exe`，双击即可安装到当前用户目录，并创建桌面和开始菜单快捷方式。支持 Windows 10 1809 及更新版本、Windows 11，x64。安装和启动无需管理员权限，也无需预装 Node、Bun、Python 或 Git。

安装包包含 Electron、独立 CLI、Python 3.13.12、AKShare 1.18.63、AKQuant、精选技能的 Python 依赖和 MinGit。行情与模型服务需要网络；AI 分析首次使用时按 `Ctrl+P` 或输入 `/config` 配置自己的模型连接。模型、数据源的凭证和权限要求与 CLI 相同。首次启动会在后台下载固定版本的精选技能，失败会提供重试命令，主界面仍可使用。

界面直接运行同一个 CLI/TUI。`/help`、`/config`、`/portfolio`、`/doctor`、`/resume`、`/artifact` 等入口、键盘导航、行情配色和报告行为共用原实现。HTML 报告仍在默认浏览器打开。

桌面操作：

- `Ctrl+V` 粘贴，支持中文输入和多行粘贴。
- 按住 Shift 拖选终端文字，再按 `Ctrl+C` 或 `Ctrl+Shift+C` 复制；原 CLI 对话选择也保留。
- `Ctrl++` / `Ctrl+-` 调整字号，`Ctrl+0` 重置；字号和窗口尺寸自动保存。
- 顶栏“工作目录”打开桌面数据目录；`/exit` 或关闭窗口退出。

默认数据目录是 `%APPDATA%/WhyJ Quant/workspace/.ohquant`，实际位置可由顶栏按钮查看。桌面端不自动导入源码目录下的凭证或研究数据。升级覆盖应用文件，保留设置、会话和报告；卸载也保留数据目录。CLI 可显式通过 `OHQUANT_DIR` 指向同一目录（避免并行修改同一个会话）。

当前构建不含 Authenticode 证书，Windows 可能显示未知发布者提示。安装包 SHA-256 随 Release 提供。它不代表签名或组织设备策略放行。

## 构建

桌面首次创建配置时选择免 Token 的 AKShare；已经保存的数据源设置不会被覆盖。模型连接仍需配置用户自己的凭证。

构建机器需要 Windows x64、Bun 1.3.14、Node、PowerShell 7、uv。最终用户不需要这些工具。

```powershell
bun install --frozen-lockfile
Set-Location desktop
bun install --frozen-lockfile
node node_modules/electron/install.js
./scripts/prepare-runtime.ps1
bun run typecheck
bun run build
bun run dist:win
```

首次下载归档进入 `desktop/.downloads`；脚本核对固定 SHA-256，Python 全部依赖由带哈希的 `python-requirements.txt` 锁定。`-Offline` 仅在归档和 uv 缓存完备时可用。修改 Python 依赖后使用 `uv pip compile --python-version 3.13 --python-platform windows --generate-hashes --no-emit-index-url python-requirements.in -o python-requirements.txt` 更新锁文件并重新验收。

`bun run build` 生成 Electron 主进程、沙箱 preload、xterm renderer 和独立的 `runtime/whyj.exe`。`bun run dist:win` 生成 `release/` 下的一键 NSIS 安装包。打包文件采用白名单，不包含 `.env`、`.ohquant`、测试数据或开发机器设置。

顶栏使用共享 JQ SVG，窗口和安装器使用包含 16/24/32/48/64/128/256px 的 `assets/app-icon.ico`。图标来源位于 [共享素材](../assets/index.html)，尺寸 PNG 只保留在 `docs/assets/icons/`。Desktop 仅保留实际使用的 `assets/logo-mark.svg` 和 `assets/app-icon.ico`，构建直接复制已提交素材，不再通过单独的图标生成脚本。修改共享素材时一并更新这两份副本。CLI/TUI 的 JQ 字符标记与桌面 SVG 分别适应终端和图形界面。新安装器的实际图标与升级缓存仍须在打包后验收。

## 运行与信任边界

本地 `app://desktop` 页面只通过有限 IPC 访问独立 CLI 的 ConPTY、剪贴板与工作目录。页面不启用 Node，启用 context isolation、sandbox 和 CSP；禁止页面跳转、子窗口、webview 和网页权限。IPC 校验主窗口/主 frame、输入长度及终端尺寸。链接只允许在系统浏览器打开 HTTP(S)。主进程对终端输出实施背压，避免渲染阻塞时持续堆积 IPC。

数据目录与只读运行包分开，Python 固定到随包解释器。关闭窗口先请求 CLI 正常退出，超时再清理进程树。该桌面隔离不改变现有 Agent shell 工具的能力或授权语义。

`WHYJ_DESKTOP_HOME` 可显式指定独立的桌面配置目录，用于可重复的安装验收；它不改变安装路径。自动验收以空目录启动，不读取开发者的模型密钥。

## 发布验收

发布前执行根目录的 `typecheck`、`check:architecture`、`test` 和 `build`，再执行桌面的 `typecheck`、构建、打包以及实际安装包验收。需要覆盖无开发运行时 PATH 的启动、终端命令/中文粘贴/缩放、设置持久化、随包 Python/Git、窗口关闭后的子进程清理及版本一致性。真实供应商与个人模型授权需独立核验，不能由终端界面测试推断。
