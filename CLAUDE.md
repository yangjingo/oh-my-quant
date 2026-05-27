---
name: oh-my-quant
description: 精简后的量化技能仓库，聚焦可执行脚本与最小 CLI。
---

# oh-my-quant

## 目标

这个仓库现在只保留真实可运行的量化工具链：

- 数据下载
- 单因子统计
- 均线回测
- 风险指标
- benchmark 评分

## 结构

```text
oh-my-quant/
├── ROADMAP.md
├── cli/
├── benchmark/
│   ├── data/
│   ├── results/
│   └── scripts/
├── skills/
│   ├── datasource/
│   ├── factor/
│   ├── backtest/
│   ├── risk/
│   └── validate/
└── docs/reference.md
```

## 约定

- 不再维护 HTML 看板；`docs/DESIGN.md` 保留为未来 UI 规范文档
- CLI 只能暴露已实现并能运行的命令
- 未接入 CLI 的 skill 文档不再保留
- 非 CLI 方向只允许保留在 `ROADMAP.md`
- `benchmark/results/` 中的 JSON 是唯一结果源
- push 前依然需要先做代码审查
