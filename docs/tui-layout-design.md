# WhyJ Quant — TUI 布局设计

> 最后更新：2026-06-17
> 版本：**r9 — 区域划分：Analyzing / Overview / Composer / Modal Panels**

本文档描述当前 frame-buffer TUI 布局和交互模型。代码级指南为 `src/tui/README.md`；本文档是视觉/布局契约。

## 1. 区域地图

TUI 是一个由五个独立区域组成的固定 shell：

| 区域 | 代码 | 用途 |
|--------|------|---------|
| Header | `drawHeader()` | 品牌、版本和活动阶梯动画 |
| Analyze display | `drawConversation()` | 主消息流、thinking 内容、工具、底部 ora/tip |
| Portfolio / Overview dock | `drawPortfolio()` | 组合分组、行情报价、数据源行 |
| Composer input | `drawComposer()` | 用户输入、命令建议、排队/状态 |
| Status bar | `drawStatus()` | 模型、数据源、活跃组合 |

Modal panels 是由 `src/tui/src/panel.ts` 中的 `PanelController` 持有的独立覆盖层。

```
┌────────────────────────────────────────────────────────────────────────────┐
│ ▁▃▅▇█ WhyJ Quant  v0.1.0                    │
├───────────────────────────────────────────────┬────────────────────────────┤
│ ╭ ◉ Analyzing ──────────────────────────────╮ │ ╭ ◫ Overview ───────────╮ │
│ │ ▏ 用户消息                                │ │ │ ▎ ▼ Core              │ │
│ │ ● Bash.Read · Get-Content src/app.ts 0:02 │ │ │ 510300  沪深300ETF +0%│ │
│ │   ⎿ read app successfully                 │ │ │ ▎ Market              │ │
│ │ ▏ assistant 回答                          │ │ │ 000001  上证指数  +1% │ │
│ │   gray thinking 内容                      │ │ │ ▎ Source              │ │
│ │ ⠋ Thinking... (10s · 18 tokens)           │ │ │ data    AKShare       │ │
│ │   Tip: "..." — Author                     │ │ ╰──────────────────────╯ │
│ ╰────────────────────────────────────────────╯ │                            │
├────────────────────────────────────────────────────────────────────────────┤
│ ╭ ⌘ Composer ─────────── ↑↓ select · ↹ accept ─────────────────────────╮ │
│ │ /co▏                                                                 │ │
│ │ > /config  Show or open config panel                               │ │
│ │   /resume  List or restore saved sessions                          │ │
│ │   /portfolio  List, compare, and switch local portfolios           │ │
│ ╰────────────────────────────────────────────────────────────────────────╯ │
├────────────────────────────────────────────────────────────────────────────┤
│ ◆ deepseek-v4-pro · llmquant-data · Core                   │
└────────────────────────────────────────────────────────────────────────────┘
```

## 2. 布局函数

`layout(cols, rows, showPortfolioPanel)` 是唯一真源。

默认密度为 `compact`：

| 常量 | Compact | Comfortable | 来源 |
|----------|---------|-------------|--------|
| `HEADER_H` | `2` | `3` | `src/tui/src/styles.ts` |
| `COMPOSER_H` | `8` | `10` | `src/tui/src/styles.ts` |
| `STATUS_H` | `2` | `2` | `src/tui/src/styles.ts` |

区域公式：

```text
panelW      = clamp(36, 48, floor(cols * 0.312))
showPanel   = cols >= 78 && showPortfolioPanel !== false
mainH       = rows - HEADER_H - COMPOSER_H - STATUS_H
mainW       = showPanel ? cols - panelW : cols

mainPane    = { x: 0,     y: HEADER_H, w: mainW,     h: mainH }
analyzing   = { x: 1,     y: HEADER_H, w: mainW - 2, h: mainH }
overview    = { x: mainW, y: HEADER_H, w: panelW,    h: mainH }
composer    = { x: 0,     y: rows - COMPOSER_H - STATUS_H, w: cols, h: COMPOSER_H }
statusRow   = rows - 1
```

