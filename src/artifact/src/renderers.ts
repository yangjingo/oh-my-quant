/**
 * ECharts + HTML rendering — chart script generation, table rendering, highlighting.
 * Pure functions: produce HTML strings, no side effects.
 */
import { esc } from "./template.ts";
import type { KlineData, FactorBar, FactorSeries, Card, ScoreTable } from "./types.ts";
import type { NavLineData } from "./detectors.ts";
import { WHYJ_THEME } from "../../types/theme-colors.ts";
import { displayedMovement, displayedNumber, movementTone } from "../../types/metric-semantics.ts";
import { metricValueClass, tableValueClass } from "./semantic-colors.ts";

const INDICATOR_GLOSSARY = "<details class=\"ind-glossary\"><summary>指标说明</summary><div class=\"ig-body\"><div class=\"ig-item\"><span class=\"ig-name\">K线</span><span class=\"ig-desc\">蜡烛图, 显示开/收/高/低价, 收盘高于开盘为涨、低于为跌、相等为平；颜色约定见报告顶部</span></div><div class=\"ig-item\"><span class=\"ig-name\">MA5(5日均)</span><span class=\"ig-desc\">5日移动平均线, 反映超短期价格趋势</span></div><div class=\"ig-item\"><span class=\"ig-name\">MA10(10日均)</span><span class=\"ig-desc\">10日移动平均线, 短期趋势参考</span></div><div class=\"ig-item\"><span class=\"ig-name\">MA20(20日均)</span><span class=\"ig-desc\">20日移动平均线, 中期趋势生命线</span></div><div class=\"ig-item\"><span class=\"ig-name\">MA60(60日均)</span><span class=\"ig-desc\">60日移动平均线, 长期趋势, 牛熊分界线</span></div><div class=\"ig-item\"><span class=\"ig-name\">DIF(快线)</span><span class=\"ig-desc\">差离值 = EMA12 - EMA26, 反映短期动量</span></div><div class=\"ig-item\"><span class=\"ig-name\">DEA(慢线)</span><span class=\"ig-desc\">信号线 = DIF的9日EMA, DIF上穿DEA为金叉看涨</span></div><div class=\"ig-item\"><span class=\"ig-name\">MACD(柱线)</span><span class=\"ig-desc\">(DIF-DEA)*2, 正柱与负柱表示动量方向，零值为中性, 长短反映动能强弱</span></div><div class=\"ig-item\"><span class=\"ig-name\">Vol</span><span class=\"ig-desc\">成交量, 放量上涨确认趋势, 缩量上涨警惕背离</span></div></div></details>";

// ── ECharts K-line render (multi-timeframe with tabs) ──

export function computeKlineSeries(kl: KlineData) {
  const dates = kl.rows.map((r) => r.date.slice(-10));
  const ohlc = kl.rows.map((r) => [r.open, r.close, r.low, r.high]);
  const closes = kl.rows.map((r) => r.close);
  const vols = kl.rows.map((r) => r.vol ?? 0);
  const hasVol = vols.some((v) => v > 0);

  function calcMA(n: number): (number|null)[] {
    const r: (number|null)[] = [];
    for (let i = 0; i < closes.length; i++) {
      if (i < n - 1) { r.push(null); continue; }
      let sum = 0; for (let j = i - n + 1; j <= i; j++) sum += closes[j]!;
      r.push(+(sum / n).toFixed(2));
    }
    return r;
  }
  const ma5 = calcMA(5), ma10 = calcMA(10), ma20 = calcMA(20), ma60 = calcMA(60);

  // MACD
  let e12 = closes[0]!, e26 = closes[0]!;
  const dif: (number|null)[] = new Array(closes.length).fill(null);
  const dea: (number|null)[] = new Array(closes.length).fill(null);
  const macd: (number|null)[] = new Array(closes.length).fill(null);
  for (let i = 0; i < closes.length; i++) {
    const c = closes[i]!;
    e12 = c * (2 / 13) + e12 * (1 - 2 / 13);
    e26 = c * (2 / 27) + e26 * (1 - 2 / 27);
    dif[i] = +(e12 - e26).toFixed(4);
  }
  let eDea = dif.find((v) => v !== null) ?? 0;
  for (let i = 0; i < closes.length; i++) {
    if (dif[i] === null) continue;
    eDea = dif[i]! * (2 / 10) + eDea * (1 - 2 / 10);
    dea[i] = +eDea.toFixed(4);
    macd[i] = +((dif[i]! - eDea) * 2).toFixed(4);
  }

  return { dates, ohlc, closes, vols, hasVol, ma5, ma10, ma20, ma60, dif, dea, macd };
}

