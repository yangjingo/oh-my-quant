import type { Market } from "../../types/data.ts";
import { fetchBars } from "../../source/sources.ts";
import { normalizeDataSourceFlag } from "../../tools/catalog.ts";
import { runQuantTool } from "../params.ts";
import type { CommandHandler } from "../types.ts";

export const clawHandler: CommandHandler = async (flags, positional) => {
  const code = String(flags.code || flags.symbol || flags.c || positional[0] || "");
  if (!code) return { success: false, message: "Usage: /claw --code 000001.SZ" };
  const market = String(flags.market || flags.m || "A");

  let cachedBars: { date: string; close: number; open: number; high: number; low: number; volume: number }[] = [];
  let cachedName = code;
  try {
    const { loadBars, getMeta } = await import("../../storage/bars.ts");
    const meta = await getMeta(code, "tushare");
    if (meta) { cachedName = meta.name; cachedBars = await loadBars(code, "tushare"); }
  } catch { /* no cache */ }

  if (cachedBars.length > 0) {
    const last = cachedBars[cachedBars.length - 1];
    const first = cachedBars[0];
    const returns = cachedBars.slice(1).map((b, i) => b.close / cachedBars[i].close - 1);
    const posDays = returns.filter((r) => r > 0).length;
    const winRate = returns.length > 0 ? (posDays / returns.length * 100).toFixed(0) : "?";

    let mcpExtra = "";
    try {
      const { callTool } = await import("../../source/mcp-client.ts");
      if (market === "A") {
        try {
          const basic = await callTool("tushare", "daily_basic", { ts_code: code, trade_date: "" });
          const arr = Array.isArray(basic) ? basic : [];
          if (arr.length > 0) {
            const s = arr[arr.length - 1] as Record<string, unknown>;
            mcpExtra = [`PE (TTM):    ${s.pe ?? s.pe_ttm ?? "?"}`, `PB:          ${s.pb ?? "?"}`, `Market Cap:  ${Number(s.total_mv ?? s.circ_mv ?? 0).toLocaleString?.() ?? "?"} CNY`].join("\n");
          }
        } catch { /* MCP unavailable */ }
      }
    } catch { /* MCP not connected */ }

    return { success: true, message: [`${cachedName} (${code})`, `─────────────────────────────────`, `Range: ${first.date} → ${last.date} (${cachedBars.length} days)`, `Latest: ${last.close.toFixed(2)}  O:${last.open.toFixed(2)} H:${last.high.toFixed(2)} L:${last.low.toFixed(2)}`, `Volume: ${(last.volume / 1e6).toFixed(1)}M`, `Win Rate: ${winRate}%`, mcpExtra].filter(Boolean).join("\n") };
  }

  try {
    if (market === "A") {
      const { callTool } = await import("../../source/mcp-client.ts");
      let name = code;
      try {
        const basic = await callTool("tushare", "stock_basic", { ts_code: code });
        const arr = Array.isArray(basic) ? basic : [];
        if (arr.length > 0 && (arr[0] as Record<string, unknown>).name) name = (arr[0] as Record<string, unknown>).name as string;
      } catch { /* fallback */ }
      let snapshot: Record<string, unknown> = {};
      try { const basic = await callTool("tushare", "daily_basic", { ts_code: code, trade_date: "" }); const arr = Array.isArray(basic) ? basic : []; if (arr.length > 0) snapshot = arr[arr.length - 1] as Record<string, unknown>; } catch { /* empty */ }
      return { success: true, message: [`${name} (${code})`, `─────────────────────────────────`, `Industry: ${snapshot.industry ?? "?"}`, `Close: ${snapshot.close ?? "?"}`, `PE: ${snapshot.pe ?? snapshot.pe_ttm ?? "?"}`, `PB: ${snapshot.pb ?? "?"}`].join("\n") };
    }
    const { callTool } = await import("../../source/mcp-client.ts");
    const facts = await callTool("financial-datasets", "get_company_facts", { ticker: code });
    const metrics = await callTool("financial-datasets", "get_financial_metrics_snapshot", { ticker: code });
    const f = (facts as Record<string, unknown>) || {};
    const m = (metrics as Record<string, unknown>) || {};
    return { success: true, message: [`${f.company_name || code} (${code})`, `─────────────────────────────────`, `Sector: ${f.sector || "?"} / ${f.industry || "?"}`, `Market Cap: $${(Number(m.market_cap) / 1e9).toFixed(1) ?? "?"}B`, `PE: ${m.pe_ratio ?? "?"}`, `PB: ${m.pb_ratio ?? "?"}`].join("\n") };
  } catch {
    return { success: false, message: `No data for ${code}. /mcp connect first.` };
  }
};

export const dataHandler: CommandHandler = async (flags, positional) => {
  const action = positional[0] || "info";
  if (action === "download" || action === "fetch") {
    const symbol = String(flags.symbol || flags.code || flags.s || flags.c || positional[1] || "");
    if (!symbol) {
      return {
        success: false,
        message: "Usage: /data download --source akshare|tushare|llmquant|joinquant --symbol CODE",
      };
    }
    const sourceRaw = flags.source ? normalizeDataSourceFlag(String(flags.source)) : "";
    const m = String(flags.market || flags.m || "A") as Market;
    const start = flags.start ? String(flags.start) : undefined;
    const end = flags.end ? String(flags.end) : undefined;

    if (sourceRaw === "joinquant") {
      return { success: false, message: "JoinQuant (JQData) adapter is not implemented yet." };
    }
    if (sourceRaw === "akshare") {
      const { bars, source } = await fetchBars(symbol, m, start, end, "akshare");
      if (bars.length === 0) return { success: false, message: `No bars for ${symbol} via AKShare.` };
      const latest = bars[bars.length - 1];
      return {
        success: true,
        message: `${bars.length} bars for ${symbol} via ${source}\nLatest: ${latest?.date} close ${latest?.close.toFixed(2)}`,
        data: { symbol, source, barCount: bars.length },
      };
    }
    if (sourceRaw === "tushare") {
      return runQuantTool("tushare_daily", { ...flags, ts_code: symbol }, {});
    }
    if (sourceRaw === "llmquant") {
      return runQuantTool("llmquant_price", { ...flags, ticker: symbol }, {});
    }

    if (m === "US" || m === "HK") return runQuantTool("llmquant_price", { ...flags, ticker: symbol }, {});
    return runQuantTool("tushare_daily", { ...flags, ts_code: symbol }, {});
  }
  if (action === "info" || action === "snapshot") {
    const symbol = String(flags.symbol || flags.code || flags.s || flags.c || positional[1] || "");
    if (!symbol) return { success: false, message: "Usage: /data info --symbol CODE" };
    return clawHandler(flags, positional.slice(1), {});
  }
  return { success: false, message: "Usage: /data download --source SOURCE --symbol CODE | /data info --symbol CODE" };
};
