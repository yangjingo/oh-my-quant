# Repository Guidelines

## Project Structure & Module Organization
`src/whyj_quant/` contains the `click` CLI entrypoint and command routing. Keep CLI orchestration there and put reusable logic in `skills/<skill>/scripts/`. Each skill directory should contain a `SKILL.md` plus focused Python helpers, for example `skills/data/scripts/fetch.py` or `skills/factor/scripts/compute.py`. `benchmark/` holds scoring, dashboard generation, sample data, and generated result artifacts. `docs/` stores shared references and the UI design contract in `docs/DESIGN.md`.

## Build, Test, and Development Commands
Use `uv` for the local workflow:

- `uv sync` installs Python 3.12 dependencies from `pyproject.toml`.
- `uv run whyj-quant --help` lists CLI commands.
- `uv run whyj-quant run -p "回测平安银行均线策略"` exercises the natural-language router.
- `uv run whyj-quant validate all` checks that each skill exposes `SKILL.md` and scripts.
- `uv run whyj-quant benchmark run --symbol 000001` runs a benchmark evaluation.
- `uv run whyj-quant dashboard --html` rebuilds the HTML dashboard in `benchmark/metrics/`.

## Coding Style & Naming Conventions
Target Python 3.12, use 4-space indentation, and follow existing PEP 8-style naming: `snake_case` for modules, functions, and variables; short imperative names for CLI handlers such as `backtest_run`. Keep command definitions thin and move data, factor, risk, and benchmark calculations into `scripts/`. Add type hints to new public helpers when practical. No formatter is configured in this repo, so match the existing import grouping and concise docstring style. Any UI-facing benchmark output must follow `docs/DESIGN.md`.

## Testing Guidelines
This repository currently relies on CLI and structure validation rather than a dedicated `tests/` package. For any behavior change, run `uv run whyj-quant validate all` plus at least one targeted command affected by the change. If you modify benchmark rendering, regenerate the relevant HTML under `benchmark/metrics/` and verify the output locally.

## Commit & Pull Request Guidelines
Recent history follows Conventional Commit prefixes such as `feat:`, `fix:`, and `refactor:`. Keep commits scoped to one logical change. PRs should describe the affected skill or benchmark module, list validation commands run, and include screenshots when changing dashboards or K-line pages. Update `README.md`, `CHANGELOG.md`, and `docs/reference.MD` whenever contributor-facing workflows or outputs change.

## Security & Configuration Tips
Do not commit `.env`, local virtual environments, or private data exports. Prefer reproducible sample inputs under `benchmark/data/`, and document any new external data dependency such as `akshare` or `yfinance`.