export function renderEchartsKline(kls: KlineData[]): string {
  // Compute all timeframe data
  const tfData: Record<string, ReturnType<typeof computeKlineSeries>> = {};
  const tfLabels: string[] = [];
  for (const kl of kls) {
    const tf = kl.timeframe || "日K";
    tfData[tf] = computeKlineSeries(kl);
    tfLabels.push(tf);
  }
  // Sort: 日K, 周K, 月K, 年K
  const order: Record<string, number> = { "日K": 0, "周K": 1, "月K": 2, "季K": 3, "年K": 4 };
  tfLabels.sort((a, b) => (order[a] ?? 99) - (order[b] ?? 99));
  const defaultTf = tfLabels[0] || "日K";

  // Benchmark from first kline (optional)
  const bm = (kls[0] as KlineData & { bm?: { label: string; closes: number[] }; bm2?: { label: string; closes: number[] } }).bm;
  const bm2 = (kls[0] as KlineData & { bm?: { label: string; closes: number[] }; bm2?: { label: string; closes: number[] } }).bm2;

  const id = `kl${Math.random().toString(36).slice(2,6)}`;
  const firstKl = kls[0]!;
  const rawText = esc(firstKl.header.join("  ") + "\n" + firstKl.rows.map((r) => `${r.date}  ${r.open}  ${r.high}  ${r.low}  ${r.close}` + (r.vol ? `  ${r.vol}` : "")).join("\n"));
  const json = JSON.stringify(tfData);
  const bmJson = bm ? JSON.stringify(bm) : "null";
  const bm2Json = bm2 ? JSON.stringify(bm2) : "null";

  const tabsHtml = tfLabels.map((tf, i) =>
    `<button class="klt-btn${i === 0 ? " on" : ""}" data-tf="${esc(tf)}">${esc(tf)}</button>`
  ).join("");
  const firstSeries = tfData[defaultTf] ?? computeKlineSeries(firstKl);
  const kpisHtml = renderKlineKpis(firstKl, firstSeries);
  const fallbackSvg = renderStaticKlineSvg(firstKl, firstSeries);

  return `<div class="ec-box">
    <div class="ec-hdr"><span>K-line (${firstKl.rows.length})</span>
      <span class="klt-tabs">${tabsHtml}</span>
      <span class="tgl"><button class="tgl-btn on" onclick="toggleView(this,'chart')">Chart</button><button class="tgl-btn" onclick="toggleView(this,'raw')">Raw</button></span>
    </div>
    ${kpisHtml}
    <div class="ec-body"><div id="${id}" class="kline-stage" role="region" aria-label="${esc(firstKl.timeframe || "日K")} K线图" tabindex="0">${fallbackSvg}</div></div>
    <div class="ec-raw"><pre>${rawText}</pre></div>
    ${INDICATOR_GLOSSARY}
  </div>
  <script>(function(){var d=document.getElementById('${id}');if(!d||typeof echarts==='undefined')return;d.innerHTML='';var tfData=${json};var bm=${bmJson};var bm2=${bm2Json};var curTf='${esc(defaultTf)}';var ch=echarts.init(d,'dark');var css=getComputedStyle(d);var up=css.getPropertyValue('--up').trim()||'${WHYJ_THEME.marketUp}',dn=css.getPropertyValue('--down').trim()||'${WHYJ_THEME.marketDown}',gold='${WHYJ_THEME.gold}',cream='${WHYJ_THEME.cream}',muted='${WHYJ_THEME.muted}',hairline='${WHYJ_THEME.hairline}',canvas='${WHYJ_THEME.canvas}';
	function buildOption(c){
	  var ohlcData=c.ohlc.map(function(d){return d[0]===d[1]?{value:d,itemStyle:{color:muted,color0:muted,borderColor:muted,borderColor0:muted}}:d});
	  var legendData=['K线','MA5(5日均)','MA10(10日均)','MA20(20日均)','MA60(60日均)','DIF(快线)','DEA(慢线)','MACD(柱线)'];
	  var series=[
	    {name:'K线',type:'candlestick',xAxisIndex:0,yAxisIndex:0,data:ohlcData,itemStyle:{color:up,color0:dn,borderColor:up,borderColor0:dn}},
	    {name:'MA5(5日均)',type:'line',xAxisIndex:0,yAxisIndex:0,data:c.ma5,smooth:true,lineStyle:{color:cream,width:1},symbol:'none',connectNulls:false},
	    {name:'MA10(10日均)',type:'line',xAxisIndex:0,yAxisIndex:0,data:c.ma10,smooth:true,lineStyle:{color:gold,width:1},symbol:'none',connectNulls:false},
	    {name:'MA20(20日均)',type:'line',xAxisIndex:0,yAxisIndex:0,data:c.ma20,smooth:true,lineStyle:{color:muted,width:1.2,type:'dashed'},symbol:'none',connectNulls:false},
	    {name:'MA60(60日均)',type:'line',xAxisIndex:0,yAxisIndex:0,data:c.ma60,smooth:true,lineStyle:{color:gold,width:1,type:'dotted'},symbol:'none',connectNulls:false},
	    {name:'DIF(快线)',type:'line',xAxisIndex:1,yAxisIndex:1,data:c.dif,smooth:true,lineStyle:{color:cream,width:1},symbol:'none',connectNulls:false},
	    {name:'DEA(慢线)',type:'line',xAxisIndex:1,yAxisIndex:1,data:c.dea,smooth:true,lineStyle:{color:gold,width:1},symbol:'none',connectNulls:false},
	    {name:'MACD(柱线)',type:'bar',xAxisIndex:1,yAxisIndex:1,data:c.macd.map(function(v,i){if(v===null)return'-';return{value:v,itemStyle:{color:v===0?muted:v>0?up:dn}}})}
	  ];
	  if(bm){legendData.push(bm.label);series.push({name:bm.label,type:'line',xAxisIndex:0,yAxisIndex:0,data:bm.closes,smooth:true,lineStyle:{color:'#FFF3C4',width:2},symbol:'none',emphasis:{focus:'series',lineStyle:{width:3}},z:2,label:{show:true,position:'right',fontSize:8,color:'#FFF3C4',formatter:function(p){return p.dataIndex===p.data.length-1?bm.label:''}}});} if(bm2){legendData.push(bm2.label);series.push({name:bm2.label,type:'line',xAxisIndex:0,yAxisIndex:0,data:bm2.closes,smooth:true,lineStyle:{color:'#5B9BD5',width:2},symbol:'none',emphasis:{focus:'series',lineStyle:{width:3}},z:2,label:{show:true,position:'right',fontSize:8,color:'#5B9BD5',formatter:function(p){return p.dataIndex===p.data.length-1?bm2.label:''}}});}
	  if(c.hasVol){series.push({name:'Vol',type:'bar',xAxisIndex:2,yAxisIndex:2,data:c.vols.map(function(v,i){return{value:v,itemStyle:{color:!c.ohlc[i]||c.ohlc[i][1]===c.ohlc[i][0]?muted:c.ohlc[i][1]>c.ohlc[i][0]?up:dn}}}),barWidth:'60%'});}
	  return {animation:true,backgroundColor:'transparent',textStyle:{color:cream,fontFamily:'Cascadia Code,monospace'},tooltip:{trigger:'axis',backgroundColor:canvas,borderColor:hairline,textStyle:{color:cream},axisPointer:{type:'cross',lineStyle:{color:gold},crossStyle:{color:gold}}},legend:{data:legendData,bottom:0,textStyle:{fontSize:9,color:muted}},grid:[{left:'8%',right:'2%',top:'3%',height:'38%'},{left:'8%',right:'2%',top:'46%',height:'20%'},{left:'8%',right:'2%',top:'70%',height:'12%'}],xAxis:[{data:c.dates,gridIndex:0,axisLabel:{fontSize:9,color:muted},axisLine:{lineStyle:{color:hairline}}},{data:c.dates,gridIndex:1,axisLabel:{show:false},axisLine:{lineStyle:{color:hairline}},axisTick:{show:false}},{data:c.dates,gridIndex:2,axisLabel:{show:false},axisLine:{lineStyle:{color:hairline}},axisTick:{show:false}}],yAxis:[{gridIndex:0,scale:true,axisLabel:{fontSize:9,color:muted},splitLine:{lineStyle:{color:hairline,type:'dashed'}}},{gridIndex:1,axisLabel:{fontSize:8,color:muted},splitLine:{lineStyle:{color:hairline,type:'dashed'}}},{gridIndex:2,axisLabel:{fontSize:8,color:muted},splitLine:{show:false}}],dataZoom:[{type:'slider',xAxisIndex:[0,1,2],start:0,end:100,height:14,bottom:2,borderColor:hairline,backgroundColor:canvas,fillerColor:'rgba(201,154,46,0.12)',handleStyle:{color:gold},textStyle:{fontSize:8,color:muted}},{type:'inside',xAxisIndex:[0,1,2]}],series:series};
	}
	ch.setOption(buildOption(tfData[curTf]||tfData['日K']));
	// Timeframe tab switching
	var box=d.parentElement.parentElement;
	if(box){box.querySelectorAll('.klt-btn').forEach(function(b){b.addEventListener('click',function(){var tf=b.getAttribute('data-tf');if(!tf||tf===curTf)return;curTf=tf;box.querySelectorAll('.klt-btn').forEach(function(x){x.classList.remove('on');});b.classList.add('on');ch.setOption(buildOption(tfData[tf]||tfData['日K']),true);});});}
	window.addEventListener('resize',function(){ch.resize();});})();</script>`;
}

