# WhyJ 扩展宿主

更新：2026-10-13。协议为 WhyJ Extension API 1，使用 Pi AgentTool/Skill 数据类型；不实现 Pi Coding Agent ExtensionAPI，也不承诺安装 npm Pi 包即可运行。

扩展由显式静态 import 后交给宿主加载，不扫描或动态执行任意目录。manifest 声明 ID、发行版本、精确 API 版本，以及工具、skills、命令和 capability 名称；实现与声明必须完全一致。`capabilities` 是 API 1 的可选增量字段，旧定义省略时按空集合处理。命令通过扩展宿主 API 调用，公开 slash 命令保持单一 catalog。

宿主提供工作目录、扩展生命周期 AbortSignal 与诊断出口。业务不获得 TUI 或私有 storage 实例；Node 扩展属于受信任同进程代码，此接口不是恶意代码沙箱。未来 npm 分发、UI 管理或其他协议的适配不能由本接口推定已完成。

加载与重载先检查版本与名称冲突，再初始化和校验候选资源，最后发布。失败不替换已启用资源；候选初始化/校验失败清理其资源。禁用操作进入串行执行阶段后撤销旧调用入口，取消在途工作并等待协作退出后清理；重载在新资源发布后退休旧实例。清理失败记录诊断，不使其他扩展消失。初始化默认限时 10 秒，迟到返回的资源会清理；工具和清理函数须响应 signal 并结束，忽略取消或阻塞事件循环的代码不能在同进程被强制隔离。

Session 在独立请求的空闲边界读取同一份工具、技能和 capability 快照；运行中的循环保持注册快照，已经禁用的旧资源调用会明确失败。新增/替换不清空研究历史或重建会话。恢复中显式保存的活动工具选择继续取交集，不自动恢复被排除的工具。

首个内置扩展封装现有工具注册表，不复制计算或数据实现；独立 fixture 提供自有工具、技能与命令。验收涵盖版本不兼容、声明不符、跨扩展名称冲突、初始化/清理失败、取消、重复禁用、失败重载保留、命令调用和真实 Pi 会话的动态资源变更。

## 当前可用范围

R08 第二阶段已接通默认 AppRuntime 的扩展生命周期：启动加载静态 catalog 和持久化的禁用选择，再组装会话；退出取消初始化与工具并等待清理。`/config --extensions list|enable|disable|reload [id]` 复用现有入口，list 返回版本、声明、运行状态与诊断；更改需要空闲会话。启停在宿主变更成功后以 settings revision 保存，保存失败尝试恢复原启停状态并报告错误；重载不写设置。单次 CLI 使用临时宿主并在返回前清理，不创建模型会话。未知插件、非法参数和失败不得显示成功；持久化未知 ID 保留并标为不可用，避免升级丢掉用户选择。其他已运行进程需重启读取新选择。

默认 `whyj` 通过宿主加载 `whyj.core`，其工具来自原有注册表。管理结果显示在 Composer 的命令回执中，技能补全从活动会话读取并在启停后刷新，未新增 Settings 子面板或一级命令。分发方式为随构建静态注册的 WhyJ 扩展，不提供 npm 发现/安装，也不执行任意目录的脚本。新增模块在 [应用注册表](../../src/runtime/extensions.ts) 顶层 import 后加入 definitions；独立源码宿主仍可直接使用下面的 API。

| 模块 | 职责 |
|---|---|
| [公共契约](../../src/extensions/types.ts) | manifest、资源、生命周期上下文与快照 |
| [校验](../../src/extensions/manifest.ts) | API 1、发行版本、唯一名称和声明/实现一致性 |
| [宿主](../../src/extensions/host.ts) | 加载、替换、禁用、取消、诊断与清理 |
| [内置扩展](../../src/runtime/builtin-extension.ts) | `whyj.core` 复用内置工具，提供只读 `quant-capabilities` 命令 |
| [会话适配](../../src/runtime/extension-session.ts) | 同一次快照携带 tools/skills/capabilities/revision，预留 `research_task` 和基础宿主能力名 |
| [应用管理](../../src/runtime/extensions.ts) / [命令适配](../../src/cli/handlers/extensions.ts) | 静态 catalog、保存启停选择、失败回执与单次 CLI 清理 |
| [独立示例](../../src/extensions/test/fixtures/statistics-extension.ts) | 均值工具、分析 skill、echo 命令和 observation capability，无 TUI/存储依赖 |

## 开发接入

用户可在交互终端输入：

```text
/config --extensions list
/config --extensions disable whyj.core
/config --extensions enable whyj.core
/config --extensions reload whyj.core
```

`whyj.core` 禁用后，数据、量化和 shell 工具从后续模型请求移除，宿主的 `research_task` 仍保留；本地 `/config`、`/help` 等管理操作仍可使用。list 是只读查询，可在模型运行时使用；更改在模型准备/执行或其他命令期间明确拒绝，请等待后重试。重载重新初始化当前构建中的模块，不会从磁盘热导入新代码；升级源码后需重新构建/启动。

单次 JSON 调用：`bun run src/index.ts -- --json -c "/config --extensions list"`。成功返回 `data.extensions`（manifest、enabled、configuredEnabled、diagnostics）及 `data.unavailable`；查看成功不代表所有扩展初始化成功，应检查每个条目。操作失败返回非零退出码和错误说明，不回退到默认启用。

以下代码放在仓库根目录的 TypeScript 入口中。实际插件可按独立示例定义 `ExtensionDefinition`，由顶层静态 import 引入。

