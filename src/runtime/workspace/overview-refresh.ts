import { loadPanelPortfolio } from "../../storage/index.ts";
import { buildOverviewPanelSections, collectOverviewSymbols, MARKET_INDICES, selectResearchPortfolio } from "./overview.ts";
import type { OverviewPortfolio } from "./overview.ts";
import { fetchOverviewQuotes, fetchOverviewHoldings, OverviewRequestPool } from "./overview-data.ts";
import type { OverviewQuoteFetcher, OverviewHoldingFetcher, OverviewRequestTiming } from "./overview-data.ts";
import type { OverviewQuote, OverviewSymbolEntry } from "./overview-data.ts";
import type { PanelSection } from "../../types/ui.ts";
import { marketUnavailablePanel } from "./panel-service.ts";
import { formatRefreshMinute } from "../../source/index.ts";
import { perfLog } from "../../perf.ts";
import { OverviewBudget } from "./overview-budget.ts";
import { DEFAULT_TERMINAL_OPERATION_KEYBINDINGS } from "../../types/config.ts";

type Outcome = "success" | "partial" | "unavailable" | "timeout" | "error" | "superseded" | "disposed";
export interface OverviewRefreshMeasurement {
  generation: number;
  outcome: Outcome;
  queuedMs: number;
  pullMs: number;
  buildMs: number | null;
  publishMs: number | null;
  totalMs: number;
  /** First current-generation panel containing a usable quote; not terminal flush latency. */
  firstResultMs: number | null;
  rows: number;
  availableRows: number;
  requests: OverviewRequestTiming[];
}
export interface OverviewRefreshOptions {
  onPanel?: (sections: PanelSection[], loading: boolean) => void;
  onMeasurement?: (measurement: OverviewRefreshMeasurement) => void | Promise<void>;
  loadPortfolio?: () => OverviewPortfolio;
  quoteFetcher?: OverviewQuoteFetcher;
  holdingFetcher?: OverviewHoldingFetcher;
  /** Injected pools must forward both signal and budget to preserve the production deadline. */
  poolFactory?: (signal: AbortSignal, budget: OverviewBudget) => OverviewRequestPool;
  timeoutMs?: number;
  intervalMs?: number;
  retryKey?: () => string | undefined;
}
interface RefreshRun {
  generation: number;
  controller: AbortController;
  promise: Promise<void>;
  startedAt: number;
  requestedAt: number;
  superseded: boolean;
  failedOnly: boolean;
}

function quoteKey(group: string, entry: OverviewSymbolEntry): string { return `${group}/${entry.instrument ?? "security"}/${entry.code}`; }

/** Owns refresh lifecycle independently of model/session operations and terminal rendering. */
export class OverviewRefresh {
  private readonly options: OverviewRefreshOptions;
  private active: RefreshRun | null = null;
  private queued: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private generation = 0;
  private disposed = false;
  private sections: PanelSection[] = [];
  private portfolioKey: string | undefined;
  private status: Outcome | "idle" | "fetching" = "idle";
  private refreshAt: string | null = null;
  private readonly lastQuotes = new Map<string, OverviewQuote>();
  private readonly failedQuotes = new Set<string>();

