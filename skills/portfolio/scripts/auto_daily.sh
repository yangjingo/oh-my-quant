#!/bin/bash
# Portfolio daily auto-run — schedule at 21:00 via Task Scheduler or cron
cd "$(dirname "$0")/../../.."
echo "[$(date '+%Y-%m-%d %H:%M:%S')] === Portfolio daily run ==="
python -X utf8 skills/portfolio/scripts/daily.py
python -X utf8 skills/portfolio/scripts/generate.py
echo "[$(date '+%Y-%m-%d %H:%M:%S')] === Done ==="
