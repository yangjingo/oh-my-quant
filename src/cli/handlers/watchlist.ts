import type { CommandHandler } from "../types.ts";
const watchUsage = "Use /watch CODE, /watch remove CODE, or /add stock --code CODE";

export const watchHandler: CommandHandler = async (flags, positional) => {
  const { loadWatchlist, saveWatchlist } = await import("../../storage/index.ts");
  const watchlist = loadWatchlist();

  if (positional[0] === "remove") {
    const code = positional[1] || String(flags.code || flags.symbol || flags.c || "");
    if (!code) return { success: false, message: watchUsage };
    const before = watchlist.funds.length;
    watchlist.funds = watchlist.funds.filter((f) => f.code !== code);
    if (watchlist.funds.length === before) return { success: false, message: `${code} is not in the watchlist.` };
    saveWatchlist(watchlist);
    return { success: true, message: `Removed ${code}.` };
  }

  if (positional[0]) {
    const code = positional[0];
    if (watchlist.funds.some((f) => f.code === code)) return { success: false, message: `${code} is already in the watchlist.` };
    const name = flags.name ? String(flags.name) : code;
    watchlist.funds.push({ code, name, added: new Date().toISOString().slice(0, 10) });
    saveWatchlist(watchlist);
    return { success: true, message: `Added ${name} (${code}).` };
  }

  if (watchlist.funds.length === 0) return { success: true, message: "Watchlist is empty." };
  const lines = watchlist.funds.map((f, i) => `  ${i + 1}. ${f.code.padEnd(14)} ${f.name.padEnd(16)}  (${f.added})`);
  return { success: true, message: [`Watchlist (${watchlist.funds.length})`, ...lines].join("\n") };
};

export const panelHandler: CommandHandler = async (flags, positional) => {
  const { loadPanelPortfolio, savePanelPortfolio } = await import("../../storage/index.ts");
  const panel = loadPanelPortfolio();
  const panelUsage = "Use /portfolio for the local comparison panel";

  if (positional[0] === "remove") {
    const code = positional[1] || String(flags.code || flags.symbol || flags.s || flags.c || "");
    if (!code) return { success: false, message: panelUsage };
    const before = panel.symbols.length;
    panel.symbols = panel.symbols.filter((entry) => entry.code !== code);
    if (panel.symbols.length === before) return { success: false, message: `${code} is not in the panel portfolio.` };
    savePanelPortfolio(panel);
    return { success: true, message: `Removed ${code} from panel-portfolio.json.` };
  }

  if (positional[0]) {
    const code = positional[0];
    if (panel.symbols.some((entry) => entry.code === code)) {
      return { success: false, message: `${code} is already in the panel portfolio.` };
    }
    const name = flags.name ? String(flags.name) : code;
    panel.symbols.push({ code, name, added: new Date().toISOString().slice(0, 10) });
    savePanelPortfolio(panel);
    return { success: true, message: `Added ${name} (${code}) to panel-portfolio.json.` };
  }

  if (panel.symbols.length === 0) {
    return {
      success: true,
      message: "The panel portfolio is empty. Use /portfolio for the local comparison panel.",
    };
  }
  const lines = panel.symbols.map(
    (entry, i) => `  ${i + 1}. ${entry.code.padEnd(14)} ${entry.name.padEnd(16)}  (${entry.added})`,
  );
  return {
    success: true,
    message: [`Panel portfolio (${panel.symbols.length}) · .ohquant/panel-portfolio.json`, ...lines].join("\n"),
  };
};

export const addHandler: CommandHandler = async (flags, positional) => {
  const action = positional[0] || "list";
  if (action === "stock") {
    const code = String(flags.code || flags.symbol || flags.s || flags.c || positional[1] || "");
    if (!code) return { success: false, message: watchUsage };
    return watchHandler(flags, [code], {});
  }
  if (action === "list") return watchHandler(flags, [], {});
  if (action === "remove") {
    const code = String(flags.code || flags.symbol || flags.s || flags.c || positional[1] || "");
    return watchHandler(flags, ["remove", code], {});
  }
  return { success: false, message: watchUsage };
};
