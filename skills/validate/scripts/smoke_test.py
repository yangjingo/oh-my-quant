"""Minimal structure checks for local skills and dashboard."""

from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SKILLS_DIR = ROOT / "skills"
BENCHMARK_DIR = ROOT / "benchmark"

TARGETS = [
    ("datasource", True),
    ("factor", True),
    ("backtest", True),
    ("risk", True),
    ("validate", True),
    ("benchmark", True),
]


def run_smoke(name: str) -> dict:
    if name == "benchmark":
        skill_md = BENCHMARK_DIR / "SKILL.md"
        scripts_dir = BENCHMARK_DIR / "scripts"
        needs_scripts = True
    else:
        spec = {target: scripts for target, scripts in TARGETS}
        if name not in spec:
            return {"target": name, "status": "unknown"}
        skill_md = SKILLS_DIR / name / "SKILL.md"
        scripts_dir = SKILLS_DIR / name / "scripts"
        needs_scripts = spec[name]

    scripts = sorted(path.name for path in scripts_dir.glob("*.py")) if scripts_dir.is_dir() else []
    ok = skill_md.exists() and (bool(scripts) if needs_scripts else True)
    return {
        "target": name,
        "status": "ok" if ok else "fail",
        "skill_md": skill_md.exists(),
        "scripts": scripts,
    }


def smoke_all() -> list[dict]:
    return [run_smoke(name) for name, _ in TARGETS]
