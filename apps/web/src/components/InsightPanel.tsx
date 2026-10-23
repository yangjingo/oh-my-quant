import { useState } from "react";
import type { MarketSnapshot, WorkspaceOutput } from "../contract.ts";

const TABS = ["概览", "结论", "证据", "成果"] as const;
type Tab = (typeof TABS)[number];

interface InsightPanelProps {
  readonly market: MarketSnapshot;
  readonly output: WorkspaceOutput;
}

const EMPTY = "无数据";

function formatValue(value: number | null): string {
  return value === null ? "—" : value.toFixed(2);
}

function formatChange(change: number | null): string {
  if (change === null) return EMPTY;
  const sign = change > 0 ? "+" : "";
  return `${sign}${change.toFixed(2)}%`;
}

function Section({ title, children }: { readonly title: string; readonly children: React.ReactNode }) {
  return (
    <section>
      <div className="section__head">
        <span className="section__bar" aria-hidden="true" />
        {title}
      </div>
      {children}
    </section>
  );
}

function EmptyBlock({ children }: { readonly children: React.ReactNode }) {
  return <p className="empty-block">{children}</p>;
}

export function InsightPanel({ market, output }: InsightPanelProps) {
  const [tab, setTab] = useState<Tab>("概览");
  const { source } = market;
  const unavailable = source.available === 0;
  const { conclusion, evidence, artifacts } = output;

  return (
    <aside className="panel">
      <div className="tabs" role="tablist" aria-label="研究产出">
        {TABS.map(item => (
          <button
            key={item}
            type="button"
            role="tab"
            aria-selected={item === tab}
            className="tab"
            data-active={item === tab}
            onClick={() => setTab(item)}
          >
            {item}
          </button>
        ))}
      </div>

      {tab === "概览" ? (
        <>
          <Section title="状态">
            <div className="kv">
              <span className="kv__key">行情</span>
              <span className="kv__value" data-tone={unavailable ? "empty" : undefined}>
                {unavailable ? "不可用 · 无数据" : "就绪"}
              </span>
            </div>
            <div className="kv">
              <span className="kv__key">更新</span>
              <span className="kv__value">{new Date(market.refreshedAt).toLocaleString("zh-CN")}</span>
            </div>
          </Section>

          <Section title="行情">
            {market.quotes.map(quote => (
              <div className="kv" key={quote.code}>
                <span className="kv__key">
                  {quote.code} {quote.name}
                </span>
                <span
                  className="kv__value"
                  data-tone={
                    quote.change === null
                      ? "empty"
                      : quote.change > 0
                        ? "up"
                        : quote.change < 0
                          ? "down"
                          : undefined
                  }
                >
                  {quote.change === null ? EMPTY : `${formatValue(quote.value)} ${formatChange(quote.change)}`}
                </span>
              </div>
            ))}
          </Section>

          <Section title="来源">
            <div className="kv">
              <span className="kv__key">来源</span>
              <span className="kv__value" data-tone={source.provider ? undefined : "empty"}>
                {source.provider ?? EMPTY}
              </span>
            </div>
            <div className="kv">
              <span className="kv__key">覆盖</span>
              <span className="kv__value">
                {source.available}/{source.total} 可用
              </span>
            </div>
          </Section>
        </>
      ) : null}

      {tab === "结论" ? (
        <Section title="结论">
          {conclusion.statement ? (
            <>
              <p className="prose">{conclusion.statement}</p>
              <div className="kv">
                <span className="kv__key">置信度</span>
                <span className="kv__value">{conclusion.confidence ?? "未给出"}</span>
              </div>
              <div className="kv">
                <span className="kv__key">状态</span>
                <span className="kv__value" data-tone={conclusion.settled ? undefined : "empty"}>
                  {conclusion.settled ? "已结算" : "进行中"}
                </span>
              </div>
              <p className="panel__note">边界：{conclusion.boundary ?? "未说明"}</p>
            </>
          ) : (
            <EmptyBlock>还没有结论。提交一个研究问题后，结算的结论会出现在这里。</EmptyBlock>
          )}
        </Section>
      ) : null}

      {tab === "证据" ? (
        <Section title="证据">
          {evidence.length === 0 ? (
            <EmptyBlock>没有取证记录。</EmptyBlock>
          ) : (
            evidence.map(item => (
              <div className="item" key={item.id}>
                <div className="item__head">
                  <span className="item__label">{item.label}</span>
                  <span className="item__state" data-available={item.available}>
                    {item.available ? "已取得" : "未取得"}
                  </span>
                </div>
                <div className="item__meta">
                  {item.source ?? "来源未知"} · {item.asOf ?? "日期未知"}
                </div>
              </div>
            ))
          )}
        </Section>
      ) : null}

      {tab === "成果" ? (
        <Section title="成果">
          {artifacts.length === 0 ? (
            <EmptyBlock>还没有保存的版本。完成研究后保存会写入不可变文件。</EmptyBlock>
          ) : (
            artifacts.map(item => (
              <div className="item" key={item.id}>
                <div className="item__head">
                  <span className="item__label">
                    {item.title} · v{item.version}
                  </span>
                </div>
                <div className="item__meta">
                  {new Date(item.createdAt).toLocaleString("zh-CN")} · sha256 {item.sha256.slice(0, 12)}…
                </div>
              </div>
            ))
          )}
        </Section>
      ) : null}
    </aside>
  );
}
