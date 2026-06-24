对，这个应该单独提升为 **Trajectory / Traj 设计**，而不是只做一个简单的 `trace.ts` 折叠面板。

你原文里已经提到 Artifact 会捕获 `Tool execution traces (tool name, arguments, results)`，并且架构里已经有 `trace.ts` 作为“工具调用追踪折叠面板”；数据流也已经包含“提取 tool call/result 对”；后面还提到 `Chart | Raw` 中的 Raw 模式要保留 agent 原始输出文本 trajectory。

但现在要升级一下：

> **Trace 只记录工具调用。Trajectory 记录 Agent 完成任务的全过程。**

这里需要注意一个边界：不要暴露模型底层隐藏思维链原文，而是暴露 **可审计的执行轨迹**，包括：计划、观察、工具调用、工具结果、决策摘要、证据引用、失败重试、最终结论。这样既能反映 Agent 的工作过程，又不会把不可控的内部推理原文直接泄露出来。

下面这段可以直接补进你的设计文档。

## Trajectory Design

### 1. 设计目标

WhyJ Quant Artifact 不只展示最终答案，还需要展示 Agent 是如何完成一次分析任务的。

Trajectory 的目标是：

1. **可复盘**
   用户可以看到 Agent 从问题理解、数据获取、工具调用、结果观察到最终结论的完整路径。

2. **可审计**
   每一个结论都应该能追溯到对应的数据来源、工具结果或中间观察。

3. **可调试**
   开发者可以通过 trajectory 定位 Agent 在哪一步调用了错误工具、使用了错误参数、误读了结果或过早下结论。

4. **可压缩展示**
   普通用户看到的是简洁执行路径；高级用户可以展开查看完整工具参数和原始结果。

5. **可导出**
   Trajectory 是 Artifact 的一等内容，和行情图表、表格、回测结果一样被保存到 HTML 中。

### 2. Trace 与 Trajectory 的区别

| 概念                | 说明           | 粒度                                                                |
| ----------------- | ------------ | ----------------------------------------------------------------- |
| Trace             | 工具调用记录       | tool call / tool result                                           |
| Trajectory        | Agent 完整执行轨迹 | user intent / plan / step / tool / observation / decision / final |
| Chain of Thought  | 模型内部隐藏推理     | 不直接展示                                                             |
| Reasoning Summary | 可展示的推理摘要     | 可展示                                                               |
| Evidence          | 支撑结论的数据证据    | 必须展示                                                              |

因此页面上不直接暴露原始隐藏思维链，而是展示：

```text id="d3m6je"
用户问题
→ Agent 任务理解
→ 分析计划
→ 工具调用
→ 工具结果
→ Agent 观察
→ 中间决策
→ 失败与重试
→ 结论生成
→ 证据引用
```

### 3. Trajectory 在 Artifact 中的位置

Artifact 页面需要新增一个一级模块：

```text id="sypbkl"
┌────────────────────────────────────────────────────────────┐
│ Header: 股票名称 / 任务 / 生成时间                          │
├────────────────────────────────────────────────────────────┤
│ Summary: 最终结论 / 风险提示 / 关键指标                      │
├────────────────────────────────────────────────────────────┤
│ Main: 行情图表 / 表格 / 回测 / 资金 / 财务                    │
├────────────────────────────────────────────────────────────┤
│ Trajectory: Agent 执行轨迹                                   │
│  ├── Timeline View                                           │
│  ├── Tool Call View                                          │
│  ├── Evidence View                                           │
│  └── Raw JSONL View                                          │
└────────────────────────────────────────────────────────────┘
```

Trajectory 默认折叠。
用户点击 “Show Agent Trajectory” 后展开。

### 4. Trajectory 视图层级

Trajectory 应该提供三种视图。

#### 4.1 Compact View

面向普通用户。

只展示核心路径：

```text id="bipjcp"
1. 理解任务：分析 300033 同花顺今日走势与量化信号
2. 获取行情：读取实时价格、成交量、涨跌幅
3. 获取盘口：读取五档盘口与逐笔成交
4. 获取资金流：读取主力净流入与大单数据
5. 获取财务：读取 PE、PB、ROE、净利润增速
6. 计算信号：趋势、资金、估值、风险评分
7. 生成结论：短线偏强，但估值与波动风险需要观察
```