function renderKlineKpis(kl: KlineData, series: ReturnType<typeof computeKlineSeries>): string {
  const last = kl.rows.at(-1)!;
  const previous = kl.rows.at(-2);
  const change = displayedMovement(previous && previous.close !== 0 ? (last.close - previous.close) / previous.close * 100 : null);
  const rangeHigh = Math.max(...kl.rows.map((row) => row.high));
  const rangeLow = Math.min(...kl.rows.map((row) => row.low));
  const ma5 = lastNumber(series.ma5);
  const ma20 = lastNumber(series.ma20);
  const macd = lastNumber(series.macd);
  const cards = [
    ["最新价", formatPrice(last.close), change.tone],
    ["涨跌幅", change.text, change.tone],
    ["区间高点", formatPrice(rangeHigh), "neutral"],
    ["区间低点", formatPrice(rangeLow), "neutral"],
    ["MA5", ma5 === null ? "—" : formatPrice(ma5), ma5 === null ? "neutral" : "gold"],
    ["MA20", ma20 === null ? "—" : formatPrice(ma20), "neutral"],
    ["MACD", macd === null ? "—" : macd.toFixed(2), movementTone(macd === null ? null : Number(macd.toFixed(2)))],
  ];
  return `<div class="kline-kpis">${cards.map(([label, value, tone]) =>
    `<div class="kline-kpi"><span>${label}</span><b class="${tone}">${value}</b></div>`
  ).join("")}</div>`;
}

