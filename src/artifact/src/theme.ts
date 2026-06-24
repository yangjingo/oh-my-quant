/**
 * Artifact CSS — mirrors TUI layout (docs/tui-layout-design.md) + DESIGN.md palette.
 *
 * Layout zones: Header | Conversation (left) | Analytics dock (right) | Status bar
 * Colors: DESIGN.md primary #D4AF37, styles.ts GOLD #E8B339, CANVAS #0B0B0C
 * Charts: ECharts CDN with WhyJ dark theme
 */

export function artifactThemeCss(): string {
  return /* css */ `
:root {
  --g:  #D4AF37;   /* primary gold — DESIGN.md */
  --gf: #E2BE4D;   /* gold focus */
  --gd: #F0D77A;   /* gold on-dark */
  --ink: #F5F5F5;   /* body — DESIGN.md */
  --mu:  #A6A6A6;   /* muted — DESIGN.md */
  --cv:  #0B0B0C;   /* canvas — DESIGN.md */
  --sf:  #111111;   /* surface — DESIGN.md */
  --se:  #171717;   /* surface-elevated */
  --hl:  #242424;   /* hairline — DESIGN.md */
  --up:  #E5494D;   /* market up — styles.ts MARKET_UP */
  --dn:  #1E9F4D;   /* market down — styles.ts MARKET_DOWN */
  --pos: #1E9F4D;   /* positive — styles.ts POSITIVE */
  --neg: #E5494D;   /* negative — styles.ts NEGATIVE */
  --f: "Geist Sans","Inter",system-ui,sans-serif;
  --fm:"Geist Mono","JetBrains Mono",monospace;
  --r: 4px;
  --mw: 1280px;
  --hdr-h: 36px;
  --st-h: 28px;
}
[data-theme="light"] {
  --cv:#FAF9F5;--sf:#FFF;--se:#F5F3EE;--ink:#1A1815;--mu:#6B6660;--hl:#E5E0D5;
  --g:#B8941F;--gf:#A07E14;--gd:#D4AF37;
}
*{box-sizing:border-box;margin:0;padding:0}
html{font-size:14px;-webkit-text-size-adjust:100%}
body{font-family:var(--f);background:var(--cv);color:var(--ink);min-height:100vh;overflow-x:hidden}

/* ── Root grid: header | main (2-col) | status ── */
.app{display:grid;grid-template-rows:var(--hdr-h) 1fr var(--st-h);grid-template-columns:1fr;min-height:100vh;max-width:var(--mw);margin:0 auto}

/* ── Header ── */
.app-hdr{grid-row:1;display:flex;align-items:center;gap:1rem;padding:0 1rem;background:var(--sf);border-bottom:1px solid var(--hl);font-size:0.75rem;user-select:none}
.app-hdr .brand{font-weight:700;color:var(--g);letter-spacing:-0.02em;font-size:0.8125rem}
.app-hdr .hdr-dot{width:6px;height:6px;border-radius:50%;background:var(--pos);animation:pulse 2s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}
.app-hdr .hdr-sp{flex:1}
.app-hdr .hdr-tag{padding:0.125rem 0.5rem;font-size:0.625rem;color:var(--mu);border:1px solid var(--hl);border-radius:3px;font-family:var(--fm)}
.app-hdr .hdr-tag.accent{color:var(--g);border-color:var(--g)}

/* Tabs */
.app-tabs{display:flex;gap:0;border:1px solid var(--hl);border-radius:3px;overflow:hidden}
.tab-btn{padding:0.1875rem 0.625rem;font:0.625rem var(--f);color:var(--mu);background:0;border:0;cursor:pointer;transition:all .12s;border-right:1px solid var(--hl)}
.tab-btn:last-child{border-right:0}
.tab-btn.on{background:var(--g);color:var(--cv);font-weight:600}
.tab-btn:hover:not(.on){color:var(--g)}

/* ── Main area: 2 columns ── */
.app-main{grid-row:2;display:grid;grid-template-columns:1fr 380px;gap:0;min-height:0}
@media(max-width:860px){.app-main{grid-template-columns:1fr}.app-dock{display:none}}

/* ── Left: Conversation ── */
.app-conv{overflow-y:auto;padding:1rem 1.25rem;border-right:1px solid var(--hl)}
.app-conv .conv-inner{max-width:720px}
.app-conv-full{border-right:0}
.app-conv-full .conv-inner{max-width:960px}

/* ── Right: Analytics Dock ── */
.app-dock{overflow-y:auto;padding:0.75rem;background:var(--sf);display:flex;flex-direction:column;gap:0.625rem}
.app-dock .dock-title{font-size:0.6875rem;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;color:var(--g);padding-bottom:0.375rem;border-bottom:1px solid var(--hl);margin-bottom:0.25rem}

/* ── Status bar ── */
.app-st{grid-row:3;display:flex;align-items:center;gap:0.75rem;padding:0 1rem;background:var(--sf);border-top:1px solid var(--hl);font-size:0.625rem;color:var(--mu);font-family:var(--fm)}
.app-st .st-dot{width:5px;height:5px;border-radius:50%;background:var(--pos)}
.app-st .st-sp{flex:1}
.app-st .st-src{color:var(--g);text-decoration:none;font-size:0.625rem;padding:0 0.25rem}
.app-st .st-src:hover{text-decoration:underline}

/* ── Messages ── */
.msg{margin-bottom:1.25rem;animation:fi .12s ease-out}
@keyframes fi{from{opacity:0;transform:translateY(2px)}to{opacity:1;transform:translateY(0)}}
.msg-role{font-size:0.625rem;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:0.25rem;display:flex;align-items:center;gap:0.375rem}
.msg-role.user{color:var(--g)}.msg-role.assistant{color:var(--pos)}.msg-role.tool{color:var(--up)}
.msg-role .dot{width:5px;height:5px;border-radius:50%;background:currentColor}
.msg-body{font-size:0.8125rem;line-height:1.6;padding-left:0.625rem;border-left:1px solid var(--hl)}
.msg-body p{margin-bottom:0.375rem}.msg-body p:last-child{margin-bottom:0}

/* ── ECharts container ── */
.ec-box{margin:0.75rem 0;background:var(--se);border:1px solid var(--hl);border-radius:var(--r);overflow:hidden}
.ec-box .ec-hdr{display:flex;align-items:center;justify-content:space-between;padding:0.375rem 0.625rem;font-size:0.625rem;color:var(--g);border-bottom:1px solid var(--hl);font-weight:600;text-transform:uppercase;letter-spacing:0.05em}
.ec-box .ec-body{padding:0.375rem 0}
.ec-box .ec-raw{display:none;padding:0.5rem;font:0.625rem/1.4 var(--fm);color:var(--mu);overflow-x:auto;max-height:360px}

/* ── Toggle buttons ── */
.tgl{display:inline-flex;gap:0;border-radius:3px;overflow:hidden;border:1px solid var(--hl)}
.tgl-btn{padding:0.125rem 0.5rem;font:0.5625rem var(--f);color:var(--mu);background:0;border:0;cursor:pointer;transition:all .12s}
.tgl-btn.on{background:var(--g);color:var(--cv);font-weight:600}
.tgl-btn:hover:not(.on){color:var(--g)}

/* ── K-line timeframe tabs ── */
.klt-tabs{display:inline-flex;gap:0;border:1px solid var(--hl);border-radius:3px;overflow:hidden}
.klt-btn{padding:0.125rem 0.5rem;font:0.5625rem var(--f);color:var(--mu);background:0;border:0;cursor:pointer;transition:all .12s;border-right:1px solid var(--hl)}
.klt-btn:last-child{border-right:0}
.klt-btn.on{background:var(--g);color:var(--cv);font-weight:600}
.klt-btn:hover:not(.on){color:var(--g)}

/* ── Indicator glossary ── */
.ind-glossary{margin-top:0.5rem;border:1px solid var(--hl);border-radius:var(--r);overflow:hidden;font-size:0.6875rem}
.ind-glossary summary{padding:0.375rem 0.625rem;cursor:pointer;color:var(--g);font-weight:600;font-size:0.625rem;text-transform:uppercase;letter-spacing:0.05em;background:var(--sf);user-select:none}
.ind-glossary summary:hover{color:var(--gf)}
.ind-glossary .ig-body{padding:0.5rem 0.625rem;display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:0.5rem}
.ig-item{display:flex;gap:0.375rem;align-items:baseline}
.ig-item .ig-name{font-weight:600;color:var(--g);white-space:nowrap;font-size:0.625rem;min-width:70px}
.ig-item .ig-desc{color:var(--mu);line-height:1.4;font-size:0.625rem}

/* ── Metric cards ── */
.mgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:0.375rem}
.mcard{background:var(--sf);border:1px solid var(--hl);border-radius:var(--r);padding:0.5rem 0.625rem;transition:border-color .12s}
.mcard:hover{border-color:var(--g)}
.mcard .ml{font-size:0.5625rem;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:var(--g);margin-bottom:0.125rem}
.mcard .mv{font-size:1.125rem;font-weight:700;font-family:var(--fm)}
.mcard .mv.up{color:var(--up)}.mcard .mv.dn{color:var(--dn)}.mcard .mv.pos{color:var(--pos)}.mcard .mv.neg{color:var(--neg)}.mcard .mv.nt{color:var(--ink)}

/* ── Tables ── */
.tw{margin:0.5rem 0;overflow-x:auto;border:1px solid var(--hl);border-radius:var(--r)}
.tw table{width:100%;border-collapse:collapse;font-size:0.75rem}
.tw th{padding:0.375rem 0.625rem;text-align:left;font-weight:600;color:var(--g);font-size:0.625rem;text-transform:uppercase;letter-spacing:0.05em;border-bottom:1px solid var(--hl);cursor:pointer;user-select:none;white-space:nowrap;background:var(--sf)}
.tw th:hover{color:var(--gf)}.tw th .sa{margin-left:0.1875rem;opacity:0.35}
.tw th[aria-sort] .sa{opacity:1}
.tw td{padding:0.3125rem 0.625rem;border-bottom:1px solid rgba(36,36,36,0.5);font-size:0.75rem}
.tw tr:hover td{background:var(--se)}.tw tr.sel td{background:rgba(212,175,55,0.06)}
.tw tr:last-child td{border-bottom:0}
.tw .n{text-align:right;font-family:var(--fm);font-variant-numeric:tabular-nums}
.tw .u{color:var(--up)}.tw .d{color:var(--dn)}.tw .p{color:var(--pos)}.tw .ng{color:var(--neg)}.tw .m{color:var(--mu)}

/* Score inline bar */
.si{display:flex;align-items:center;gap:4px}
.si .tr{flex:1;min-width:28px;height:4px;background:var(--cv);border-radius:2px;overflow:hidden}
.si .fl{height:100%;border-radius:2px;transition:width .3s}
.si .fl.hi{background:var(--pos)}.si .fl.md{background:var(--g)}.si .fl.lo{background:var(--neg)}
.si .vl{font-size:0.6875rem;font-family:var(--fm);min-width:28px;text-align:right}

/* Stats grid */
.st-grid .mcard{padding:0.375rem 0.5rem}
.st-grid .mv.sm{font-size:0.75rem;word-break:break-all}
.src-card{text-decoration:none;transition:border-color .12s}
.src-card:hover{border-color:var(--g);text-decoration:none}
.src-card .ml{font-size:0.625rem;color:var(--g)}
.src-card .mv.sm{font-size:0.5625rem;color:var(--mu);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}

/* Tool call */
.tc{margin:0.25rem 0;font:0.6875rem var(--fm);border-left:2px solid var(--hl);border-radius:0 var(--r) var(--r) 0;overflow:hidden}
.tc summary{display:flex;align-items:center;gap:0.375rem;padding:0.1875rem 0.5rem;cursor:pointer;color:var(--mu);background:var(--sf);user-select:none}
.tc summary:hover{color:var(--ink)}
.tc .tc-dot{width:4px;height:4px;border-radius:50%;background:var(--mu);flex-shrink:0}
.tc .tc-name{color:var(--g);font-weight:600}
.tc .tc-args{padding:0.375rem 0.625rem;color:var(--mu);font:0.625rem/1.5 var(--fm);white-space:pre-wrap;word-break:break-all;max-height:300px;overflow-y:auto}
.tc.skill{border-left-color:var(--g);display:flex;align-items:center;gap:0.375rem;padding:0.1875rem 0.5rem;color:var(--ink);background:0}
.tc.skill .tc-dot{background:var(--g)}

/* Tool result */
.tr{margin:0.25rem 0;font:0.6875rem var(--fm);border:1px solid var(--hl);border-radius:var(--r);overflow:hidden}
.tr summary{display:flex;align-items:center;gap:0.375rem;padding:0.25rem 0.5rem;cursor:pointer;color:var(--up);font-weight:600;user-select:none;background:var(--sf)}
.tr summary:hover{background:var(--se)}
.tr .tr-dot{width:4px;height:4px;border-radius:50%;background:var(--up);flex-shrink:0}
.tr pre{padding:0.375rem 0.625rem;margin:0;overflow-x:auto;color:var(--mu);max-height:300px;white-space:pre-wrap;word-break:break-all}

/* Thinking */
.th{margin:0.25rem 0;font:0.625rem var(--fm);border:1px solid var(--hl);border-radius:var(--r);overflow:hidden;opacity:0.7}
.th summary{padding:0.1875rem 0.5rem;cursor:pointer;color:var(--mu);font-style:italic;user-select:none;background:var(--sf)}
.th summary:hover{color:var(--ink)}
.th-body{padding:0.375rem 0.625rem;color:var(--mu);max-height:200px;overflow-y:auto;white-space:pre-wrap;line-height:1.5}

/* Raw trajectory text */
.traj-raw{font:0.75rem/1.6 var(--fm);white-space:pre-wrap;word-break:break-all}

/* Highlight */
.whyj-up{color:var(--up);font-weight:600}.whyj-dn{color:var(--dn);font-weight:600}

/* Code */
.code{position:relative;margin:0.5rem 0;background:var(--sf);border:1px solid var(--hl);border-radius:var(--r);overflow:hidden}
.code pre{padding:0.625rem;overflow-x:auto;font:0.6875rem/1.5 var(--fm);color:var(--ink)}
.code .cbtn{position:absolute;top:2px;right:2px;padding:0.125rem 0.375rem;font:0.5625rem var(--f);color:var(--mu);background:var(--se);border:1px solid var(--hl);border-radius:2px;cursor:pointer;opacity:0;transition:opacity .12s}
.code:hover .cbtn{opacity:1}.code .cbtn:hover{color:var(--g)}

/* Footer */
.app-ft{text-align:center;padding:0.5rem;font-size:0.625rem;color:var(--mu);border-top:1px solid var(--hl)}
.app-ft a{color:var(--g);text-decoration:none}

/* Theme toggle */
.thm-btn{padding:0.125rem 0.5rem;font:0.625rem var(--f);color:var(--mu);background:var(--se);border:1px solid var(--hl);border-radius:2px;cursor:pointer}
.thm-btn:hover{color:var(--g);border-color:var(--g)}


/* ── Trajectory timeline (traj-weaver style) ── */
.traj-summary-bar{display:flex;gap:1rem;padding:0.375rem 0.625rem;background:var(--sf);border:1px solid var(--hl);border-radius:var(--r);font-size:0.6875rem;color:var(--mu);margin-bottom:1rem;flex-wrap:wrap}
.traj-summary-bar code{font-size:0.625rem;color:var(--g)}
.traj-summary-bar .traj-tools{flex:1;text-align:right}

/* Timeline blocks — color-coded left border */
.traj-timeline{position:relative}
.traj-blk{margin:0 0 0.125rem 0;padding:0.5rem 0.75rem;border-left:3px solid var(--hl);font-size:0.8125rem;line-height:1.6}
.traj-blk summary{cursor:pointer;user-select:none;color:var(--mu);font-size:0.75rem}
.traj-blk summary:hover{color:var(--ink)}
.traj-blk-body{white-space:pre-wrap;word-break:break-word}
.traj-blk-body br{display:none} .traj-blk-body br+br{display:block;margin-bottom:0.5rem}

/* Role colors */
.traj-user{border-left-color:#cc785c}
.traj-assistant{border-left-color:#5db8a6}
.traj-tool{border-left-color:#e8a55a}
.traj-result{border-left-color:#e8a55a;border-left-style:dashed;opacity:0.85}
.traj-meta{border-left-color:var(--mu)}

/* Tool blocks */
.traj-tool-name{font-weight:600;color:#e8a55a;font-family:var(--fm);font-size:0.75rem}
.traj-tool-args{padding:0.375rem 0.5rem;margin-top:0.25rem;font:0.625rem/1.4 var(--fm);color:var(--mu);white-space:pre-wrap;max-height:200px;overflow-y:auto;background:var(--cv);border-radius:2px}
.traj-result-label{font-weight:600;color:var(--mu);font-size:0.625rem;text-transform:uppercase;letter-spacing:0.04em;margin-bottom:0.125rem}
.traj-result-body{font:0.625rem/1.4 var(--fm);color:var(--mu);white-space:pre-wrap;max-height:200px;overflow-y:auto}
.traj-redacted{font-size:0.5625rem;color:var(--g);border:1px solid var(--g);border-radius:2px;padding:0 0.25rem;margin-left:0.375rem}

@media(max-width:640px){.app-conv{padding:0.75rem}.app-dock{display:none}}
@media print{.app-dock,.app-st,.thm-btn{display:none}body{background:#fff;color:#000}}
`;
}
