import type { AkshareIndexQuote } from "./akshare-types.ts";
import { normalizeSecurityCode, numberOrNull } from "./akshare-normalize.ts";

const SINA_INDEX_QUOTE_GROUPS: Record<string, string[]> = {
  "沪深重要指数": ["000001", "399001", "000300", "000905", "399006", "000016", "000852", "000688"],
  "上证系列指数": ["000001", "000016", "000300", "000905", "000852", "000688"],
  "深证系列指数": ["399001", "399005", "399006", "399300", "399905"],
  "中证系列指数": ["000300", "000905", "000852", "000903", "000904", "000906", "000907", "000908", "000909", "000910"],
};

export async function fetchSinaAIndexSpotQuotes(categories: string[], signal?: AbortSignal): Promise<AkshareIndexQuote[]> {
  signal?.throwIfAborted();
  const codes = resolveSinaIndexSymbols(categories);
  if (codes.length === 0) return [];

  const response = await fetch(`https://hq.sinajs.cn/list=${codes.map(sinaIndexQuoteSymbol).join(",")}`, {
    signal,
    headers: {
      "User-Agent": "Mozilla/5.0",
      "Referer": "https://finance.sina.com.cn/",
    },
  });
  if (!response.ok) throw new Error(`Sina index quotes HTTP ${response.status}`);

  const text = new TextDecoder("gb18030" as never).decode(await response.arrayBuffer());
  signal?.throwIfAborted();
  const rows = parseSinaIndexQuotes(text);
  const byCode = new Map(rows.map((row) => [row.code, row]));
  return codes.map((code) => byCode.get(code)).filter((row): row is AkshareIndexQuote => Boolean(row));
}

function resolveSinaIndexSymbols(categories: string[]): string[] {
  const codes = new Set<string>();
  for (const category of categories) {
    const mapped = SINA_INDEX_QUOTE_GROUPS[category];
    if (mapped) {
      for (const code of mapped) codes.add(code);
      continue;
    }
    const direct = normalizeSecurityCode(category);
    if (direct) codes.add(direct);
  }
  if (codes.size === 0) {
    for (const code of SINA_INDEX_QUOTE_GROUPS["沪深重要指数"]) codes.add(code);
  }
  return [...codes];
}

function sinaIndexQuoteSymbol(code: string): string {
  return code.startsWith("399") ? `sz${code}` : `sh${code}`;
}

function parseSinaIndexQuotes(text: string): AkshareIndexQuote[] {
  const rows: AkshareIndexQuote[] = [];
  const pattern = /var\s+hq_str_(\w+)="([^"]*)";/g;
  for (const match of text.matchAll(pattern)) {
    const rawSymbol = match[1] || "";
    const code = rawSymbol.replace(/^(sh|sz|bj)/iu, "");
    const values = (match[2] || "").split(",");
    const name = values[0]?.trim() || "";
    const open = numberOrNull(values[1]);
    const prevClose = numberOrNull(values[2]);
    const price = numberOrNull(values[3] ?? values[1] ?? values[2]);
    if (!code || !name || price == null) continue;
    const high = numberOrNull(values[4]);
    const low = numberOrNull(values[5]);
    const volume = numberOrNull(values[8]);
    const amount = numberOrNull(values[9]);
    const change = prevClose == null ? null : price - prevClose;
    const changePct = prevClose == null ? null : ((price - prevClose) / prevClose) * 100;
    const date = values[30] ?? "", time = values[31] ?? "", stamp = date + "T" + time;
    const dated = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(stamp) && Number.isFinite(Date.parse(stamp + "Z"))
      && new Date(stamp + "Z").toISOString().slice(0, 19) === stamp;
    rows.push({
      ...(dated ? { asOfDate: date, asOfTime: time, provider: "新浪指数快照" } : {}),
      code,
      name,
      price,
      change,
      changePct,
      open,
      high,
      low,
      prevClose,
      volume,
      amount,
      source: "akshare",
    });
  }
  return rows;
}