#### 4.2 Audit View

面向高级用户和开发者。

展示每一步的工具、参数、结果和观察：

```text id="slor71"
Step 03 · Fetch Capital Flow
Tool: get_capital_flow
Args:
  symbol: "300033"
  range: "1d"

Result:
  main_net_inflow: 1.23e8
  super_large_order: 0.62e8
  large_order: 0.41e8

Observation:
  主力资金为净流入，且超大单贡献较高，说明短线资金参与度较强。

Decision:
  将资金信号评分上调到 4/5。
```

#### 4.3 Raw View

面向调试和复现。

展示原始 JSONL event：

```json id="wnklpu"
{
  "type": "tool_result",
  "runId": "run_20260622_001",
  "stepId": "step_003",
  "toolCallId": "call_003",
  "toolName": "get_capital_flow",
  "status": "success",
  "latencyMs": 348,
  "resultPreview": {
    "main_net_inflow": 123000000,
    "super_large_order": 62000000,
    "large_order": 41000000
  }
}
```

### 5. Trajectory Event 类型

Trajectory 由一组事件组成。

```text id="8try3q"
TrajectoryEvent
├── user_request
├── task_understanding
├── plan
├── step_start
├── tool_call
├── tool_result
├── observation
├── decision
├── retry
├── warning
├── artifact_write
└── final_answer
```

### 6. Event 语义说明

| Event                | 说明                | 是否默认展示 |
| -------------------- | ----------------- | ------ |
| `user_request`       | 用户原始问题            | 是      |
| `task_understanding` | Agent 对任务的理解摘要    | 是      |
| `plan`               | 可展示的分析计划          | 是      |
| `step_start`         | 当前分析步骤开始          | 是      |
| `tool_call`          | 工具调用名称和参数         | 折叠     |
| `tool_result`        | 工具返回结果            | 折叠     |
| `observation`        | Agent 对结果的观察摘要    | 是      |
| `decision`           | Agent 基于观察做出的中间决策 | 是      |
| `retry`              | 工具失败后的重试          | 是      |
| `warning`            | 数据缺失、异常、风险提示      | 是      |
| `artifact_write`     | 写入 artifact 或生成组件 | 折叠     |
| `final_answer`       | 最终结论              | 是      |

### 7. TypeScript 数据模型

```typescript id="6j7l94"
export type TrajectoryEventType =
  | "user_request"
  | "task_understanding"
  | "plan"
  | "step_start"
  | "tool_call"
  | "tool_result"
  | "observation"
  | "decision"
  | "retry"
  | "warning"
  | "artifact_write"
  | "final_answer";

export interface TrajectoryEvent {
  id: string;
  runId: string;
  sessionId: string;
  parentId?: string;
  stepId?: string;
  timestamp: string;
  type: TrajectoryEventType;

  title: string;
  summary?: string;

  // 对用户可见的解释摘要
  display?: TrajectoryDisplay;

  // 工具相关
  tool?: TrajectoryToolPayload;

  // 证据相关
  evidence?: TrajectoryEvidence[];

  // 原始数据
  raw?: unknown;

  // 状态与性能
  status?: "pending" | "running" | "success" | "error" | "skipped";
  latencyMs?: number;
  tokenUsage?: {
    input?: number;
    output?: number;
    total?: number;
  };

  // 隐私与渲染策略
  visibility: "public" | "debug" | "hidden";
  redaction?: RedactionInfo;
}

export interface TrajectoryDisplay {
  compactText: string;
  detailText?: string;
  severity?: "info" | "success" | "warning" | "error";
  icon?: "user" | "agent" | "tool" | "data" | "decision" | "risk";
}

export interface TrajectoryToolPayload {
  callId: string;
  name: string;
  args: unknown;
  argsPreview?: string;
  resultPreview?: unknown;
  resultSizeBytes?: number;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
}

export interface TrajectoryEvidence {
  id: string;
  sourceType: "tool_result" | "table" | "chart" | "quote" | "metric" | "news" | "financial_report";
  sourceId: string;
  label: string;
  value?: string | number;
  unit?: string;
  confidence?: number;
}

export interface RedactionInfo {
  hasRedaction: boolean;
  fields: string[];
  reason: string;
}
```

