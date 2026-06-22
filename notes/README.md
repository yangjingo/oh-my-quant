# Notes

`notes/` 是个人量化学习笔记和投资知识库，独立于 `docs/`（产品/工程文档）。

## 文件地图

```
notes/
├── README.md              ← 你在这里
└── quant/
    ├── notes.md           投资原则、大师法则、基金分类、资产配置框架、自检清单
    ├── funder.md          16 位全球投资大师索引：YouTube/书籍/核心原则
    ├── daily.md           每日学习笔记和读书摘录
    └── strategy.md        strategy research notes (WIP)
```

## 文件关系与用途

| 文件 | 定位 | 更新频率 | 是否被系统消费 |
|------|------|---------|--------------|
| `notes.md` | **知识体系唯一真源** — 原则、法则、框架、清单 | 季度 review | 是 → `/insight` 管道 |
| `funder.md` | **大师索引** — 演讲、书籍、核心投资原则 | 随学习补充 | 是 → `/insight` 管道 |
| `daily.md` | **日记/摘录** — 每日学习碎片和读书笔记 | 随时 | 否 |
| `strategy.md` | **Strategy experiments** — backtest ideas, factor notes | ad-hoc | no |

## 与 `/insight` 的关系

`/insight` 是系统的投资智慧提示引擎，在 Agent 思考时展示投资格言和原则。

### 数据流

```
notes/quant/notes.md  ──┐
                         ├──→ insight-generator.ts  ──→  .ohquant/insights.json  ──→  TUI spinner tips
notes/quant/funder.md  ──┘
```

1. **输入：** `insight-generator.ts` 解析 `notes.md` 和 `funder.md`
   - `notes.md` → 提取 P1-P4 原则 + 8 条大师法则
   - `funder.md` → 提取 16 位大师的核心投资原则
2. **输出：** `InsightEntry[]` 写入 `.ohquant/insights.json`
3. **消费：** TUI loading overlay 在 Agent 思考时随机展示这些格言
4. **自动刷新：** 首次调用 `getQuotes()` 时，系统比较源文件 mtime，若笔记更新则自动重新生成

### 如何让新内容被 `/insight` 识别

- **添加新原则** → 在 `notes.md` 中按 `**Pn — 标题**` 格式写，含 `*对应智慧：...*` 标记
- **添加新大师** → 在 `funder.md` 中按 `## 大师名` + `### 核心投资原则` 格式写
- **`daily.md` and `strategy.md`** are not consumed by the insight pipeline — pure personal notes

## 快速跳转

- 从 [投资原则](./quant/notes.md) 开始，这是知识体系的核心
- 查看 [大师索引](./quant/funder.md) 寻找演讲和书籍推荐
- 日常记录写入 [每日笔记](./quant/daily.md)
- 回到项目 [README](../README.md)