function renderStaticKlineSvg(kl: KlineData, series: ReturnType<typeof computeKlineSeries>): string {
  const rows = kl.rows.slice(-60);
  const offset = kl.rows.length - rows.length;
  const width = 1000;
  const height = 520;
  const left = 72;
  const right = 974;
  const priceTop = 30;
  const priceBottom = 348;
  const volumeTop = 390;
  const volumeBottom = 458;
  const lows = rows.map((row) => row.low);
  const highs = rows.map((row) => row.high);
  const rawMin = Math.min(...lows);
  const rawMax = Math.max(...highs);
  const padding = Math.max((rawMax - rawMin) * 0.08, Math.abs(rawMax) * 0.002, 1);
  const min = rawMin - padding;
  const max = rawMax + padding;
  const priceY = (value: number) => priceBottom - (value - min) / Math.max(max - min, 1) * (priceBottom - priceTop);
  const step = (right - left) / Math.max(rows.length, 1);
  const candleWidth = Math.max(3, Math.min(12, step * 0.58));
  const maxVolume = Math.max(...rows.map((row) => row.vol ?? 0), 1);
  const grid = Array.from({ length: 6 }, (_, index) => {
    const ratio = index / 5;
    const y = priceTop + ratio * (priceBottom - priceTop);
    const price = max - ratio * (max - min);
    return `<line x1="${left}" y1="${y.toFixed(1)}" x2="${right}" y2="${y.toFixed(1)}" class="k-grid"/><text x="${left - 10}" y="${(y + 4).toFixed(1)}" text-anchor="end" class="k-axis">${formatPrice(price)}</text>`;
  }).join("");
  const candles = rows.map((row, index) => {
    const x = left + step * (index + 0.5);
    const openY = priceY(row.open);
    const closeY = priceY(row.close);
    const highY = priceY(row.high);
    const lowY = priceY(row.low);
    const cls = `k-${movementTone(row.close - row.open)}`;
    const bodyY = Math.min(openY, closeY);
    const bodyHeight = Math.max(1.5, Math.abs(openY - closeY));
    const volume = row.vol ?? 0;
    const volumeHeight = volume / maxVolume * (volumeBottom - volumeTop);
    return `<g class="${cls}"><line x1="${x.toFixed(1)}" y1="${highY.toFixed(1)}" x2="${x.toFixed(1)}" y2="${lowY.toFixed(1)}"/><rect x="${(x - candleWidth / 2).toFixed(1)}" y="${bodyY.toFixed(1)}" width="${candleWidth.toFixed(1)}" height="${bodyHeight.toFixed(1)}"/><rect class="k-volume" x="${(x - candleWidth / 2).toFixed(1)}" y="${(volumeBottom - volumeHeight).toFixed(1)}" width="${candleWidth.toFixed(1)}" height="${volumeHeight.toFixed(1)}"/></g>`;
  }).join("");
  const dateLabels = rows.map((row, index) => ({ row, index })).filter(({ index }) => index === 0 || index === rows.length - 1 || index % Math.max(1, Math.floor(rows.length / 5)) === 0).map(({ row, index }) => {
    const x = left + step * (index + 0.5);
    return `<text x="${x.toFixed(1)}" y="482" text-anchor="middle" class="k-axis">${esc(row.date.slice(-5))}</text>`;
  }).join("");
  const ma5 = renderSvgLine(series.ma5.slice(offset), priceY, left, step, "k-ma5");
  const ma10 = renderSvgLine(series.ma10.slice(offset), priceY, left, step, "k-ma10");
  const ma20 = renderSvgLine(series.ma20.slice(offset), priceY, left, step, "k-ma20");
  return `<svg class="kline-fallback" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(kl.timeframe || "日K")} K-line chart">
    <rect width="${width}" height="${height}" class="k-bg"/><g>${grid}</g><line x1="${left}" y1="${volumeBottom}" x2="${right}" y2="${volumeBottom}" class="k-grid"/>
    <g>${candles}</g><path d="${ma5}" class="k-ma k-ma5"/><path d="${ma10}" class="k-ma k-ma10"/><path d="${ma20}" class="k-ma k-ma20"/>
    <g>${dateLabels}</g><g class="k-legend"><circle cx="730" cy="504" r="3" class="k-ma5-dot"/><text x="738" y="508">MA5</text><circle cx="795" cy="504" r="3" class="k-ma10-dot"/><text x="803" y="508">MA10</text><circle cx="870" cy="504" r="3" class="k-ma20-dot"/><text x="878" y="508">MA20</text></g>
  </svg>`;
}