当 Overview dock 隐藏时，Analyze 填满整个主宽度。Dock 可因终端宽度或 `showPortfolioPanel: false` 而隐藏。

## 3. 统一面板原语

有两个面板族：

| 族 | 渲染器 | 用途 |
|--------|----------|-----|
| Fixed shell panels | 通过 `drawConversation`、`drawPortfolio`、`drawComposer` 的 `Buffer.box()` | 始终可见区域 |
| Modal panels | `PanelController.drawPanelFrame()` | Config、resume/session、portfolio picker、help/hotkeys |

共享规则：

- 每个面板在顶部边框中有标题。
- 边框使用 `S.rule`；标题使用 cream/gold 样式。
- 内容裁剪到面板的内部矩形。
- 在绘制区域之前，其矩形用 `CANVAS` 清除，以防止相邻区域的文本渗透。
- Modal panels 居中绘制在暗色背景上。

Modal panel 默认值：

```text
PANEL_W = 96
PANEL_H = 22
header info rows = 3
footer rows = 2
```

Modal 交互一致：

| 按键 | 动作 |
|-----|--------|
| `↑` / `↓` | 移动选择 |
| `Enter` | 切换、应用、打开草稿或运行模式特定操作 |
| `Esc` | 关闭草稿/选择器/面板 |

## 4. Analyze Display Panel

主消息面板标题始终为：

```text
◉ Analyzing
```

它在代码中仍然使用 `conversation` 命名，因为它渲染对话历史。

### 消息行

| 角色 | 渲染形状 |
|------|--------------|
| `user` | `▏ ` + 粗体 cream 文本 |
| `assistant` | `▏ ` + cream 文本 |
| `thinking` | 仅暗灰色内容；无 `Thinking` 标题或礼貌标签 |
| `tool` | `● Namespace.Action · args` 加运行耗时 |
| `tool.result` | `  ⎿ 结果预览`，弱化 |
| `error` | `▏ ERR ` + gold 文本 |

Thinking 行为：

- 实时 thinking 以灰色流式显示。
- 非空 thinking 在最终化后保持可见。
- 空 thinking 被移除。
- Thinking 文本剥离终端控制码，然后换行并裁剪到 Analyze 面板。
- 礼貌标题 `✻ Thinking` 有意不渲染。

工具标签使用 `src/tools/catalog.ts` 中的 pi 风格命名空间：

```text
● Bash.Read · Get-Content src/tools/catalog.ts
● Bash.Write · Set-Content out.txt value
● Bash.Update · Get-Content a.ts | Set-Content b.ts
● Bash.Shell · node script.js
● Quant.Risk · 000300.SH
● Quant.Backtest · 000300.SH
● Quant.Factor · momentum
```

### 底部活动区域

当 activity 不是 `ready` 且存在消息时，Analyze 保留底部两行：

```text
⠋ Thinking... (10s · 18 tokens)
  Tip: "如果买入前功课做对，正确的卖出时机几乎不存在" — Philip Fisher
```

规则：

- Ora 帧每 80ms 旋转。
- 第一行使用明亮的横幅颜色波。
- 元数据为耗时加估算 token。
- 第二行以 `Tip:` 开头。
- 原始错误消息和工具错误结果在投资引言之前被引用于 tip 中。
- `message_end` 在最终重绘前将 activity 设为 `ready`，使底部动画不会在 assistant 输出完成后继续。

当没有消息且 activity 活跃时，使用居中 loading overlay 而非底部活动区域。

### 滚动与选择

Analyze 使用虚拟换行列表：

- `conversationMaxScrollUp()` 从底部限制滚动。
- `PgUp` / `PgDown` 按页滚动。
- Analyze 上的鼠标滚轮滚动历史。
- Analyze 内拖拽逐行滚动。
- `Shift+drag` 选择文本。
- `Ctrl+Shift+C` 复制活动选择。
- 提交新消息将 Analyze 重置到底部。

## 5. Portfolio / Overview Dock

右侧 dock 标题为：

