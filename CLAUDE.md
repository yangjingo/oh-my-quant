---
name: oh-my-quant
description: 精简后的量化技能仓库，聚焦可执行脚本与最小 CLI，包含个人基金组合看板与投资知识体系。
---

# oh-my-quant

## 目标

这个仓库现在只保留真实可运行的量化工具链：

- 数据下载
- 单因子统计
- 均线回测
- 风险指标
- benchmark 评分看板与策略跑分
- 个人基金组合看板（portfolio）

## 结构

```text
oh-my-quant/
├── ROADMAP.md
├── DESIGN.md                         # NewForm brutalist 设计系统（WhyJ Quant）
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
│   ├── validate/
│   └── portfolio/                   # 个人基金组合看板 + 投资理念引擎
└── docs/
    ├── reference.md                  # 量化资源索引
    └── notes.md                      # 投资原则与知识体系
```

## 约定

- `DESIGN.md` 是项目唯一的 UI 设计系统来源，portfolio 看板基于它构建
- `docs/notes.md` 是投资原则和知识体系的唯一真源，philosophy.py 中的大师法则是其子集
- 非 portfolio 的通用 HTML 看板不再维护
- CLI 只能暴露已实现并能运行的命令
- 未接入 CLI 的 skill 文档不再保留
- 非 CLI 方向只允许保留在 `ROADMAP.md`
- `benchmark/results/` 中的 JSON 是唯一结果源
- push 前依然需要先做代码审查