### 8. JSONL 存储格式

Trajectory 应该和 session 一起保存，推荐使用 JSONL。

路径：

```text id="gmq7yy"
.ohquant/sessions/{cwd}/{session-id}.jsonl
.ohquant/trajectories/{cwd}/{session-id}.traj.jsonl
```

也可以先合并在 session JSONL 中，后续再拆分。

每一行是一个事件：

```json id="nnuoz2"
{
  "id": "evt_001",
  "runId": "run_20260622_001",
  "sessionId": "sess_abc123",
  "timestamp": "2026-06-22T10:12:01.123Z",
  "type": "user_request",
  "title": "用户请求",
  "summary": "分析 300033 同花顺今日走势，并给出量化信号。",
  "visibility": "public"
}
```

```json id="s563gu"
{
  "id": "evt_002",
  "runId": "run_20260622_001",
  "sessionId": "sess_abc123",
  "timestamp": "2026-06-22T10:12:02.001Z",
  "type": "plan",
  "title": "分析计划",
  "summary": "先获取行情与盘口，再分析资金流、财务估值和技术信号，最后生成综合判断。",
  "display": {
    "compactText": "行情 → 盘口 → 资金 → 财务 → 技术 → 综合结论",
    "severity": "info",
    "icon": "agent"
  },
  "visibility": "public"
}
```

```json id="oqm1um"
{
  "id": "evt_003",
  "runId": "run_20260622_001",
  "sessionId": "sess_abc123",
  "stepId": "step_quote",
  "timestamp": "2026-06-22T10:12:03.200Z",
  "type": "tool_call",
  "title": "调用行情工具",
  "summary": "获取 300033 的实时行情。",
  "tool": {
    "callId": "call_001",
    "name": "get_realtime_quote",
    "args": {
      "symbol": "300033"
    },
    "argsPreview": "symbol=300033"
  },
  "visibility": "debug"
}
```

```json id="5zlinc"
{
  "id": "evt_004",
  "runId": "run_20260622_001",
  "sessionId": "sess_abc123",
  "stepId": "step_quote",
  "timestamp": "2026-06-22T10:12:03.548Z",
  "type": "tool_result",
  "title": "行情工具返回",
  "summary": "最新价 128.40，涨幅 3.21%，成交额 18.6 亿。",
  "tool": {
    "callId": "call_001",
    "name": "get_realtime_quote",
    "resultPreview": {
      "price": 128.4,
      "changePct": 3.21,
      "turnover": 1860000000
    }
  },
  "status": "success",
  "latencyMs": 348,
  "visibility": "debug"
}
```

```json id="c9rybx"
{
  "id": "evt_005",
  "runId": "run_20260622_001",
  "sessionId": "sess_abc123",
  "stepId": "step_quote",
  "timestamp": "2026-06-22T10:12:04.000Z",
  "type": "observation",
  "title": "行情观察",
  "summary": "价格处于当日高位附近，成交额明显放大，短线关注度提升。",
  "evidence": [
    {
      "id": "ev_price",
      "sourceType": "tool_result",
      "sourceId": "evt_004",
      "label": "涨幅",
      "value": 3.21,
      "unit": "%"
    },
    {
      "id": "ev_turnover",
      "sourceType": "tool_result",
      "sourceId": "evt_004",
      "label": "成交额",
      "value": 18.6,
      "unit": "亿"
    }
  ],
  "visibility": "public"
}
```

### 9. Trajectory 页面组件

新增组件：

```text id="mz9wl1"
src/artifact/src/components/
├── trajectory.ts
├── trajectory-timeline.ts
├── trajectory-step.ts
├── trajectory-tool-call.ts
├── trajectory-evidence.ts
├── trajectory-raw.ts
└── trajectory-diff.ts
```

### 10. UI 展示结构

