# Windows 桌面版

维护方向选择 Desktop-first，同时保留 CLI。`apps/desktop`、`apps/cli` 与共享工作区的分阶段改造仍是提案，尚未实施；问题、边界、兼容成本及后续验收见[产品形态博客](../blog/08-research-workbench.md)。本文继续描述现有 `desktop/` PTY 宿主与构建方法，不把计划当作现状。

更新：2026-10-14。CLI 与桌面源码统一为 1.4.0；已发布安装包、构建结果和安装验收分别以对应 Release/工作流记录为准。

桌面版合入 `main` 后与 CLI 在同一分支维护；实现位于 `desktop/`，设计属于 Quant Harness。版本号同时来自根目录和 `desktop/package.json`，构建时必须一致。

## 安装与使用

从 GitHub Release 下载对应版本的 `WhyJ-Quant-Setup-<version>-win-x64.exe`。当前源码的安装向导在写入程序前显示目标目录、所需空间和可用空间；可选择当前用户有写权限的目录，例如 `D:\Apps\WhyJ Quant`，也支持中文和空格路径。点击“安装”前可以取消。安装仅面向当前用户，创建桌面和开始菜单快捷方式；重装/升级默认沿用已登记的安装目录。已发布旧版一键安装包不会随源码修复改变行为。

支持 Windows 10 1809 及更新版本、Windows 11，x64。安装和启动无需管理员权限，也无需预装 Node、Bun、Python 或 Git。

安装包包含 Electron、独立 CLI、Python 3.13.12、AKShare 1.18.63、AKQuant、精选技能的 Python 依赖和 MinGit。行情与模型服务需要网络；AI 分析首次使用时按 `Ctrl+P` 或输入 `/config` 配置自己的模型连接。模型、数据源的凭证和权限要求与 CLI 相同。首次启动会在后台下载固定版本的精选技能，失败会提供重试命令，主界面仍可使用。

界面直接运行同一个 CLI/TUI。`/help`、`/config`、`/portfolio`、`/doctor`、`/resume`、`/artifact` 等入口、键盘导航、行情配色和报告行为共用原实现。HTML 报告仍在默认浏览器打开。

桌面操作：

- `Ctrl+V` 粘贴，支持中文输入和多行粘贴。
- 按住 Shift 拖选终端文字，再按 `Ctrl+C` 或 `Ctrl+Shift+C` 复制；原 CLI 对话选择也保留。
- `Ctrl++` / `Ctrl+-` 调整字号，`Ctrl+0` 重置；字号和窗口尺寸自动保存。
- 顶栏“工作目录”打开桌面数据目录；`/exit` 或关闭窗口退出。

默认数据目录是 `%APPDATA%/WhyJ Quant/workspace/.ohquant`，实际位置可由顶栏按钮查看。桌面端不自动导入源码目录下的凭证或研究数据。升级覆盖应用文件，保留设置、会话和报告；卸载也保留数据目录。CLI 可显式通过 `OHQUANT_DIR` 指向同一目录（避免并行修改同一个会话）。

安装目录与研究数据目录独立：把程序安装到 D/E 盘不会迁移已有数据，目录选择页也会提示默认数据位置。需要单独指定桌面数据根目录时，可在启动前设置 `WHYJ_DESKTOP_HOME`（研究数据位于其下的 `workspace/.ohquant`）；已有数据需要自行迁移，安装向导不执行数据搬迁。

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

`bun run build` 生成 Electron 主进程、沙箱 preload、xterm renderer 和独立的 `runtime/whyj.exe`。`bun run dist:win` 生成 `release/` 下的 NSIS 向导安装包。目录选择使用 [electron-builder 的 assisted installer 配置](https://www.electron.build/nsis/)，`desktop/assets/installer.nsh` 保持当前用户安装并补充数据目录提示；保留既有 appId，沿用安装目录登记。打包文件采用白名单，不包含 `.env`、`.ohquant`、测试数据或开发机器设置。

顶栏使用共享 JQ SVG，窗口和安装器使用包含 16/24/32/48/64/128/256px 的 `assets/app-icon.ico`。图标来源位于 [共享素材](../assets/index.html)，尺寸 PNG 只保留在 `docs/assets/icons/`。Desktop 仅保留实际使用的 `assets/logo-mark.svg` 和 `assets/app-icon.ico`，构建直接复制已提交素材，不再通过单独的图标生成脚本。修改共享素材时一并更新这两份副本。CLI/TUI 的 JQ 字符标记与桌面 SVG 分别适应终端和图形界面。新安装器的实际图标与升级缓存仍须在打包后验收。

安装验收在一次性 Windows CI 账户中完成首次安装和重装，检查快捷方式目标、原安装目录与研究数据保留。桌面 smoke 检查 JQ SVG 的实际加载和暖色文字，并将程序、安装器、桌面快捷方式与开始菜单快捷方式由 Windows Shell 返回的图标保存为 `desktop-evidence` artifact 中的 `shell-icon-0.png` 至 `shell-icon-3.png`，与 `startup.png` 一起审阅。这些验证截图不提交到仓库；干净账户上的结果不代表所有用户机器已有的图标缓存都会立即刷新。

## 运行与信任边界

本地 `app://desktop` 页面只通过有限 IPC 访问独立 CLI 的 ConPTY、剪贴板与工作目录。页面不启用 Node，启用 context isolation、sandbox 和 CSP；禁止页面跳转、子窗口、webview 和网页权限。IPC 校验主窗口/主 frame、输入长度及终端尺寸。链接只允许在系统浏览器打开 HTTP(S)。主进程对终端输出实施背压，避免渲染阻塞时持续堆积 IPC。

数据目录与只读运行包分开，Python 固定到随包解释器。关闭窗口先请求 CLI 正常退出，超时再清理进程树。该桌面隔离不改变现有 Agent shell 工具的能力或授权语义。

`WHYJ_DESKTOP_HOME` 可显式指定独立的桌面配置目录，用于可重复的安装验收；它不改变安装路径。自动验收以空目录启动，不读取开发者的模型密钥。

## 发布验收

发布前执行根目录的 `typecheck`、`check:architecture`、`test` 和 `build`，再执行桌面的 `typecheck`、构建、打包以及实际安装包验收。需要覆盖无开发运行时 PATH 的启动、终端命令/中文粘贴/缩放、设置持久化、随包 Python/Git、窗口关闭后的子进程清理及版本一致性。真实供应商与个人模型授权需独立核验，不能由终端界面测试推断。

工作流通过 `desktop/scripts/test-install.ps1` 在一次性 GitHub Windows 用户环境中静默安装到非系统盘的中文/空格路径，检查当前用户快捷方式、研究数据保留，再不传 `/D` 重装以核对安装位置恢复，最后运行已安装程序的 smoke。该脚本拒绝在开发者账户直接运行，以免覆盖现有安装。静默验收不等于交互向导验收：发布前还需在干净 Windows 用户下检查目录页/空间显示、浏览选择、取消后无程序写入，以及从上一发布版本升级。