function renderSvgLine(
  values: (number | null)[],
  priceY: (value: number) => number,
  left: number,
  step: number,
  _className: string,
): string {
  let started = false;
  return values.map((value, index) => {
    if (value === null) { started = false; return ""; }
    const x = left + step * (index + 0.5);
    const command = started ? "L" : "M";
    started = true;
    return `${command}${x.toFixed(1)},${priceY(value).toFixed(1)}`;
  }).join(" ");
}

function lastNumber(values: (number | null)[]): number | null {
  for (let index = values.length - 1; index >= 0; index--) {
    if (values[index] !== null) return values[index]!;
  }
  return null;
}

function formatPrice(value: number): string {
  return Math.abs(value) >= 1000 ? value.toFixed(2) : value.toFixed(2).replace(/\.00$/, "");
}

// ── ECharts bar chart render ──

export function renderEchartsBars(bars: FactorBar[]): string {
  const id = `fb${Math.random().toString(36).slice(2,6)}`;
  const rawText = esc(bars.map((b) => `${b.label}    ${"█".repeat(Math.round(b.pct/5))}${"░".repeat(Math.round((100-b.pct)/5))}  ${b.value}`).join("\n"));
  const json = JSON.stringify(bars.map((b) => ({ label: b.label, value: b.pct })));

  return `<div class="ec-box">
    <div class="ec-hdr"><span>Factor Performance</span>
      <span class="tgl"><button class="tgl-btn on" onclick="toggleView(this,'chart')">Chart</button><button class="tgl-btn" onclick="toggleView(this,'raw')">Raw</button></span>
    </div>
    <div class="ec-body"><div id="${id}" style="width:100%;height:${Math.max(100, bars.length * 36)}px"></div></div>
    <div class="ec-raw"><pre>${rawText}</pre></div>
    ${INDICATOR_GLOSSARY}
  </div>
  <script>(function(){var d=document.getElementById('${id}');if(!d||typeof echarts==='undefined')return;var c=${json};var ch=echarts.init(d,'dark');ch.setOption({animation:true,tooltip:{trigger:'axis',axisPointer:{type:'shadow'}},grid:{left:'30%',right:'8%',top:'5%',bottom:'5%'},xAxis:{type:'value',axisLabel:{fontSize:10,color:'#8F8A7B'},splitLine:{lineStyle:{color:'#3A362C',type:'dashed'}}},yAxis:{type:'category',data:c.map(function(b){return b.label;}).reverse(),axisLabel:{fontSize:10,color:'#8F8A7B',fontFamily:'monospace'},axisLine:{lineStyle:{color:'#3A362C'}}},series:[{type:'bar',data:c.map(function(b){return{value:b.value,itemStyle:{color:b.value>=50?'#C99A2E':b.value>=30?'${WHYJ_THEME.goldHighlight}':'${WHYJ_THEME.muted}',borderRadius:[0,3,3,0]}}}),barMaxWidth:18,label:{show:true,position:'right',fontSize:10,color:'#8F8A7B',formatter:function(p){return p.value.toFixed(1)+'%';}}}]});window.addEventListener('resize',function(){ch.resize();});})();</script>`;
}