  constructor(options: OverviewRefreshOptions = {}) {
    const timeout = options.timeoutMs ?? 120_000;
    if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 2147483647) throw new Error("Overview timeout must be a positive timer-safe integer");
    this.options = options;
  }

  /** Background triggers share an active refresh without asking for another one. */
  start(): Promise<void> { return this.active?.promise ?? this.launch(performance.now()); }

  /** A running refresh already owns the requests; never start duplicate retries. */
  retryFailed(): Promise<void> {
    if (this.active) return this.active.promise;
    if (!this.failedQuotes.size) return Promise.resolve();
    return this.launch(performance.now(), true);
  }

  /** Explicit refresh supersedes old inputs; concurrent requests share one follow-up. */
  refresh(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (this.queued) return this.queued;
    if (!this.active) return this.launch(performance.now());
    const requestedAt = performance.now(), run = this.active;
    run.superseded = true;
    this.queued = run.promise.then(() => {
      this.queued = null;
      return this.launch(requestedAt);
    });
    run.controller.abort(new Error("Overview inputs superseded"));
    return this.queued;
  }

  render(): void {
    if (this.disposed) return;
    const retryKey = this.options.retryKey ? this.options.retryKey() : DEFAULT_TERMINAL_OPERATION_KEYBINDINGS.retryFailedQuotes[0];
    const panel = structuredClone(this.sections.length ? this.sections : marketUnavailablePanel());
    panel[0]!.refresh = {
      at: this.refreshAt,
      status: this.status === "superseded" || this.status === "disposed" ? "idle" : this.status,
      ...(this.failedQuotes.size && retryKey ? { retryKey } : {}),
    };
    this.options.onPanel?.(panel, this.status === "fetching" || this.status === "idle");
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.active?.controller.abort(new Error("Overview disposed"));
  }

  private launch(requestedAt: number, failedOnly = false): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (this.active) return this.active.promise;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    let finish!: () => void;
    const promise = new Promise<void>(resolve => { finish = resolve; });
    const run: RefreshRun = { generation: ++this.generation, controller: new AbortController(), promise,
      startedAt: performance.now(), requestedAt, superseded: false, failedOnly };
    this.refreshAt = formatRefreshMinute(new Date());
    this.active = run;
    void this.perform(run).catch(() => {}).finally(() => {
      if (this.active === run) this.active = null;
      const interval = this.options.intervalMs ?? 60_000;
      if (!this.disposed && !this.queued && interval > 0) {
        this.timer = setTimeout(() => { void this.start(); }, interval);
        this.timer.unref();
      }
      finish();
    });
    return promise;
  }

  private async perform(run: RefreshRun): Promise<void> {
    const { signal } = run.controller;
    let pool: OverviewRequestPool | undefined, onAbort: (() => void) | undefined;
    let outcome: Outcome = "error", rows = 0, availableRows = 0;
    let pullMs = 0, buildMs: number | null = null, publishMs: number | null = null;
    let firstResultMs: number | null = null;
    let progressTimer: ReturnType<typeof setTimeout> | undefined;
    let publishPartial: (() => boolean) | undefined;
    const budget = new OverviewBudget(run.controller, run.startedAt, this.options.timeoutMs ?? 120_000);
    try {
      const portfolio = selectResearchPortfolio((this.options.loadPortfolio ?? loadPanelPortfolio)());
      const portfolioKey = JSON.stringify([portfolio.groups, portfolio.symbols]);
      if (this.portfolioKey !== undefined && this.portfolioKey !== portfolioKey) {
        this.sections = buildOverviewPanelSections({ portfolio, marketQuotes: [], portfolioRows: [], pullMeta: { sources: [], asOfDates: [] } });
      }
      this.portfolioKey = portfolioKey;
      this.status = "fetching"; this.render();
      signal.throwIfAborted();
      const portfolioSymbols = collectOverviewSymbols(portfolio);
      const validKeys = new Set([...MARKET_INDICES.map(entry => quoteKey("market", entry)), ...portfolioSymbols.map(entry => quoteKey("portfolio", entry))]);
      for (const key of this.lastQuotes.keys()) if (!validKeys.has(key)) this.lastQuotes.delete(key);
      for (const key of this.failedQuotes) if (!validKeys.has(key)) this.failedQuotes.delete(key);
      const retryKeys = new Set(this.failedQuotes);
      const selected = (group: string, entry: OverviewSymbolEntry) => !run.failedOnly || retryKeys.has(quoteKey(group, entry));
      const seed = (group: string, entry: OverviewSymbolEntry): OverviewQuote => {
        const previous = this.lastQuotes.get(quoteKey(group, entry));
        return previous ? { ...structuredClone(previous), name: entry.name, ...(selected(group, entry) ? { refreshState: "refreshing" as const } : {}) }
          : { ...entry, price: Number.NaN, pct: Number.NaN };
      };
      budget.check();
      pool = this.options.poolFactory?.(signal, budget) ?? new OverviewRequestPool({ signal, budget });
      const meta = { sources: [], asOfDates: [], signal, pool };
      const marketQuotes = MARKET_INDICES.map(entry => seed("market", entry));
      const portfolioRows = portfolioSymbols.map(entry => seed("portfolio", entry));
      const settled = new Set<string>();
      let publishQueued = false, publishedProgress = false;
      const publish = () => {
        if (this.disposed || this.active !== run || run.superseded || (signal.aborted && this.status === "fetching")) return;
        if (this.status === "fetching") budget.check();
        const all = [...marketQuotes, ...portfolioRows];
        rows = all.length;
        availableRows = all.filter(row => !row.refreshState && Number.isFinite(row.price) && Number.isFinite(row.pct)).length;
        const began = performance.now();
        this.sections = buildOverviewPanelSections({ portfolio, portfolioSymbols, marketQuotes, portfolioRows, pullMeta: meta, refreshedAt: new Date() });
        buildMs = (buildMs ?? 0) + performance.now() - began;
        const publishStarted = performance.now();
        this.render(); publishMs = (publishMs ?? 0) + performance.now() - publishStarted;
        const hasCurrentResult = ([["market", marketQuotes], ["portfolio", portfolioRows]] as const)
          .some(([group, quotes]) => quotes.some((row, index) => settled.has(`${group}/${index}`)
            && !row.refreshState && Number.isFinite(row.price) && Number.isFinite(row.pct)));
        if (hasCurrentResult && firstResultMs === null) firstResultMs = performance.now() - run.startedAt;
      };
      publishPartial = () => {
        for (const [entries, target, group] of [[MARKET_INDICES, marketQuotes, "market"], [portfolioSymbols, portfolioRows, "portfolio"]] as const) {
          for (const [index, entry] of entries.entries()) if (selected(group, entry) && !settled.has(`${group}/${index}`)) {
            const key = quoteKey(group, entry);
            this.failedQuotes.add(key);
            const previous = this.lastQuotes.get(key);
            if (previous) target[index] = { ...structuredClone(previous), name: entry.name, refreshState: "stale" };
          }
        }
        if (!settled.size && !this.lastQuotes.size) return false;
        publish(); return true;
      };
      const flushProgress = () => {
        publishQueued = false; publishedProgress = true; progressTimer = undefined;
        try { if (this.status === "fetching") publish(); }
        catch { run.controller.abort(new Error("Overview progress publication failed")); }
      };
      const acceptRow = (entries: OverviewSymbolEntry[], target: OverviewQuote[], group: string, row: OverviewQuote, index: number) => {
        if (this.disposed || this.active !== run || run.superseded || signal.aborted || this.status !== "fetching") return;
        budget.check();
        if (!Number.isInteger(index) || index < 0 || index >= target.length || row.code !== target[index]!.code) return;
        if (!selected(group, entries[index]!)) return;
        const key = quoteKey(group, entries[index]!);
        if (Number.isFinite(row.price) && Number.isFinite(row.pct)) {
          const current = structuredClone(row); delete current.refreshState;
          target[index] = current; this.lastQuotes.set(key, structuredClone(current)); this.failedQuotes.delete(key);
        } else {
          this.failedQuotes.add(key);
          const previous = this.lastQuotes.get(key);
          target[index] = previous ? { ...structuredClone(previous), name: entries[index]!.name, refreshState: "stale" } : structuredClone(row);
        }
        settled.add(`${group}/${index}`);
        // Show the first result promptly, then coalesce bursts to at most one update per 16 ms.
        if (!publishQueued) {
          publishQueued = true;
          if (publishedProgress) progressTimer = setTimeout(flushProgress, 16);
          else queueMicrotask(flushProgress);
        }
      };
      const fetchSelected = (entries: OverviewSymbolEntry[], target: OverviewQuote[], group: string, fetcher: OverviewQuoteFetcher) => {
        const indexes = entries.flatMap((entry, index) => selected(group, entry) ? [index] : []);
        if (!indexes.length) return Promise.resolve([]);
        return fetcher(indexes.map(index => entries[index]!), { ...meta,
          onRow: (row, index) => { if (indexes[index] !== undefined) acceptRow(entries, target, group, row, indexes[index]!); } });
      };
      if (this.lastQuotes.size) publish();
      const data = Promise.all([
        fetchSelected(MARKET_INDICES, marketQuotes, "market", this.options.quoteFetcher ?? fetchOverviewQuotes),
        fetchSelected(portfolioSymbols, portfolioRows, "portfolio", this.options.holdingFetcher ?? fetchOverviewHoldings),
      ]);
      const completed = await Promise.race([data, new Promise<never>((_, reject) => {
        onAbort = () => reject(signal.reason);
        if (signal.aborted) onAbort(); else signal.addEventListener("abort", onAbort, { once: true });
      })]);
      pullMs = performance.now() - run.startedAt;
      budget.check();
      for (const [entries, target, group, returned] of [
        [MARKET_INDICES, marketQuotes, "market", completed[0]], [portfolioSymbols, portfolioRows, "portfolio", completed[1]],
      ] as const) {
        for (const row of returned) {
          const index = entries.findIndex(entry => entry.code === row.code);
          if (index >= 0) acceptRow(entries, target, group, row, index);
        }
        for (const [index, entry] of entries.entries()) if (selected(group, entry) && !settled.has(`${group}/${index}`)) {
          acceptRow(entries, target, group, { ...entry, price: Number.NaN, pct: Number.NaN }, index);
        }
      }
      const all = [...marketQuotes, ...portfolioRows];
      rows = all.length;
      availableRows = all.filter(row => !row.refreshState && Number.isFinite(row.price) && Number.isFinite(row.pct)).length;
      outcome = !availableRows ? "unavailable" : availableRows < rows || all.some(row => row.observation?.state === "outside-window") ? "partial" : "success";
      if (!this.disposed && this.active === run && !run.superseded) {
        this.status = outcome; publish();
      }
    } catch {
      pullMs = performance.now() - run.startedAt;
      outcome = this.disposed ? "disposed" : run.superseded ? "superseded" : budget.timedOut ? "timeout" : "error";
      run.controller.abort(new Error("Overview refresh ended"));
      if (!this.disposed && this.active === run && !run.superseded) {
        this.status = outcome;
        if (!publishPartial?.()) {
          this.sections = this.sections.map(section => {
            if (section.kind === "quotes" || section.kind === "holdings" || section.kind === "group") {
              return { ...section, rows: section.rows.map(row => Number.isFinite(row.price) && Number.isFinite(row.pct)
                ? { ...row, refreshState: "stale" as const } : row) };
            }
            return section;
          });
          for (const key of this.lastQuotes.keys()) this.failedQuotes.add(key);
          const publishStarted = performance.now();
          this.render(); publishMs = (publishMs ?? 0) + performance.now() - publishStarted;
        }
      }
    } finally {
      budget.close();
      if (progressTimer) clearTimeout(progressTimer);
      if (onAbort) signal.removeEventListener("abort", onAbort);
      pool?.close();
      const measurement: OverviewRefreshMeasurement = { generation: run.generation, outcome,
        queuedMs: run.startedAt - run.requestedAt, pullMs, buildMs, publishMs,
        totalMs: performance.now() - run.startedAt, firstResultMs, rows, availableRows, requests: pool?.timings() ?? [] };
      perfLog("runtime.market.refresh", run.startedAt, { generation: run.generation, outcome, rows, availableRows,
        uniqueRequests: measurement.requests.length, pullMs, buildMs, publishMs });
      if (!this.disposed) {
        try { Promise.resolve(this.options.onMeasurement?.(structuredClone(measurement))).catch(() => {}); } catch { /* Diagnostics do not own refresh success. */ }
      }
    }
  }
}
