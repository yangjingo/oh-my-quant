/** Warm visual tokens shared by the TUI, Desktop, and generated HTML reports. */
export const WHYJ_THEME = {
  gold: "#C99A2E",
  goldHighlight: "#C99A2E",
  cashDark: "#8C856B",
  cashWarm: "#FFF3C4",
  cream: "#FFF3C4",
  muted: "#8F8A7B",
  bodyCopy: "#FFF3C4",
  authorCopy: "#8F8A7B",
  hairline: "#3A362C",
  stepDim: "#3A362C",
  positive: "#75A26F",
  negative: "#D87565",
  marketUp: "#D87565",
  marketDown: "#75A26F",
  codeDim: "#8F8A7B",
  thinking: "#8F8A7B",
  canvas: "#0C0C0C",
  surface: "#141312",
  surfaceHigh: "#1C1B18",
  primaryContainer: "#2A2416",
  outline: "#817F77",
  selectionFg: "#0C0C0C",
  selectionBg: "#C99A2E",
} as const;

/** One explicit convention for all markets in a workspace, including mixed portfolios. */
export type MarketColorScheme = "red-up" | "green-up";

export function normalizeMarketColorScheme(value: unknown): MarketColorScheme {
  return value === "green-up" ? "green-up" : "red-up";
}

export function marketColors(scheme?: MarketColorScheme) {
  return scheme === "green-up"
    ? { up: WHYJ_THEME.marketDown, down: WHYJ_THEME.marketUp, neutral: WHYJ_THEME.muted }
    : { up: WHYJ_THEME.marketUp, down: WHYJ_THEME.marketDown, neutral: WHYJ_THEME.muted };
}

export function marketColorLabel(scheme?: MarketColorScheme): string {
  return scheme === "green-up" ? "Green up / Red down" : "Red up / Green down";
}