// ── Factor matrix render (compact table for 9+ factors) ──

export function renderFactorMatrix(bars: FactorBar[]): string {
  const sorted = [...bars].sort((a, b) => b.pct - a.pct);
  const rows = sorted.map((b) => {
    const tier = b.pct >= 70 ? "hi" : b.pct >= 40 ? "md" : "lo";
    const color = b.up ? "" : " inv";
    return `<tr>
      <td>${esc(b.label)}</td>
      <td class="n"><div class="si"><div class="tr"><div class="fl ${tier}${color}" style="width:${b.pct}%"></div></div><span class="vl">${esc(b.value)}</span></div></td>
    </tr>`;
  }).join("");

  return `<div class="tw"><table>
    <thead><tr><th>因子</th><th>得分</th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div>`;
}

// ── Factor radar chart (for dock) ──

export function renderFactorRadar(bars: FactorBar[]): string {
  const top = [...bars].sort((a, b) => b.pct - a.pct).slice(0, 12);
  const id = `fr${Math.random().toString(36).slice(2, 6)}`;
  const rawText = esc(bars.map((b) => `${b.label}    ${"█".repeat(Math.round(b.pct/5))}${"░".repeat(Math.round((100-b.pct)/5))}  ${b.value}`).join("\n"));
  const json = JSON.stringify({
    indicators: top.map((b) => ({ name: b.label, max: 100 })),
    values: top.map((b) => b.pct),
  });

  return `<div class="ec-box">
    <div class="ec-hdr"><span>Factor Performance (${top.length})</span>
      <span class="tgl"><button class="tgl-btn on" onclick="toggleView(this,'chart')">Chart</button><button class="tgl-btn" onclick="toggleView(this,'raw')">Raw</button></span>
    </div>
    <div class="ec-body"><div id="${id}" style="width:100%;height:380px"></div></div>
    <div class="ec-raw"><pre>${rawText}</pre></div>
    ${INDICATOR_GLOSSARY}
  </div>
  <script>(function(){var d=document.getElementById('${id}');if(!d||typeof echarts==='undefined')return;var c=${json};var ch=echarts.init(d,'dark');ch.setOption({tooltip:{trigger:'item'},radar:{indicator:c.indicators,center:['50%','55%'],radius:'65%',axisName:{fontSize:9,color:'#8F8A7B'},splitArea:{areaStyle:{color:['rgba(255,255,255,0.02)','rgba(255,255,255,0.04)']}},splitLine:{lineStyle:{color:'#3A362C'}},axisLine:{lineStyle:{color:'#3A362C'}}},series:[{type:'radar',data:[{value:c.values,name:'Score',areaStyle:{color:'rgba(201,154,46,0.15)'},lineStyle:{color:'#C99A2E',width:1.5},itemStyle:{color:'#C99A2E'}}],symbol:'circle',symbolSize:4,emphasis:{lineStyle:{width:2.5},areaStyle:{color:'rgba(201,154,46,0.25)'}}}]});window.addEventListener('resize',function(){ch.resize();});})();</script>`;
}

// ── Multi-series comparison radar ──

export const COMPARE_COLORS = [WHYJ_THEME.gold, WHYJ_THEME.cream, WHYJ_THEME.negative, WHYJ_THEME.positive, "#5DB8A6", "#CC785C", "#9B968C", WHYJ_THEME.muted];