```text id="3l3gug"
┌────────────────────────────────────────────────────────────┐
│ Agent Trajectory                                           │
│ Compact | Audit | Raw                                      │
├────────────────────────────────────────────────────────────┤
│ ✓ 1. 理解任务                                               │
│    分析 300033 的行情、资金、财务和量化信号。                │
│                                                            │
│ ✓ 2. 制定计划                                               │
│    行情 → 盘口 → 资金 → 财务 → 技术 → 综合结论              │
│                                                            │
│ ✓ 3. 获取行情                                               │
│    Tool: get_realtime_quote                                │
│    Result: 最新价 128.40，涨幅 3.21%，成交额 18.6 亿         │
│    Observation: 放量上涨，短线关注度提升。                  │
│                                                            │
│ ✓ 4. 获取资金流                                             │
│    Tool: get_capital_flow                                  │
│    Result: 主力净流入 1.23 亿                               │
│    Decision: 资金信号上调为 4/5。                           │
│                                                            │
│ ! 5. 财务数据缺失                                           │
│    Warning: 最新季度现金流数据暂不可用。                    │
│    Decision: 财务质量评分降置信度。                         │
│                                                            │
│ ✓ 6. 生成结论                                               │
│    短线偏强，但需要继续观察资金连续性与估值压力。            │
└────────────────────────────────────────────────────────────┘
```

### 11. Trajectory 和结论的绑定

Artifact 中每一个 Agent 结论都应该能绑定证据。

示例：

```text id="nwxo65"
结论：
短线资金参与度较强。

Evidence:
- evt_004: 成交额 18.6 亿
- evt_008: 主力净流入 1.23 亿
- evt_009: 超大单净流入 0.62 亿
```

HTML 中可以实现为：

```html id="oh50va"
<span class="whyj-claim" data-evidence="evt_004 evt_008 evt_009">
  短线资金参与度较强
</span>
```

用户 hover 时展示：

```text id="227ph4"
证据：
1. 成交额 18.6 亿
2. 主力净流入 1.23 亿
3. 超大单净流入 0.62 亿
```

### 12. Trajectory 的四种展示模式

| 模式        | 面向用户 | 内容                                      |
| --------- | ---- | --------------------------------------- |
| `compact` | 普通用户 | 简化步骤 + 关键观察                             |
| `audit`   | 研究用户 | 工具参数 + 结果摘要 + 决策                        |
| `debug`   | 开发者  | raw args / raw result / latency / error |
| `raw`     | 复现   | 原始 JSONL                                |

默认模式：

```text id="vcweby"
compact
```

Artifact 导出参数：

```bash id="gmyiai"
/artifact export --latest --traj compact
/artifact export --latest --traj audit
/artifact export --latest --traj debug
/artifact export --latest --traj raw
/artifact export --latest --no-traj
```

### 13. Trajectory 采集策略

Trajectory 不能只靠导出时从最终文本反推。
应该在 Agent Runtime 运行过程中实时记录事件。

```text id="swbvne"
Agent Runtime
  ├── onUserMessage        → user_request
  ├── onTaskUnderstanding  → task_understanding
  ├── onPlanCreated        → plan
  ├── onStepStart          → step_start
  ├── beforeToolCall       → tool_call
  ├── afterToolResult      → tool_result
  ├── onObservation        → observation
  ├── onDecision           → decision
  ├── onRetry              → retry
  ├── onWarning            → warning
  └── onFinalAnswer        → final_answer
```

推荐新增：

```text id="ttc2s4"
src/agent/src/trajectory/
├── recorder.ts
├── events.ts
├── redact.ts
├── serializer.ts
└── summary.ts
```

### 14. Recorder 接口

