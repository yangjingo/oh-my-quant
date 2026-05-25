"""Cross-Check: 对比 skill 输出与 CLI 工具输出"""

import pandas as pd
import numpy as np

TOLERANCE = {
    "cagr": 0.02,     # 2% 绝对差值
    "sharpe": 0.2,    # 0.2 绝对差值
    "max_dd": 0.05,   # 5% 绝对差值
    "annual_vol": 0.03,
}


def compare(skill_result: dict, cli_result: dict, metrics: list = None) -> dict:
    """
    对比两组结果的关键指标。

    skill_result / cli_result: {"cagr": 0.12, "sharpe": 1.5, "max_dd": -0.25, ...}
    返回: {metric: {"skill": X, "cli": Y, "diff": Z, "match": bool}}
    """
    if metrics is None:
        metrics = ["cagr", "sharpe", "max_dd", "annual_vol"]

    comparison = {}
    for m in metrics:
        sv = skill_result.get(m)
        cv = cli_result.get(m)
        if sv is None or cv is None:
            comparison[m] = {"skill": sv, "cli": cv, "match": None}
            continue
        diff = abs(sv - cv)
        match = diff <= TOLERANCE.get(m, 0.05)
        comparison[m] = {"skill": round(sv, 4), "cli": round(cv, 4), "diff": round(diff, 4), "match": match}

    all_match = all(v["match"] for v in comparison.values() if v["match"] is not None)
    comparison["_consensus"] = "consistent" if all_match else "divergent" if any(v["match"] is False for v in comparison.values()) else "unknown"
    return comparison


def format_report(skill_name: str, task: str, comparison: dict) -> str:
    """格式化 cross-check 报告"""
    lines = [f"## Cross-Check: {skill_name} vs CLI", f"Task: {task}", ""]
    lines.append("| 指标 | Skill | CLI | Diff | Match |")
    lines.append("|------|-------|-----|------|-------|")
    for m, v in comparison.items():
        if m.startswith("_"):
            continue
        icon = "✓" if v["match"] else "✗" if v["match"] is False else "?"
        lines.append(f"| {m} | {v['skill']} | {v['cli']} | {v['diff']} | {icon} |")
    lines.append(f"\n**结论**: {comparison['_consensus']}")
    return "\n".join(lines)
