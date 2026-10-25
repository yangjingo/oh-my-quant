export const marketData = {
  // Local demo refresh event, independent of quote trading dates.
  refreshedAt: "2026-10-24 14:32",
  source: "本地合成 · 示例",
  watchlist: [
    {
      code: "300308.SZ",
      name: "中际旭创",
      change: "+1.84%",
      direction: "up",
      meta: "2026-10-23 · 合成示例",
    },
    {
      code: "300502.SZ",
      name: "新易盛",
      change: "+0.92%",
      direction: "up",
      meta: "2026-10-23 · 合成示例",
    },
    {
      code: "002281.SZ",
      name: "光迅科技",
      change: "−0.34%",
      direction: "down",
      meta: "2026-10-23 · 合成示例",
    },
    {
      code: "000063.SZ",
      name: "中兴通讯",
      change: "+0.65%",
      direction: "up",
      meta: "2026-10-23 · 合成示例",
    },
  ],
  market: [
    {
      code: "000001.SH",
      name: "上证指数",
      change: "+0.12%",
      direction: "up",
      meta: "2026-10-23 · 合成示例",
    },
    {
      code: "399001.SZ",
      name: "深证成指",
      change: "−0.14%",
      direction: "down",
      meta: "2026-10-23 · 合成示例",
    },
    {
      code: "000300.SH",
      name: "沪深300",
      change: "−0.54%",
      direction: "down",
      meta: "2026-10-23 · 合成示例",
    },
    {
      code: "000905.SH",
      name: "中证500",
      change: "+0.60%",
      direction: "up",
      meta: "2026-10-23 · 合成示例",
    },
    {
      code: "399006.SZ",
      name: "创业板指",
      change: "−0.26%",
      direction: "down",
      meta: "2026-10-23 · 合成示例",
    },
  ],
};

// Synthetic portfolio choices for the design preview, not account holdings.
export const portfolios = [
  { id: "optical", name: "光通信观察组", quotes: marketData.watchlist },
  { id: "indices", name: "宽基指数组合", quotes: marketData.market.slice(2) },
];
