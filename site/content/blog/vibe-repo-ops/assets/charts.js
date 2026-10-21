// Frozen article evidence, not live telemetry. Sources are cited beside each chart in Markdown.
export const audit = { date: "2026-10-17", runs: 61, attempts: 62, counts: [35, 18, 8] };
export const rsiCases = {
  reversal: { close: [10, 11, 12, 11, 10], correct: [null, null, 100, 50, 25], legacy: [null, null, 100, 100, 50] },
  uptrend: { close: [10, 11, 12, 13, 14], correct: [null, null, 100, 100, 100], legacy: [null, null, 100, 100, 100] },
};
const series = [
  { name: "Legacy", key: "legacy", color: "var(--ink)", dash: "6 5" },
  { name: "Correct", key: "correct", color: "var(--gold)", dash: "" },
];
const statuses = ["Success", "Failure", "Cancelled"];
const text = (x, y, label, anchor = "middle") => `<text x="${x}" y="${y}" text-anchor="${anchor}" fill="var(--muted)" font-size="12">${label}</text>`;
const defaultState = () => ({ enabled: [true, true], sample: "reversal", scope: "all", metric: "count" });

export function chartSvg(kind, width = 680, state = defaultState(), interactive = false) {
  const left = 40, right = width - 18, top = 36, bottom = 252, height = 312;
  const max = kind === "line" || state.metric === "share" ? 100 : 40;
  const y = value => bottom - value / max * (bottom - top);
  let content = text(left, 17, kind === "line" ? "RSI (period 2)" : state.metric === "share" ? "Share (%)" : "Runs", "start");
  for (let i = 0; i <= 4; i++) {
    const value = max * i / 4;
    content += `<path d="M${left} ${y(value)}H${right}" stroke="var(--hairline)"/>${text(left - 9, y(value) + 4, value, "end")}`;
  }
  if (kind === "line") {
    const sample = rsiCases[state.sample];
    const x = index => left + 8 + index * (right - left - 16) / 4;
    content += `<rect x="${left}" y="${top}" width="${x(1) - left + 12}" height="${bottom - top}" fill="var(--muted)" fill-opacity=".08"/>${text((left + x(1)) / 2, top + 26, "Warm-up")}`;
    sample.close.forEach((price, i) => { content += text(x(i), bottom + 24, `T${i + 1}`) + text(x(i), bottom + 45, price); });
    series.forEach((item, s) => {
      if (!state.enabled[s]) return;
      const values = sample[item.key];
      content += `<polyline points="${values.flatMap((value, i) => value === null ? [] : [`${x(i)},${y(value)}`]).join(" ")}" fill="none" stroke="${item.color}" stroke-width="2.5" stroke-dasharray="${item.dash}"/>`;
      values.forEach((value, i) => {
        if (value === null) return; // Warm-up is missing, not RSI zero.
        const label = `${item.name} · T${i + 1} · Close ${sample.close[i]} · RSI ${value}`;
        content += `<g class="chart-point" tabindex="0" role="button" aria-label="${label}" data-value="${label}"><circle cx="${x(i)}" cy="${y(value)}" r="18" fill="transparent"/><circle class="point-mark" cx="${x(i)}" cy="${y(value)}" r="${s === 0 ? 7 : 3.5}" fill="var(--canvas)" stroke="${item.color}" stroke-width="2.5"/></g>`;
      });
    });
  } else {
    const indices = state.scope === "completed" ? [0, 1] : [0, 1, 2];
    const denominator = indices.reduce((sum, i) => sum + audit.counts[i], 0);
    const group = (right - left) / indices.length, barWidth = Math.min(78, group * .5);
    indices.forEach((index, position) => {
      const center = left + (position + .5) * group;
      const count = audit.counts[index], share = count / denominator * 100;
      const value = state.metric === "share" ? share : count;
      const label = `${statuses[index]} · ${count} / ${denominator} runs · ${share.toFixed(1)}%`;
      content += text(center, bottom + 25, statuses[index]);
      content += `<g class="chart-point" tabindex="0" role="button" aria-label="${label}" data-value="${label}"><rect x="${center - barWidth / 2}" y="${top}" width="${barWidth}" height="${bottom - top}" fill="transparent"/><rect class="bar-mark" x="${center - barWidth / 2}" y="${y(value)}" width="${barWidth}" height="${bottom - y(value)}" rx="2" fill="${index === 1 ? 'var(--gold)' : 'var(--ink)'}" fill-opacity="${index === 2 ? '.35' : index === 0 ? '.6' : '1'}"/>${text(center, y(value) - 8, state.metric === "share" ? `${share.toFixed(1)}%` : count)}</g>`;
    });
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" font-family="Arial,Helvetica,sans-serif" role="${interactive ? 'group' : 'img'}" aria-label="${kind === 'line' ? 'RSI regression counterexample; warm-up values are unavailable' : 'Actions final run outcomes; frozen on 2026-10-17'}" xml:lang="en">${interactive ? content : content.replaceAll(' tabindex="0" role="button"', '')}</svg>`;
}

function summary(kind, state) {
  if (kind === "bar") return state.scope === "completed"
    ? "53 non-cancelled runs · 8 cancellations excluded · Failure 18 / 53 = 34.0%"
    : "61 runs · 62 attempts · Failure 18 / 61 = 29.5% · Final run outcomes only";
  return state.sample === "reversal"
    ? "T4 / T5: Correct 50 / 25 · Legacy 100 / 50 · Turn exposes the bug"
    : "T3–T5: both 100 · Uptrend control does not distinguish the bug";
}

function values(kind, state) {
  if (kind === "bar") return `<dl>${statuses.map((status, i) => `<div><dt>${status}</dt><dd>${audit.counts[i]} runs / 61 · ${(audit.counts[i] / 61 * 100).toFixed(1)}%</dd></div>`).join("")}<div><dt>Counting unit</dt><dd>61 runs · 62 attempts · Frozen ${audit.date}</dd></div></dl>`;
  const sample = rsiCases[state.sample];
  return `<dl>${sample.close.map((close, i) => `<div><dt>T${i + 1} · Close ${close}</dt><dd>Legacy ${sample.legacy[i] ?? 'N/A'} · Correct ${sample.correct[i] ?? 'N/A'}</dd></div>`).join("")}</dl>`;
}

export function chartCard(kind, caption, icon) {
  const state = defaultState();
  const controls = kind === "line"
    ? `${series.map((item, i) => `<label class="series-${i}"><input type="checkbox" data-series="${i}" checked><span class="legend-mark" aria-hidden="true"></span>${item.name}</label>`).join("")}<label>Input <select data-sample aria-label="Price sample"><option value="reversal">Reversal</option><option value="uptrend">Uptrend control</option></select></label>`
    : '<label>Scope <select data-scope aria-label="Run denominator"><option value="all">All 61 runs</option><option value="completed">53 non-cancelled runs</option></select></label><label>Measure <select data-metric aria-label="Count or share"><option value="count">Count</option><option value="share">Share (%)</option></select></label>';
  return `<figure class="chart-card" id="chart-${kind}" data-chart="${kind}"><div class="chart-inner" lang="en"><div class="chart-heading"><div><p class="chart-title">${kind === 'line' ? 'A turn exposes the RSI bug' : 'Actions outcomes'}</p><p class="chart-state">${kind === 'line' ? 'Reversal · Period 2 · Both series' : '2026-10-17 · All 61 runs · Count'}</p></div><details class="chart-settings" hidden><summary class="quiet-icon" aria-label="Chart settings" title="Chart settings">${icon('settings-2')}</summary><div class="chart-controls">${controls}<button class="text-action" type="button" data-chart-reset>Reset</button></div></details></div><div class="chart-plot">${chartSvg(kind)}</div>${kind === 'line' ? '<p class="chart-legend"><span class="series-0"><i class="legend-mark" aria-hidden="true"></i>Legacy</span><span class="series-1"><i class="legend-mark" aria-hidden="true"></i>Correct</span><span>Bottom labels: close prices · Warm-up: N/A</span></p>' : ''}<output class="chart-readout" aria-live="polite">${summary(kind, state)}</output></div><figcaption>${caption}</figcaption><details class="chart-data"><summary>Source data</summary><div class="chart-values" lang="en">${values(kind, state)}</div></details></figure>`;

}

if (typeof document !== "undefined") {
  document.querySelectorAll("[data-chart]").forEach(card => {
    const kind = card.dataset.chart, controls = card.querySelector(".chart-controls"), plot = card.querySelector(".chart-plot");
    const toggles = [...controls.querySelectorAll("[data-series]")], readout = card.querySelector("output");
    let previousWidth, printing = false;
    function state() { return { enabled: toggles.length ? toggles.map(t => t.checked) : [true, true], sample: controls.querySelector('[data-sample]')?.value ?? 'reversal', scope: controls.querySelector('[data-scope]')?.value ?? 'all', metric: controls.querySelector('[data-metric]')?.value ?? 'count' }; }
    function render() {
      const current = printing ? defaultState() : state(), width = Math.max(240, Math.round(plot.clientWidth));
      previousWidth = width;
      plot.innerHTML = chartSvg(kind, width, current, !printing);
      toggles.forEach(toggle => { toggle.disabled = toggle.checked && current.enabled.filter(Boolean).length === 1; });
      readout.textContent = summary(kind, current);
      card.querySelector('.chart-state').textContent = kind === 'line'
        ? `${current.sample === 'reversal' ? 'Reversal' : 'Uptrend control'} · Period 2 · ${current.enabled.every(Boolean) ? 'Both series' : current.enabled[0] ? 'Legacy only' : 'Correct only'}`
        : `2026-10-17 · ${current.scope === 'all' ? 'All 61 runs' : '53 non-cancelled runs'} · ${current.metric === 'count' ? 'Count' : 'Share (%)'}`;
      card.querySelectorAll('.chart-legend .series-0, .chart-legend .series-1').forEach((label, i) => { label.classList.toggle('series-hidden', !current.enabled[i]); });
      card.querySelector('.chart-values').innerHTML = values(kind, current);
    }
    function showValue(event) {
      const mark = event.target.closest("[data-value]");
      if (!mark) return;
      readout.textContent = mark.dataset.value;
      plot.querySelectorAll('.is-selected').forEach(node => node.classList.remove('is-selected')); mark.classList.add('is-selected');
    }
    ['pointerover', 'focusin', 'click'].forEach(event => plot.addEventListener(event, showValue));
    plot.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); showValue(event); } });
    controls.addEventListener('change', render);
    controls.querySelector('[data-chart-reset]').addEventListener('click', () => { toggles.forEach(t => { t.checked = true; }); controls.querySelectorAll('select').forEach(s => { s.selectedIndex = 0; }); render(); });
    new ResizeObserver(() => { if (Math.round(plot.clientWidth) !== previousWidth) render(); }).observe(plot);
    const settings = card.querySelector('.chart-settings');
    settings.hidden = false;
    settings.addEventListener('keydown', event => { if (event.key === 'Escape') { settings.open = false; settings.querySelector('summary').focus(); } });
    document.addEventListener('click', event => { if (!settings.contains(event.target)) settings.open = false; });
    render();
    window.addEventListener('beforeprint', () => { printing = true; render(); });
    window.addEventListener('afterprint', () => { printing = false; render(); });
  });
}
