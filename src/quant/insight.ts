import { existsSync, readFileSync, statSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { generateInsights, getNotePaths } from "./insight-generator.ts";

// ── Types ──

export interface InvestmentQuote {
  quote: string;
  en: string;
  author: string;
}

export interface ConversationInsight {
  title: string;
  principle: string;
  wisdom: string;
  source: string;
  evidence: string;
}

interface InsightEntry {
  quote: string;
  en: string;
  author: string;
  title: string;
  principle: string;
  wisdom: string;
  source: string;
  keywords: string[];
}

interface InsightRule {
  title: string;
  principle: string;
  wisdom: string;
  source: string;
  keywords: readonly string[];
}

// ── Built-in rules (conversation triggers, not from notes) ──

const BUILTIN_RULES: readonly InsightRule[] = [
  {
    title: "Risk first",
    principle: "先控制回撤和仓位，再讨论收益空间。",
    wisdom: "芒格式原则：别把自己放进会被迫出局的位置。",
    source: "Risk management",
    keywords: ["risk", "drawdown", "volatility", "leverage", "loss", "stop", "风险", "回撤", "波动", "杠杆", "亏损", "止损"],
  },
  {
    title: "Margin of safety",
    principle: "价格只是入口，安全边际才是底线。",
    wisdom: "格雷厄姆/巴菲特的核心：留足缓冲，少犯致命错。",
    source: "Value investing",
    keywords: ["value", "valuation", "cheap", "intrinsic", "discount", "安全边际", "估值", "便宜", "内在价值", "折价"],
  },
  {
    title: "Avoid overfit",
    principle: "回测要看样本外，不要把参数优化当成 alpha。",
    wisdom: "优秀策略不是最漂亮的曲线，而是最不脆弱的曲线。",
    source: "Research process",
    keywords: ["backtest", "optimize", "overfit", "validation", "sample", "参数", "过拟合", "回测", "验证", "样本外"],
  },
  {
    title: "Position sizing",
    principle: "分散不是为了炫技，是为了避免单点失误。",
    wisdom: "仓位管理决定生存，组合结构决定你能不能等到对的那一刻。",
    source: "Portfolio construction",
    keywords: ["position", "portfolio", "allocation", "correlation", "diversify", "仓位", "组合", "配置", "分散", "相关性"],
  },
  {
    title: "Patience compounds",
    principle: "长期复利比短期刺激更重要。",
    wisdom: "真正的优势往往来自时间，而不是频率。",
    source: "Compounding",
    keywords: ["long-term", "patient", "hold", "compounding", "耐心", "复利", "长期", "持有", "时间"],
  },
  {
    title: "Trend with discipline",
    principle: "顺势可以，追价不行；信号要确认，不要想象。",
    wisdom: "动量有效，但纪律决定你是否能把它拿到终点。",
    source: "Trend following",
    keywords: ["trend", "momentum", "signal", "breakout", "顺势", "动量", "信号", "突破", "择时"],
  },
  {
    title: "Write it down",
    principle: "复盘和记录比记忆更可靠。",
    wisdom: "交易日志是把偶然经验变成可重复流程的唯一办法。",
    source: "Process discipline",
    keywords: ["journal", "record", "review", "hypothesis", "rules", "复盘", "记录", "假设", "规则", "流程"],
  },
  {
    title: "Think in probabilities",
    principle: "别问单次对不对，要问长期期望值是否为正。",
    wisdom: "投资不是预测比赛，而是概率和赔率的管理。",
    source: "Probabilistic thinking",
    keywords: ["probability", "expected value", "uncertain", "distribution", "概率", "不确定", "期望", "分布", "赔率"],
  },
];

// ── JSON loading ──

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const INSIGHTS_PATH = resolve(ROOT, ".ohquant/insights.json");

let _entries: InsightEntry[] | null = null;
let _rules: InsightRule[] | null = null;

function loadEntries(): InsightEntry[] {
  if (_entries) return _entries;

  // Auto-regenerate if source notes are newer than cached insights.json
  const jsonAge = fileMtimeMs(INSIGHTS_PATH);
  const noteAge = getNotePaths().reduce((max, p) => Math.max(max, fileMtimeMs(p)), 0);
  if (noteAge > 0 && noteAge > jsonAge) {
    try {
      const generated = generateInsights();
      if (generated.length > 0) {
        mkdirSync(resolve(INSIGHTS_PATH, ".."), { recursive: true });
        writeFileSync(INSIGHTS_PATH, JSON.stringify(generated, null, 2), "utf-8");
      }
    } catch { /* regeneration failed, fall through to cached or fallback */ }
  }

  if (existsSync(INSIGHTS_PATH)) {
    try {
      const parsed = JSON.parse(readFileSync(INSIGHTS_PATH, "utf-8"));
      if (Array.isArray(parsed) && parsed.length > 0) {
        _entries = parsed;
        return _entries;
      }
    } catch { /* fall through */ }
  }
  _entries = [];
  return _entries;
}

function fileMtimeMs(path: string): number {
  try { return statSync(path).mtimeMs; } catch { return 0; }
}

function fallbackQuotes(): InvestmentQuote[] {
  return [
    { quote: "先控制回撤和仓位，再讨论收益空间", en: "Control drawdown and position sizing before discussing returns.", author: "Risk-first principle" },
    { quote: "回测要看样本外，不要把参数优化当成 alpha", en: "Test out-of-sample. Parameter optimization is not alpha.", author: "Research discipline" },
    { quote: "市场短期是投票机，长期是称重机", en: "In the short run, the market is a voting machine. In the long run, it is a weighing machine.", author: "Benjamin Graham" },
    { quote: "不懂的东西放「太难」篮子，不要碰", en: "Put things you don't understand in the 'too hard' pile.", author: "Charlie Munger" },
    { quote: "好东西太贵了也是坏投资——安全边际", en: "A great company at a bad price is a bad investment.", author: "Margin of safety" },
    { quote: "要知道钟摆现在在哪，而不是预测它要去哪", en: "Know where the pendulum is, not where it's going.", author: "Howard Marks" },
    { quote: "组合要在四种经济环境中都能生存", en: "A portfolio must survive all four economic environments.", author: "Ray Dalio" },
    { quote: "费率 1% × 30 年 = 一套房。底仓用低费指数", en: "1% fee × 30 years = a house. Use low-cost index funds for core positions.", author: "John Bogle" },
    { quote: "不能在两分钟内说明白为什么持有 → 不持有", en: "If you can't explain why you hold it in 2 minutes, don't hold it.", author: "Peter Lynch" },
    { quote: "市场永远是对的，利润会照顾自己，亏损不会", en: "The market is always right. Profits take care of themselves, losses don't.", author: "Jesse Livermore" },
    { quote: "问自己：跌 30% 是恐慌卖出还是现金加仓？", en: "Ask yourself: at -30%, panic sell or buy more with cash?", author: "Nassim Taleb" },
    { quote: "分散不是炫技，是为避免单点失误", en: "Diversification is not for show — it's to avoid single-point failures.", author: "Portfolio construction" },
    { quote: "先活下来，再等高质量机会", en: "Survive first, then wait for high-quality opportunities.", author: "Survival bias" },
    { quote: "追求 5-10% 年化即可，不追求暴利", en: "Target 5-10% annual returns. Sustainable over spectacular.", author: "Return expectations" },
    { quote: "如果明天大盘跌 30%，你是恐慌还是兴奋？", en: "If the market drops 30% tomorrow, do you panic or get excited?", author: "Quarterly self-check" },
    { quote: "顺势可以，追价不行；信号要确认，不要想象", en: "Follow the trend, not the price. Confirm signals, don't imagine them.", author: "Trend discipline" },
  ];
}

// ── Public API ──

/** Loading-overlay quotes from the unified insight store. */
export function getQuotes(): InvestmentQuote[] {
  const entries = loadEntries();
  if (entries.length === 0) return fallbackQuotes();
  return entries.map(e => ({ quote: e.quote, en: e.en, author: e.author }));
}

/** All insight rules: built-in + extracted from notes. */
export function getInsightRules(): InsightRule[] {
  if (_rules) return _rules;
  const entries = loadEntries();
  const fromNotes: InsightRule[] = entries.map(e => ({
    title: e.title,
    principle: e.principle,
    wisdom: e.wisdom,
    source: e.source,
    keywords: e.keywords,
  }));
  _rules = [...BUILTIN_RULES, ...fromNotes];
  return _rules;
}

/** @deprecated Use getInsightRules() */
export function loadInsightSourceRules(_cwd = process.cwd()): InsightRule[] {
  return getInsightRules();
}

export function resetInsightSourceRuleCache(): void {
  _entries = null;
  _rules = null;
}

export function deriveConversationInsights(
  messages: Array<{ role?: string; text?: string; content?: unknown }>,
  limit = 2,
): ConversationInsight[] {
  const corpus = buildCorpus(messages);
  if (!corpus.trim()) return [];

  const rules = getInsightRules();
  const scored = rules
    .map(rule => ({ rule, score: scoreRule(rule, corpus) }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    return [{
      title: "Stay adaptable",
      principle: "当信息不足时，先缩小结论，再缩小仓位。",
      wisdom: "先活下来，再等高质量机会；不要为了证明观点而交易。",
      source: "General principle",
      evidence: "当前对话尚未触发强信号主题。",
    }];
  }

  const picked = scored.slice(0, Math.max(1, limit)).map(item => ({
    title: item.rule.title,
    principle: item.rule.principle,
    wisdom: item.rule.wisdom,
    source: item.rule.source,
    evidence: matchedKeywords(item.rule, corpus),
  }));

  if (picked.length === 1) {
    picked.push({
      title: "Stay adaptable",
      principle: "不确定时，先把判断和仓位都收窄。",
      wisdom: "市场总会有答案，关键是你是否还在场。",
      source: "General principle",
      evidence: "补充提醒",
    });
  }

  return picked;
}

export function formatConversationInsights(insights: ConversationInsight[]): string {
  return insights
    .map((insight, i) => [
      `${i + 1}. ${insight.title}`,
      `   Principle: ${insight.principle}`,
      `   Wisdom: ${insight.wisdom}`,
      `   Source: ${insight.source}`,
      `   Trigger: ${insight.evidence}`,
    ].join("\n"))
    .join("\n\n");
}

// ── Helpers ──

function buildCorpus(messages: Array<{ role?: string; text?: string; content?: unknown }>): string {
  const texts: string[] = [];
  for (let i = Math.max(0, messages.length - 12); i < messages.length; i++) {
    const msg = messages[i];
    if (!msg) continue;
    if (msg.role === "thinking" || msg.role === "tool" || msg.role === "error" || msg.role === "insight") continue;
    const text = extractText(msg);
    if (text.trim()) texts.push(text.trim());
  }
  return texts.join("\n").toLowerCase();
}

function extractText(message: { text?: string; content?: unknown }): string {
  if (typeof message.text === "string") return message.text;
  const content = message.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((part): part is { type: string; text?: string } => typeof part === "object" && part !== null)
      .filter(part => part.type === "text" && !!part.text)
      .map(part => part.text!)
      .join("\n");
  }
  return "";
}

function scoreRule(rule: InsightRule, corpus: string): number {
  return rule.keywords.reduce((score, kw) => score + (corpus.includes(kw.toLowerCase()) ? 2 : 0), 0);
}

function matchedKeywords(rule: InsightRule, corpus: string): string {
  const hits = rule.keywords.filter(kw => corpus.includes(kw.toLowerCase()));
  return hits.length > 0 ? hits.slice(0, 3).join(", ") : "conversation pattern";
}