```text
◫ Overview
```

仅当以下条件时渲染：

```text
cols >= 78 && showPortfolioPanel !== false
```

Dock 包含 sections，而非任意自由文本。

| Section kind | Header | Rows | 可见性 |
|--------------|--------|------|------------|
| `group` | `▎ ▼/▶ title` + count divider | 组合持仓 | 可折叠 |
| `holdings` | `▎ title` + divider | 组合持仓 | 完整列表，超出滚动 |
| `quotes` | `▎ title` + divider | 行情报价 | 始终可见 |
| `keyvalue` | `▎ title` + divider | label/value rows | 始终可见 |

Portfolio 行形状：

```text
CODE(8)  name...                       pct(8)
510300   沪深300ETF                    +0.35%
```

规则：

- 代码显示时去除 `.SH` / `.SZ`。
- 名称截断以适应宽度。
- `pct` 右对齐带符号。
- 正/负色遵循 `pctStyle()`。
- Dock 在绘制前清除其完整矩形，防止 Analyze 文本渗透。
- 溢出在 dock 内滚动；持仓不设行数上限。

数据流：

- `AppRuntime` 持有面板刷新。
- Dock 不直接扫描 `.ohquant/data`。
- Portfolio symbol 来自本地 portfolio 存储。
- 实时报价在运行时刷新期间获取。
- Market 和 source sections 追加在 portfolio sections 之后。

## 6. Composer 输入框

Composer 是固定的底部输入界面：

```text
╭ ⌘ Composer ─────────────── Shift+drag copy · / commands · ↵ send ╮
│ › 自然语言输入▏                                                  │
╰──────────────────────────────────────────────────────────────────╯
```

视觉模式：

| 模式 | 提示符 | 样式 | 右侧提示 |
|------|--------|-------|------------|
| Empty | `›` | 暗色占位符 | `Shift+drag copy · / commands · ↵ send` |
| Chat | `› text▏` | cream | 同上 |
| Slash | `/cmd args▏` | gold | `↑↓ select · ↹ accept` |
| Queued | 输入加队列状态 | cream/dim | `{n} queued · ↵ send · / commands` |

Composer 从不持有命令执行。它仅向 `AppRuntime` 返回提交的文本。

### 建议弹窗

Slash 建议在 Composer 内部、输入行下方绘制为紧凑内联列表。它们不浮动到上方的 `◉ Analyzing` 面板中。

```text
╭ ⌘ Composer ──────────────────────────╮
│ /co▏                                 │
│ > /config  Show or open config panel│
│   /resume  List or restore sessions │
│   /help    Show commands and hotkeys│
╰──────────────────────────────────────╯
```

规则：

- 顶层 slash 元数据来自 `src/cli/catalog.ts`。
- Watchlist 代码/名称补全来自 `src/tui/src/watchlist.ts`。
- 活跃建议使用 `> ` 前缀；非活跃行为普通缩进文本。
- 不渲染嵌套弹窗边框、标题行或 `1/N` 索引后缀。
- 空间允许时最多可见 8 行建议。
- 建议优先消耗 Composer 剩余内部行；当可见时，优先于排队消息行。
- 紧凑密度下，Composer 高度默认使 slash 建议可显示 5 行。
- 如果 Composer 垂直空间不足以容纳一行，建议被隐藏。
- `Enter` 仅对部分命令自动补全；精确命令提交。
- 裸 `/` 永不提交。

输入控制：

| 按键 | 行为 |
|-----|----------|
| `Enter` | 提交或自动补全部分 slash |
| `Tab` | 接受选中的建议 |
| `↑` / `↓` | 建议选择、历史或最后触摸的滚动区域 |
| `Esc` | 清除输入/建议或关闭面板 |
| `Ctrl+P` | 打开 config 面板 |
| `Ctrl+C` | 清除输入，或输入为空时退出 |
| `Ctrl+D` | 退出 |

## 7. Header

Header 包含阶梯字形和品牌：

```text
▁▃▅▇█ WhyJ Quant  v...
```