```ts
import { ExtensionHost } from "./src/extensions/index.ts";
import { builtinQuantExtension } from "./src/runtime/builtin-extension.ts";
import { extensionSessionDependencies } from "./src/runtime/extension-session.ts";
import { createDefaultSessionDependencies } from "./src/runtime/session-dependencies.ts";
import { createQuantResearchAgent } from "./src/runtime/quant-harness.ts";

const cwd = process.cwd();
const host = new ExtensionHost({ cwd });
await host.load(builtinQuantExtension);
const dependencies = await extensionSessionDependencies(
  createDefaultSessionDependencies({ cwd }), host,
);
const agent = createQuantResearchAgent({ dependencies });
try {
  await agent.waitForIdle();
  console.log(host.list());
  console.log(await host.executeCommand("quant-capabilities"));
  // await agent.prompt("你的研究问题"); // 使用已配置的模型与数据能力
} finally {
  agent.abort();
  await host.dispose();
  await agent.waitForIdle();
}
```

适配器把宿主视为完整工具集合；希望保留内置能力就显式加载 `whyj.core`。`createQuantResearchAgent` 为后续新装工具继续绑定研究任务范围与取消守卫，自定义工具成功不自动成为已核验的研究证据。

插件只有在确实提供并核验某项宿主能力时才发布 capability。下面的资源声明表示同一插件同时提供搜索工具和 `web-search` readiness 事实；`status` 也可为 `missing`、`unverified` 或 `input-required`，重载后会在空闲边界更新宿主能力快照。完整工具 schema 与取消实现可参照 statistics fixture。

```ts
import type { ExtensionDefinition } from "./src/extensions/index.ts";

export const searchExtension: ExtensionDefinition = {
  manifest: {
    id: "example.search",
    version: "1.0.0",
    apiVersion: 1,
    tools: ["example_web_search"],
    skills: [],
    commands: [],
    capabilities: ["web-search"],
  },
  activate: () => ({
    tools: [searchTool],
    skills: [],
    commands: [],
    capabilities: [{
      requirement: "web-search",
      status: "available",
      reason: "example_web_search returns timestamped source records.",
      requiresTools: ["example_web_search"],
    }],
  }),
};
```

能力名在扩展之间及基础宿主能力源之间必须唯一；冲突在初始化前拒绝。宿主复制 capability 回执，调用方后续修改对象不会改变活动快照。`requiresTools` 可声明能力与插件工具的关系，绑定未知工具、重复绑定或非数组值在候选发布前拒绝。2026-10-16 起，默认宿主不再用这些声明计算逐技能资格；可选 `prepareSkills` 策略由自定义宿主负责。能力声明不会自动注册工具，也不是研究证据。

`load(definition)` 添加新 ID；`reload(definition)` 替换已有 ID；`disable(id)` 撤销资源；`enable(id)` 重新执行已保存的初始化工厂。`snapshot()` 返回启用资源，`list()` 包含已禁用条目，`getDiagnostics(id)` 可查询初始化失败和清理错误。初始化失败的 ID 不加入 list。`reserve({ tools, skills, commands, capabilities })` 原子预留宿主名称，已占用时失败；会话适配器自动预留 `research_task` 和基础宿主当前发布的能力名，因此需要 `await`。`dispose()` 取消整个宿主并清理资源。

会话在空闲 `getSkills()` 或下一次独立 prompt/skill 时读取版本，先准备工具、合并技能与 prompt，再提交。基础技能与扩展技能重名时保留旧会话资源，修复后可重试。只刷新技能不写研究日志；工具集合变化通过已有 active-tools entry 保存选择。自动选择模式接纳新增工具，恢复的显式选择仅与当前工具取交集；显式空集合保持为空。

默认 AppRuntime 在启动及启用/重载前预留已发现的本地技能名和基础宿主能力名，名称在此宿主生命周期中保持预留；冲突在扩展初始化前拒绝。后续外部技能编辑若产生冲突，刷新失败会明确提示，用户可禁用扩展或修正技能后重试。当前活动工具清单随 system prompt 更新，旧工作流说明仅在对应工具启用时适用；禁用能力不能通过 shell 自动绕过。只接管 Agent 工具、扩展技能和 宿主能力元数据，Overview、Doctor 与本地配置服务具有各自生命周期。

## 测试方式

```powershell
bun test src/extensions/test/host.test.ts src/runtime/test/extension-session.test.ts
bun test src/runtime/test/extensions.test.ts tests/app/app-extensions.test.ts
bun run typecheck
bun run check:architecture
bun run test
bun run build
```

回归分三层：[扩展宿主](../../src/extensions/test/host.test.ts)检查 manifest/API、名称预留、初始化/重载失败、取消与资源清理；[会话接线](../../src/runtime/test/extension-session.test.ts)检查真实 Pi 循环里的工具增删、技能刷新、任务子集、原会话保留；[应用管理](../../tests/app/app-extensions.test.ts)检查实际 CLI/Composer 入口、设置冲突回滚、启动取消与 shutdown 等待。

能力声明不能注册 shell；基础名称冲突在激活前拒绝。默认宿主只更新资源，不维护逐技能运行资格。禁用选择跨重启保留，未知 ID 不被偷偷删除；忙碌时只读查看。异步启动中的提交须等待启动完成，不能吞掉用户紧接的输入；补全检查应读取真实建议列表，不只统计刷新回调。

这些测试使用隔离 fixture、本地 HTTP/SSE 和源码 CLI，不访问真实模型、行情或资产。独立 bundle 是否可运行需要另外验证；并行超时后的隔离通过不能改写原失败。接口是否可达及异步入口的反思见[模块边界](../blog/09-boundaries-for-change.md)，完整产品状态由 [PRD](../quant-harness/PRD.md)维护，不在本页保存历次通过数。