export function renderComparisonRadar(series: FactorSeries[]): string {
  // Use common factors across all series
  const commonLabels = series[0]!.factors.map((f) => f.label);
  const id = `cr${Math.random().toString(36).slice(2, 6)}`;
  const rawText = esc(series.map((s) => s.name + "\n" + s.factors.map((f) => `  ${f.label}: ${f.pct.toFixed(1)}%`).join("\n")).join("\n\n"));

  const indicators = commonLabels.map((l) => ({ name: l, max: 100 }));
  const radarData = series.map((s, i) => ({
    name: s.name,
    value: commonLabels.map((l) => {
      const f = s.factors.find((x) => x.label === l);
      return f ? f.pct : 0;
    }),
    lineStyle: { color: COMPARE_COLORS[i % COMPARE_COLORS.length]!, width: 1.5 },
    itemStyle: { color: COMPARE_COLORS[i % COMPARE_COLORS.length]! },
    areaStyle: { color: COMPARE_COLORS[i % COMPARE_COLORS.length]!.replace(")", ",0.08)").replace("rgb", "rgba") },
  }));

  return `<div class="ec-box">
    <div class="ec-hdr"><span>Comparison (${series.length})</span>
      <span class="tgl"><button class="tgl-btn on" onclick="toggleView(this,'chart')">Chart</button><button class="tgl-btn" onclick="toggleView(this,'raw')">Raw</button></span>
    </div>
    <div class="ec-body"><div id="${id}" style="width:100%;height:400px"></div></div>
    <div class="ec-raw"><pre>${rawText}</pre></div>
    ${INDICATOR_GLOSSARY}
  </div>
  <script>(function(){var d=document.getElementById('${id}');if(!d||typeof echarts==='undefined')return;var ch=echarts.init(d,'dark');ch.setOption({tooltip:{trigger:'item'},legend:{data:${JSON.stringify(series.map(s=>s.name))},bottom:0,textStyle:{fontSize:9,color:'#8F8A7B'}},radar:{indicator:${JSON.stringify(indicators)},center:['50%','48%'],radius:'58%',axisName:{fontSize:9,color:'#8F8A7B'},splitArea:{areaStyle:{color:['rgba(255,255,255,0.02)','rgba(255,255,255,0.04)']}},splitLine:{lineStyle:{color:'#3A362C'}},axisLine:{lineStyle:{color:'#3A362C'}}},series:[{type:'radar',data:[${radarData.map((d,i)=>{const c=COMPARE_COLORS[i%COMPARE_COLORS.length]!;const r=parseInt(c.slice(1,3),16);const g=parseInt(c.slice(3,5),16);const b=parseInt(c.slice(5,7),16);return`{value:${JSON.stringify(d.value)},name:${JSON.stringify(d.name)},lineStyle:{color:'${c}',width:1.5},itemStyle:{color:'${c}'},areaStyle:{color:'rgba(${r},${g},${b},0.08)'}}`;}).join(",")}],symbol:'circle',symbolSize:4,emphasis:{lineStyle:{width:2.5}}}]});window.addEventListener('resize',function(){ch.resize();});})();</script>`;
}

// ── Metric cards render ──

export function highlight(text: string): string {
  return text.replace(/([+-]\d+(?:\.\d+)?%)/g, (m, _match: string, offset: number) => {
    const label = text.slice(0, offset).split(/[，,。；;\n]/).at(-1) ?? "";
    const cls = metricValueClass(m, label);
    return `<span class="whyj-${cls}">${m}</span>`;
  });
}

export function renderMetricCards(cards: Card[]): string {
  return `<div class="mgrid">${cards.map((c) => {
    const cls = metricValueClass(c.value, c.label);
    return `<div class="mcard"><div class="ml">${esc(c.label)}</div><div class="mv ${cls}">${esc(c.value)}</div></div>`;
  }).join("")}</div>`;
}

// ── Score table render ──

export function renderScoreTable(st: ScoreTable): string {
  const header = st.header;
  const data = st.data;
  const nCols = header.length;

  const numCols = new Set<number>();
  const scoreCols = new Set<number>();
  const hasScoreContext = header.some(label => /得分|score|rating|总分|综合|稳健/i.test(label));
  for (let i = 0; i < nCols; i++) {
    const vals = data.map((r) => r[i] ?? "").filter((v) => v !== "" && v !== "-").map((v) => parseFloat(v.replace(/[%,+¥$]/g, "")));
    if (vals.length > 0 && vals.every((v) => !isNaN(v))) {
      numCols.add(i);
      if (hasScoreContext && /^(收益|风险|稳健性?|得分|score|rating|总分|综合)(评分|得分|score)?$/i.test(header[i] ?? "")
        && data.every(row => !/[%％]/.test(row[i] ?? "")) && vals.every((v) => v >= 0 && v <= 100)) scoreCols.add(i);
    }
  }

  const th = header.map((c, i) =>
    `<th data-sortable>${esc(c)}<span class="sa">${numCols.has(i) ? "↕" : ""}</span></th>`
  ).join("");

  const tb = data.map((row) =>
    `<tr>${row.map((c, i) => {
      const label = i === 1 && /^(value|值|数值)?$/i.test(header[i] ?? "") ? row[0] ?? "" : header[i] ?? "";
      if (!numCols.has(i)) return `<td class="${displayedNumber(c) !== null ? "n " : ""}${tableValueClass(c, label)}">${esc(c)}</td>`;
      const v = parseFloat(c.replace(/[%,+¥$]/g, ""));
      if (isNaN(v)) return `<td class="n">${esc(c)}</td>`;
      if (scoreCols.has(i)) {
        const pct = Math.min(100, Math.max(0, v));
        const tier = pct >= 80 ? "hi" : pct >= 50 ? "md" : "lo";
        return `<td class="n"><div class="si"><div class="tr"><div class="fl ${tier}" style="width:${pct}%"></div></div><span class="vl">${esc(c)}</span></div></td>`;
      }
      const cls = tableValueClass(c, label);
      return `<td class="n ${cls}">${esc(c)}</td>`;
    }).join("")}</tr>`
  ).join("");

  return `<div class="tw"><table><thead><tr>${th}</tr></thead><tbody>${tb}</tbody></table></div>`;
}

