"""Exercise the packaged runtime with synthetic data and no network access."""
import importlib.metadata
import json
import tempfile
from pathlib import Path

import akshare
import akquant
import yfinance
import numpy as np
import pandas as pd
import pandas_market_calendars as calendars
import polars as pl
import pyarrow as pa
import pyarrow.parquet as pq
import plotly.graph_objects as go
from akquant.normalize import to_frame
from py_mini_racer import MiniRacer

versions = {name: importlib.metadata.version(name) for name in (
    "akshare", "akquant", "yfinance", "numpy", "pandas", "polars", "pyarrow",
    "plotly", "mini-racer", "pandas-market-calendars",
)}
# Keep the public testing helpers; only dependency-owned test suites are omitted.
np.testing.assert_allclose(np.linalg.solve([[2., 0.], [0., 4.]], [4., 8.]), [2., 2.])
frame = pd.DataFrame({"close": [10., 11., 12.], "volume": [100, 200, 300]})
arrow = pa.Table.from_pandas(frame)
pd.testing.assert_frame_equal(to_frame(arrow), frame)
pd.testing.assert_frame_equal(to_frame(pl.from_pandas(frame).lazy()), frame)
with tempfile.TemporaryDirectory(prefix="whyj-packaged-python-") as directory:
    parquet = Path(directory) / "行情.parquet"
    pq.write_table(arrow, parquet)
    pd.testing.assert_frame_equal(to_frame(parquet), frame)
    html = go.Figure(go.Scatter(y=frame["close"])).to_html(include_plotlyjs=True)
    assert "plotly.js" in html and len(html) > 1_000_000
with MiniRacer() as js:
    assert js.eval("[1, 2, 3].reduce((sum, x) => sum + x, 0)") == 6
schedule = calendars.get_calendar("NYSE").schedule("2024-01-01", "2024-01-05")
assert len(schedule) == 4 and str(schedule.iloc[0]["market_open"]) == "2024-01-02 14:30:00+00:00"
assert Path(yfinance.__file__).is_file() and Path(akshare.__file__).is_file()
print(json.dumps({"status": "passed", "versions": versions,
    "checks": ["imports-and-metadata", "numpy-linear-algebra", "arrow-polars-conversion",
               "parquet-roundtrip", "offline-plotly", "mini-racer", "calendar-data"]}))