活动动画：

| Activity | 阶梯行为 |
|----------|--------------------|
| `ready` | 静态金色渐变 |
| `starting` | 慢波 |
| `thinking` | 中波 |
| `running tool` | 快波 |

## 8. Status Bar

Status bar 是最后一行加上方的分隔线：

```text
◆ model · source · activePortfolio
```

来源：

- `model`：来自设置/运行时 bootstrap。
- `A:`：`preferences.aShareSource`。
- `G:`：`preferences.globalSource`。
- portfolio：从设置和本地 portfolio 元数据解析的活跃本地组合。

## 9. 原始输入与鼠标

`QuantTui` 读取原始 `stdin` 并通过 `nextInputAction()` 标准化数据块：

- CSI 键盘序列：方向键、PageUp/PageDown、Shift 修饰符。
- SGR 鼠标序列：滚轮、按下、释放、拖拽。
- 部分鼠标片段在泄漏到 Composer 之前被缓冲或丢弃。

鼠标行为：

| 鼠标动作 | 区域 | 行为 |
|--------------|--------|----------|
| Wheel | Analyze | 滚动消息历史 |
| Wheel | Overview | 滚动 dock |
| Drag | Analyze/Overview | 逐行滚动 |
| Shift+drag | Analyze/Overview | 选择文本 |

悬停报告有意禁用以避免动画期间淹没 stdin。

## 10. 响应式规则

| 条件 | Overview dock | Analyze 宽度 |
|-----------|---------------|---------------|
| `cols < 78` | 隐藏 | 完整主宽度 |
| `showPortfolioPanel === false` | 隐藏 | 完整主宽度 |
| 其他 | `clamp(36, 48, floor(cols * 0.312))` | `cols - panelW` |

`WHYJ_UI_DENSITY=comfortable` 增加 header/composer 垂直空间。Compact 为默认。

## 11. 动画

TUI 运行 80ms 动画计时器，但仅当 `activity !== "ready"` 时重绘。

动画元素：

- Header 阶梯波。
- Loading overlay 阶梯和引言脉冲。
- 底部 ora spinner 和明亮横幅颜色。
- 工具运行时的工具耗时。

Ready 状态暂停动画重绘工作。

## 12. 测试

TUI 测试是小型确定性测试，而非完整终端快照。

| 文件 | 覆盖 |
|------|----------|
| `src/tui/test/render.test.ts` | 布局、裁剪、固定 `◉ Analyzing`、无礼貌标题的灰色 thinking、底部活动行、工具标签、overview 渲染 |
| `src/tui/test/input.test.ts` | 原始按键/鼠标解析、命中测试、建议 |
| `src/tui/test/slash-ux.test.ts` | Composer slash UX 模拟 |
| `src/tui/test/stream_think_test.ts` | Thinking 生命周期和最终化 |
| `src/tui/test/panel.test.ts` | Modal panel 编辑和选择器行为 |
| `src/tui/test/selection.test.ts` | 选择和复制提取 |
| `src/tui/test/buffer.test.ts` | Cell buffer 和 styles |
| `src/tui/test/watchlist.test.ts` | Watchlist 加载 |

推荐检查：

```bash
bun test src/tui/test
bun run typecheck
```

## 13. 边界情况

| 情况 | 预期行为 |
|------|-------------------|
| 长 thinking 输出 | 灰色、换行、裁剪到 Analyze、无礼貌标题 |
| 工具结果过长 | 结果预览被截断 |
| Assistant 输出完成 | 底部 ora 在最终重绘前清除 |
| Overview 溢出 | Dock 滚动；Analyze 不能渗透进去 |
| 小终端 | Overview 隐藏；Composer 空间不足时建议隐藏 |
| CJK 文本 | `strWidth()` 正确计算宽字 |
| 裸 `/` + Enter | 自动补全，永不提交 |
| Windows `\r\n` | 不重复提交 |
| 鼠标 SGR 片段 | 在 Composer 文本处理前缓冲/丢弃 |