// ── Fund NAV line chart (雪球-style) ──

export function renderNavEcharts(nd: NavLineData): string {
  const dates = nd.rows.map((r) => r.date.slice(-10));
  const navs = nd.rows.map((r) => r.nav);
  const bmValues = nd.rows.map((r) => r.bm ?? null);
  const hsValues = nd.rows.map((r) => r.hs300 ?? null);
  const hasBm = bmValues.some((v) => v !== null);
  const hasHs = hsValues.some((v) => v !== null);

  const id = `nv${Math.random().toString(36).slice(2, 6)}`;
  const rawText = esc(nd.header.join("  ") + "\n" + nd.rows.map((r) => `${r.date}  ${r.nav}` + (r.bm ? `  ${r.bm}` : "") + (r.hs300 ? `  ${r.hs300}` : "")).join("\n"));
  const json = JSON.stringify({ dates, navs, bm: bmValues, hs: hsValues, hasBm, hasHs });

  return `<div class="ec-box">
    <div class="ec-hdr"><span>业绩走势 (${nd.rows.length}天)</span>
      <span class="tgl"><button class="tgl-btn on" onclick="toggleView(this,'chart')">Chart</button><button class="tgl-btn" onclick="toggleView(this,'raw')">Raw</button></span>
    </div>
    <div class="ec-body"><div id="${id}" style="width:100%;height:380px"></div></div>
    <div class="ec-raw"><pre>${rawText}</pre></div>
    ${INDICATOR_GLOSSARY}
  </div>
  <script>(function(){var d=document.getElementById('${id}');if(!d||typeof echarts==='undefined')return;var c=${json};var ch=echarts.init(d,'dark');
var legendData=['本产品'];
var series=[{
  name:'本产品',type:'line',data:c.navs,smooth:true,symbol:'none',
  lineStyle:{color:'#C99A2E',width:2},
  areaStyle:{color:{type:'linear',x:0,y:0,x2:0,y2:1,colorStops:[{offset:0,color:'rgba(201,154,46,0.2)'},{offset:1,color:'rgba(201,154,46,0.02)'}]}}
}];
if(c.hasBm){legendData.push('业绩基准');series.push({name:'业绩基准',type:'line',data:c.bm,smooth:true,symbol:'none',lineStyle:{color:'#e8a55a',width:1.5},areaStyle:{color:{type:'linear',x:0,y:0,x2:0,y2:1,colorStops:[{offset:0,color:'rgba(232,165,90,0.12)'},{offset:1,color:'rgba(232,165,90,0.01)'}]}}});}
if(c.hasHs){legendData.push('沪深300');series.push({name:'沪深300',type:'line',data:c.hs,smooth:true,symbol:'none',lineStyle:{color:'#5B9BD5',width:1.5},areaStyle:{color:{type:'linear',x:0,y:0,x2:0,y2:1,colorStops:[{offset:0,color:'rgba(91,155,213,0.1)'},{offset:1,color:'rgba(91,155,213,0.01)'}]}}});}
ch.setOption({animation:true,tooltip:{trigger:'axis'},legend:{data:legendData,bottom:0,textStyle:{fontSize:10,color:'#8F8A7B'}},grid:{left:'3%',right:'4%',top:'5%',bottom:'12%',containLabel:true},xAxis:{type:'category',data:c.dates,axisLabel:{fontSize:9,color:'#8F8A7B'},axisLine:{lineStyle:{color:'#3A362C'}}},yAxis:{type:'value',scale:true,axisLabel:{fontSize:9,color:'#8F8A7B'},splitLine:{lineStyle:{color:'#3A362C',type:'dashed'}}},series:series});
window.addEventListener('resize',function(){ch.resize();});})();</script>`;
}
