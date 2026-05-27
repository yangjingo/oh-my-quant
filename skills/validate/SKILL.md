---
name: validate
description: |
  结构验证 skill。检查仓库中的 skill 与 benchmark 目录是否齐全。
---

# validate

验证目标已经收缩为项目内部结构一致性：

- `skills/*/SKILL.md`
- `skills/*/scripts/`
- `benchmark/SKILL.md`
- `benchmark/scripts/`

## CLI

```bash
whyj-quant validate all
```

## scripts

- `scripts/smoke_test.py`
