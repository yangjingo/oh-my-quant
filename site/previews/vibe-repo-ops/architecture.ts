// Native, editable technical diagrams. Layout variants preserve the same relationships.
export function architectureFigures(c: { canvas: string; surface: string; ink: string; muted: string; line: string; gold: string }) {
  const esc = (s: string) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;");
  const t = (x: number, y: number, s: string, size = 22, fill = c.ink, weight = 400) => `<text x="${x}" y="${y}" fill="${fill}" font-size="${size}" font-weight="${weight}" font-family="Arial,Helvetica,sans-serif">${esc(s)}</text>`;
  const node = (x: number, y: number, w: number, title: string, lines: string[], highlight = false) => `<g data-node="${esc(title)}"><rect x="${x}" y="${y}" width="${w}" height="124" rx="6" fill="${c.surface}" stroke="${highlight ? c.gold : c.line}" stroke-width="2"/>${t(x + 20, y + 37, title, 26, c.ink, 600)}${lines.map((s, i) => t(x + 20, y + 73 + i * 30, s, 21, c.muted)).join("")}</g>`;
  const edge = (d: string, gold = false, dash = false) => `<path d="${d}" fill="none" stroke="${gold ? c.gold : c.muted}" stroke-width="2"${dash ? ' stroke-dasharray="7 6"' : ""} marker-end="url(#${gold ? "gold" : "normal"})"/>`;
  const rule = (y: number, w: number, label: string) => `<path d="M24 ${y}H${w - 24}" stroke="${c.line}"/>${t(24, y + 34, label, 20, c.gold)}`;
  const frame = (w: number, h: number, title: string, desc: string, body: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-labelledby="title desc"><title id="title">${esc(title)}</title><desc id="desc">${esc(desc)}</desc><defs>${[["normal", c.muted], ["gold", c.gold]].map(([id, fill]) => `<marker id="${id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10" fill="${fill}"/></marker>`).join("")}</defs><rect width="${w}" height="${h}" fill="${c.canvas}"/>${body}</svg>\n`;
  const outputs: Record<string, string> = {};
  const sources = [
    ["AGENTS.md", "Principles and entry points", "Read by agents and maintainers"],
    ["Skills", "Task steps and exceptions", "Applied to the task"],
    ["Current Docs", "Contracts and operations", "Guide implementation / review"],
  ];
  const execution = [
    ["GitHub Workflow", "Events / runtime / permissions", "Schedule check jobs"],
    ["Scripts / Tests", "Run deterministic checks", "Produce results and logs"],
    ["Check status", "Record check outcomes", "Bind to a commit and run"],
  ];
  for (const mobile of [false, true]) {
    const w = mobile ? 480 : 1120;
    let b = t(24, 48, "Who enforces each rule?", mobile ? 27 : 32, c.ink, 600);
    b += t(24, 86, "Guidance, checks and merge rules", 21, c.muted);
    if (!mobile) {
      b += rule(110, w, "01 / Guidance");
      sources.forEach(([name, a, z], i) => { b += node(24 + i * 368, 170, 336, name, [a, z]); });
      b += edge("M192 294V326H376V364", false, true) + edge("M560 294V326H376V364", false, true) + edge("M928 294V326H376V364", false, true);
      b += node(24, 370, 520, "Agent / Maintainer", ["Apply constraints, implement and review", "Guidance does not block merges"]);
      b += edge("M544 430H744") + t(596, 410, "Produce", 20, c.muted);
      b += node(752, 370, 336, "Code / Docs / PR", ["Require independent checks", "Retain scope and evidence"]);
      b += rule(530, w, "02 / Automated checks");
      execution.forEach(([name, a, z], i) => { b += node(24 + i * 368, 620, 336, name, [a, z]); });
      b += edge("M920 494V590H192V614") + t(622, 580, "Repository events", 20, c.muted);
      b += edge("M360 682H386") + edge("M728 682H754");
      b += rule(784, w, "03 / Enforce configured merge rules");
      b += node(24, 862, 520, "Branch rules", ["Read required checks and configured conditions", "Unconfigured rules are not enforced"], true);
      b += edge("M920 744V824H284V856", true) + t(590, 814, "Required check results", 20, c.gold);
      b += edge("M544 924H744", true) + t(596, 904, "Pass", 20, c.gold);
      b += node(752, 862, 336, "Merge allowed", ["Maintainer decides to merge", "Passing checks is not a release"], true);
      b += t(24, 1035, "Dashed: guidance   Solid: execution / output   Gold: merge rules", 21, c.muted);
      outputs["repo-ops-governance.svg"] = frame(w, 1072, "Repository enforcement boundaries", "Agents and maintainers apply guidance. Workflows run scripts to produce check status. The platform enforces configured merge rules.", b);
    } else {
      b += rule(110, w, "01 / Guidance");
      sources.forEach(([name, a, z], i) => { b += node(40, 164 + i * 148, 416, name, [a, z]); });
      // Three independent inputs join a bus, not a false serial dependency.
      b += edge("M40 226H16V630H240V656", false, true) + edge("M40 374H16V630", false, true) + edge("M40 522H16V630", false, true);
      b += t(40, 614, "Read / apply", 20, c.muted);
      b += node(40, 662, 416, "Agent / Maintainer", ["Implement and review code / docs / PRs", "Guidance does not block merges"]);
      b += rule(822, w, "02 / Automated checks");
      b += edge("M456 724H468V946H462") + t(272, 870, "Repo events", 20, c.muted);
      execution.forEach(([name, a, z], i) => { b += node(40, 884 + i * 170, 416, name, [a, z]); if (i < 2) b += edge(`M248 ${1008 + i * 170}V${1048 + i * 170}`); });
      b += rule(1384, w, "03 / Enforce configured rules");
      b += edge("M456 1286H468V1518H462", true);
      b += node(40, 1456, 416, "Branch rules", ["Required checks and configured rules", "Unconfigured rules are not enforced"], true);
      b += edge("M248 1580V1630", true) + t(270, 1612, "Pass", 20, c.gold);
      b += node(40, 1638, 416, "Merge allowed", ["Maintainer decides to merge", "Passing checks is not a release"], true);
      b += t(24, 1810, "Dashed: guidance   Solid: execution", 21, c.muted) + t(24, 1846, "Gold: merge rules", 21, c.gold);
      outputs["repo-ops-governance-mobile.svg"] = frame(w, 1880, "Repository enforcement boundaries", "Three guidance sources independently inform the executor. Automated checks produce status. Platform rules constrain merging.", b);
    }
  }
  const start = [
    ["Issue", "Problem / scope / acceptance", "Define the delivery scope"],
    ["Feature branch", "Code / docs / tests", "Revalidate after changes"],
    ["PR candidate", "Commit SHA + PR metadata", "Verify the final revision"],
  ];
  const checks = [
    ["CI required", "Aggregate engineering checks", "Fail / cancel / skip blocks"],
    ["PR policy", "Check links and lifecycle", "Body edits can trigger checks"],
    ["Review", "Scope / correctness / fit", "Rules define approval needs"],
  ];
  for (const mobile of [false, true]) {
    const w = mobile ? 480 : 1120;
    let b = t(24, 48, "From change to main", mobile ? 27 : 32, c.ink, 600);
    b += t(24, 86, "Verify the candidate; retry after changes", 21, c.muted);
    if (!mobile) {
      start.forEach(([name, a, z], i) => { b += node(40 + i * 360, 136, 320, name, [a, z]); });
      b += edge("M360 198H394") + edge("M720 198H754");
      b += edge("M920 260V316H200V370") + edge("M920 316H560V370") + edge("M920 316V370");
      b += t(40, 286, "Independent checks; Review is a separate judgment", 21, c.muted);
      checks.forEach(([name, a, z], i) => { b += node(40 + i * 360, 378, 320, name, [a, z]); });
      b += edge("M200 502V554H560V612", true) + edge("M560 502V612", true) + edge("M920 502V554H560", false, true);
      b += node(320, 620, 480, "Pre-merge verification", ["Latest SHA + final metadata checks", "All configured requirements satisfied"], true);
      b += edge("M800 682H844", true);
      b += node(852, 620, 228, "main", ["Merge", "Retain evidence"], true);
      b += edge("M320 682H16V298H560V266", false, true);
      b += t(40, 598, "Failure / change", 21, c.muted);
      b += rule(794, w, "Before merging");
      b += t(24, 868, "Strict mode: sync with latest main and rerun checks.", 23);
      b += t(24, 912, "Configure required check names; a workflow alone does not enforce them.", 23);
      b += t(24, 956, "Dashed: feedback / review   Gold: merge gate   Deployment is not shown", 21, c.muted);
      outputs["repo-ops-merge-flow.svg"] = frame(w, 996, "The verification path to main", "An issue scopes the feature branch. The PR receives checks and review. Merge only when the final revision meets configured conditions. Failures or changes return to the branch.", b);
    } else {
      start.forEach(([name, a, z], i) => { b += node(48, 136 + i * 174, 408, name, [a, z]); if (i < 2) b += edge(`M252 ${260 + i * 174}V${304 + i * 174}`); });
      b += t(48, 652, "Checks", 21, c.muted);
      // Parallel checks use an input bus on the left and a result bus on the right.
      b += edge("M252 608V674H24V756H42") + edge("M24 756V930H42") + edge("M24 930V1104H42");
      checks.forEach(([name, a, z], i) => { b += node(48, 694 + i * 174, 384, name, [a, z]); });
      b += edge("M432 756H464V1220H252V1254", true) + edge("M432 930H464V1220", true) + edge("M432 1104H464V1220", false, true);
      b += node(48, 1262, 408, "Pre-merge verification", ["Latest SHA + final metadata checks", "All configured requirements satisfied"], true);
      b += edge("M252 1386V1440", true) + t(276, 1420, "Pass", 20, c.gold);
      b += node(48, 1448, 408, "main", ["Merge and retain evidence", "Passing checks is not deployment"], true);
      b += edge("M48 1324H8V372H42", false, true);
      b += rule(1612, w, "Feedback and revision checks");
      b += t(24, 1680, "Failure / change: return and recheck.", 22);
      b += t(24, 1720, "Strict: sync latest main and recheck.", 22);
      b += t(24, 1760, "Configure required check names.", 22);
      b += t(24, 1810, "Dashed: feedback / review   Gold: gate", 21, c.muted);
      outputs["repo-ops-merge-flow-mobile.svg"] = frame(w, 1850, "The verification path to main", "CI, policy and Review are independent checks. Merge only after configured requirements pass; return failures to the feature branch.", b);
    }
  }
  return outputs;
}
