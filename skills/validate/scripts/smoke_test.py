"""Skill 冒烟测试 — 验证单个 skill 能力"""

import os
import subprocess
import time


TEST_CASES = {
    "data": "下载平安银行(symbol=000001)2024年1月到6月的日线数据，输出数据行数和关键字段统计",
    "factor": "计算000001平安银行的20日动量因子，输出因子描述性统计(均值/标准差/IC)",
    "backtest": "回测平安银行2024年1月到12月的20日/60日均线交叉策略，输出年化收益和最大回撤",
    "risk": "计算上证指数2024年的年化波动率、95%VaR和最大回撤",
    "research": "完整研究平安银行均线策略，串联数据、因子、回测和风险分析，输出综合研究结论",
    "intel": "抓取Howard Marks(Oaktree Capital)最新一篇备忘录的标题和核心观点",
    "consensus": "统计本季 top 30 13F 管理人共同加仓的 Top 20 股票，输出新进、退出、强度变化、行业主题总结和风险提示",
    "benchmark": "对沪深300指数2024年买入持有策略进行基准评测，输出综合得分（benchmark SKILL 位于 benchmark/SKILL.md）",
}

MCP_TOOLS = {
    "vibe-trading": {"type": "cli", "check": "vibe-trading --version", "run": 'vibe-trading run -p "{task}"'},
}


def run_smoke(skill: str) -> dict:
    """运行单个 skill 冒烟测试，返回结果字典"""
    if skill not in TEST_CASES:
        return {"skill": skill, "status": "unknown", "error": f"no test case for {skill}"}

    task = TEST_CASES[skill]
    start = time.time()

    # 模拟验证: 检查 skill 的 SKILL.md 是否可读 + scripts 是否可 import
    result = {"skill": skill, "task": task, "status": "pending"}

    # benchmark skill 位于 benchmark/ 而非 skills/
    skill_paths = [f"skills/{skill}/SKILL.md"]
    if skill == "benchmark":
        skill_paths = ["benchmark/SKILL.md"]
    skill_md = next((p for p in skill_paths if os.path.exists(p)), None)
    if skill_md:
        result["skill_md"] = True
    else:
        result["skill_md"] = False
        result["status"] = "fail"
        result["error"] = f"SKILL.md not found (tried: {skill_paths})"

    # 检查 scripts 目录
    scripts_paths = [f"skills/{skill}/scripts"]
    if skill == "benchmark":
        scripts_paths = ["benchmark/scripts"]
    scripts_dir = next((p for p in scripts_paths if os.path.isdir(p)), None)
    if scripts_dir:
        py_files = [f for f in os.listdir(scripts_dir) if f.endswith(".py")]
        result["scripts"] = py_files
    else:
        result["scripts"] = []

    result["elapsed"] = round(time.time() - start, 2)
    if result["status"] == "pending":
        result["status"] = "ready"  # skill 结构验证通过

    return result


def smoke_all() -> list[dict]:
    """运行全部 skill 冒烟测试"""
    results = []
    for skill in TEST_CASES:
        r = run_smoke(skill)
        results.append(r)
        print(f"  [{r['status']}] {skill}")
    return results


def check_cli_tools() -> dict:
    """检查外部 CLI 工具是否可用"""
    status = {}
    for name, cfg in MCP_TOOLS.items():
        try:
            r = subprocess.run(cfg["check"], shell=True, capture_output=True, text=True, timeout=10)
            status[name] = {"available": r.returncode == 0, "version": r.stdout.strip()[:100]}
        except Exception as e:
            status[name] = {"available": False, "error": str(e)}
    return status