```typescript id="gxt0bk"
export interface TrajectoryRecorder {
  record(event: TrajectoryEvent): Promise<void>;

  userRequest(input: string): Promise<void>;

  taskUnderstanding(summary: string): Promise<void>;

  plan(plan: string | string[]): Promise<void>;

  stepStart(step: {
    id: string;
    title: string;
    summary?: string;
  }): Promise<void>;

  toolCall(call: {
    stepId: string;
    toolName: string;
    args: unknown;
  }): Promise<string>;

  toolResult(result: {
    callId: string;
    toolName: string;
    result: unknown;
    status: "success" | "error";
    latencyMs?: number;
  }): Promise<void>;

  observation(observation: {
    stepId: string;
    summary: string;
    evidence?: TrajectoryEvidence[];
  }): Promise<void>;

  decision(decision: {
    stepId: string;
    summary: string;
    confidence?: number;
  }): Promise<void>;

  warning(warning: {
    stepId?: string;
    summary: string;
    evidence?: TrajectoryEvidence[];
  }): Promise<void>;

  finalAnswer(answer: string): Promise<void>;
}
```

### 15. Agent Prompt 约束

为了生成高质量 trajectory，需要给 Agent 明确输出约束。

内部指令可以是：

```text id="5101va"
在每个任务中，你需要维护一个可展示的 Trajectory。
Trajectory 不是隐藏思维链，而是面向用户的执行轨迹摘要。

你需要在以下时机记录事件：
1. 理解用户任务后，记录 task_understanding。
2. 制定可执行步骤后，记录 plan。
3. 每次调用工具前，记录 tool_call。
4. 每次工具返回后，记录 tool_result。
5. 读取工具结果后，记录 observation。
6. 基于观察调整策略或评分时，记录 decision。
7. 数据缺失、工具失败、结果冲突时，记录 warning 或 retry。
8. 输出最终答案时，记录 final_answer。

每条 observation 必须尽量绑定 evidence。
不要记录隐藏思维链原文。
不要记录系统提示词。
不要记录密钥、环境变量、认证信息。
```

### 16. 量化分析中的 Trajectory 示例

用户请求：

```text id="271oma"
分析 300033 同花顺，看看今天能不能追。
```

Trajectory：

```text id="36z9c4"
1. 任务理解
   用户想判断 300033 今日是否适合追涨，重点是短线交易风险。

2. 分析计划
   先看实时行情和成交量，再看盘口和资金流，然后检查估值、财务和技术位置，最后给出追涨风险判断。

3. 调用 get_realtime_quote
   参数：symbol=300033
   结果：涨幅 3.21%，成交额 18.6 亿，换手率 4.8%。

4. 观察
   个股处于放量上涨状态，短线热度较高。

5. 调用 get_order_book
   参数：symbol=300033
   结果：买盘强于卖盘，委比 +18%。

6. 观察
   盘口短线偏强，但买一集中度偏高，存在撤单风险。

7. 调用 get_capital_flow
   参数：symbol=300033, range=1d
   结果：主力净流入 1.23 亿，超大单净流入 0.62 亿。

8. 决策
   资金信号评分上调为 4/5。

9. 调用 get_valuation
   参数：symbol=300033
   结果：PE 分位数处于近三年 82% 位置。

10. 观察
    估值不便宜，追涨需要降低仓位或等待回踩。

11. 最终结论
    短线趋势和资金偏强，但估值与追高风险较高，不建议无条件追，适合等待回踩或分批。
```

### 17. Trajectory 与量化评分联动

量化评分不能只展示结果，要展示评分来源。

```text id="z1yicc"
综合评分：72 / 100

拆解：
- 趋势信号：80
  Evidence: MA 多头排列、20 日收益为正
- 资金信号：85
  Evidence: 主力净流入、超大单净流入
- 估值信号：45
  Evidence: PE 分位数 82%
- 风险信号：58
  Evidence: 近 20 日波动率上升、ATR 扩大
```

每个评分项绑定 trajectory event：

```typescript id="xovelu"
export interface QuantScoreBlock {
  factor: string;
  score: number;
  explanation: string;
  evidenceEventIds: string[];
}
```

### 18. Trajectory 渲染规则

#### 18.1 普通用户默认隐藏 raw

默认只展示：

* 任务理解
* 分析计划
* 关键工具名
* 关键结果摘要
* 观察
* 决策
* 最终结论

默认隐藏：

* 完整工具参数
* 完整工具返回
* token usage
* latency
* raw JSON
* stack trace

#### 18.2 Debug 模式显示完整信息

Debug 模式显示：

* raw args
* raw result
* error stack
* latency
* token usage
* retry count
* truncation info

#### 18.3 敏感字段必须脱敏

必须脱敏：

```text id="mwmrks"
api_key
token
secret
password
cookie
authorization
access_key
private_key
session
```

示例：

```json id="p3o7ip"
{
  "authorization": "Bearer ****",
  "api_key": "sk-****"
}
```

### 19. ArtifactDocument 更新

原来的 ArtifactDocument 增加 `trajectory` 字段。

```typescript id="520ojb"
export interface ArtifactDocument {
  id: string;
  title: string;
  sourceSessionId: string;
  generatedAt: string;
  schemaVersion: string;
  generatorVersion: string;
  metadata: ArtifactMetadata;
  blocks: ArtifactBlock[];
  trajectory?: TrajectoryDocument;
  toc: ArtifactTocItem[];
}

export interface TrajectoryDocument {
  runId: string;
  sessionId: string;
  mode: "compact" | "audit" | "debug" | "raw";
  events: TrajectoryEvent[];
  summary: TrajectorySummary;
}

export interface TrajectorySummary {
  totalEvents: number;
  toolCallCount: number;
  successToolCallCount: number;
  failedToolCallCount: number;
  retryCount: number;
  warningCount: number;
  totalLatencyMs?: number;
  toolsUsed: string[];
  evidenceCount: number;
}
```

### 20. TOC 更新

Artifact TOC 增加 Trajectory 目录。

```text id="3caa57"
Overview
行情摘要
K 线与盘口
资金流
财务估值
量化评分
Agent Summary
Agent Trajectory
  - 任务理解
  - 分析计划
  - 行情工具
  - 资金工具
  - 财务工具
  - 评分决策
  - 最终结论
Raw Data
```

### 21. MVP 实现范围

第一版只做以下能力：

1. 记录 `user_request`
2. 记录 `plan`
3. 记录 `tool_call`
4. 记录 `tool_result`
5. 记录 `observation`
6. 记录 `final_answer`
7. Artifact 中渲染 Compact View
8. 支持展开 Tool Call / Tool Result
9. 支持 Raw JSONL 查看
10. 支持敏感字段脱敏

暂不做：

* 自动证据 hover
* trajectory diff
* 多 Agent 分支轨迹
* token 成本图
* 复杂 DAG 可视化
* replay 播放

### 22. Phase Plan 更新

#### Phase 1: Basic Trajectory

交付：

* `TrajectoryEvent` 类型
* `TrajectoryRecorder`
* `.traj.jsonl` 写入
* `tool_call/tool_result` 捕获
* Artifact Compact View 渲染

#### Phase 2: Evidence Binding

交付：

* `TrajectoryEvidence`
* 结论绑定 evidence
* 评分项绑定 evidence
* Hover evidence tooltip

#### Phase 3: Audit / Debug View

交付：

* Audit View
* Raw View
* latency / error / retry 展示
* 脱敏规则增强

#### Phase 4: Quant Trajectory

交付：

* 趋势分析 trajectory
* 资金分析 trajectory
* 财务分析 trajectory
* 回测分析 trajectory
* 评分来源链路

#### Phase 5: Trajectory Graph

交付：

* DAG 视图
* 多工具并行分支
* 失败重试路径
* Artifact replay mode

## 23. 一句话定义

Trajectory 是 WhyJ Quant Artifact 中用于展示 Agent 执行过程的可审计轨迹层。

它不展示隐藏思维链原文，而是展示用户可理解、开发者可调试、结论可追溯的任务执行路径：

```text id="g7uu5r"
用户问题
→ 任务理解
→ 分析计划
→ 工具调用
→ 工具结果
→ 观察
→ 决策
→ 证据
→ 最终结论
```

我建议你把原来的 `trace.ts` 改名或升级为：

```text
trajectory.ts
```

然后再把工具调用细节拆成子组件：

```text
trajectory.ts
trajectory-step.ts
trajectory-tool-call.ts
trajectory-evidence.ts
trajectory-raw.ts
```

这样你的 Artifact 就不是普通“报告页面”，而是一个 **可复盘的 Agent 研究过程页面**。
