import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { architectureFigures } from "./architecture.ts";

// Recompose the concepts in 05-evaluation.svg and 07-artifacts.svg.
// Desktop/mobile share text and theme; original historical figures stay untouched.
export async function buildFigures(root: string) {
  const theme = await readFile(new URL("./brand/theme.css", import.meta.url), "utf8");
  const token = (name: string) => {
    const value = theme.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`))?.[1];
    if (!value) throw new Error(`Missing diagram token: ${name}`);
    return value;
  };
  const gold = token("gold"), ink = token("ink"), muted = token("muted"), canvas = token("canvas"), surface = token("surface"), line = token("hairline");
  const esc = (s: string) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;");
  const text = (x: number, y: number, value: string, cls = "body") => {
    const size = ({ title: 30, label: 26, body: 22, muted: 21, index: 19 } as Record<string, number>)[cls];
    const fill = cls === "index" ? gold : cls === "muted" ? muted : ink;
    return `<text x="${x}" y="${y}" font-family="${cls === "index" ? "Consolas,monospace" : "Arial,Helvetica,sans-serif"}" fill="${fill}" font-size="${size}" font-weight="${cls === "title" || cls === "label" ? 600 : 400}">${esc(value)}</text>`;
  };
  const frame = (width: number, height: number, title: string, description: string, body: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title desc">
<title id="title">${esc(title)}</title><desc id="desc">${esc(description)}</desc>
<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10" fill="${muted}"/></marker></defs>
<rect width="${width}" height="${height}" fill="${canvas}"/>
${body.replaceAll('class="arrow"', `stroke="${muted}" stroke-width="2" fill="none" marker-end="url(#arrow)"`)}
</svg>\n`;
  const box = (x: number, y: number, w: number, h: number, title: string, lines: string[], number = "") => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="${surface}" stroke="${line}" stroke-width="2"/>${number ? text(x + 24, y + 38, number, "index") : ""}${text(x + 24, y + (number ? 78 : 44), title, "label")}${lines.map((s, i) => text(x + 24, y + (number ? 116 : 84) + i * 34, s, i === lines.length - 1 ? "muted" : "body")).join("")}`;
  const evidence = [
    { title: "Engineering regression", lines: ["Protocols / cancellation / ledger / UI", "Unknown: live services and models"] },
    { title: "Live-service samples", lines: ["Selected endpoint / market / date", "Unknown: other endpoints / longevity"] },
    { title: "Task traces", lines: ["Tools / inputs / calls / recovery", "Unknown: faithful final explanations"] },
    { title: "Answer claims", lines: ["Values / definitions / citations", "Unknown: unseen claims and errors"] },
  ];
  const outputs: Record<string, string> = architectureFigures({ canvas, surface, ink, muted, line, gold });
  for (const mobile of [false, true]) {
    const width = mobile ? 480 : 1120;
    let body = text(32, 52, "Every pass has a boundary", mobile ? "label" : "title");
    body += text(32, 91, "Four evidence types; no overall accuracy", "muted");
    evidence.forEach((item, i) => {
      const x = mobile ? 24 : 32 + i % 2 * 544;
      const y = 126 + (mobile ? i : Math.floor(i / 2)) * 202;
      body += box(x, y, mobile ? 432 : 512, 178, item.title, item.lines, `0${i + 1}`);
    });
    const bottom = mobile ? 950 : 566;
    body += `<path d="M32 ${bottom - 30}H${width - 32}" stroke="${line}"/>`;
    body += text(32, bottom + 4, mobile ? "Keep failures → Classify → Add checks" : "Keep failures → Classify → Add checks → Retest independently → Record unknowns", "body");
    if (mobile) body += text(32, bottom + 44, "Retest independently → Note unknowns", "body");
    outputs[`repo-ops-evidence${mobile ? "-mobile" : ""}.svg`] = frame(width, bottom + (mobile ? 82 : 50), "Four checks and their unknowns", "Engineering tests, live-service samples, task traces and answer claims provide complementary evidence. Failures inform the next checks.", body);
  }
  const descriptions = {
    input: ["Calls / inputs / outputs", "DatasetRef / pinned version"],
    verify: ["Pair / archive / recompute", "Retain gaps and caveats"],
    report: ["Pinned HTML + provenance", "Private sessions and traces"],
    share: ["Allowlist / anonymized NAV", "No cash / sessions / paths"],
    execute: ["Account / intent / checks / consent", "Separate idempotency / reconciliation"],
  };
  let desktop = text(32, 52, "Pin reports; separate sharing and execution", "title") + text(32, 91, "Reading, verification, sharing and execution each have a contract", "muted");
  desktop += box(32, 208, 300, 166, "Research inputs", descriptions.input);
  desktop += box(402, 208, 300, 166, "Verification", descriptions.verify);
  desktop += box(772, 128, 316, 166, "Full report", descriptions.report);
  desktop += box(772, 330, 316, 166, "Public share", descriptions.share);
  desktop += '<path d="M334 290H394" class="arrow"/><path d="M704 260H736V210H764" class="arrow"/><path d="M704 330H736V412H764" class="arrow"/>';
  desktop += '<path d="M180 376V474" class="arrow" stroke-dasharray="7 6"/>';
  desktop += box(32, 482, 670, 160, "Execution contract", descriptions.execute);
  desktop += text(772, 554, "Research complete", "label") + text(772, 594, "≠ Order authorized", "label");
  desktop += `<path d="M32 680H1088" stroke="${line}"/>` + text(32, 719, "Preserve observations; revise judgments as new evidence arrives.", "body");
  outputs["repo-ops-artifacts.svg"] = frame(1120, 752, "Report, sharing and execution boundaries", "Research inputs are verified, then yield separate private reports and public shares. Execution requires its own authorization.", desktop);
  let mobile = text(24, 48, "Reports, sharing, execution", "label") + text(24, 86, "Each artifact has its own evidence boundary", "muted");
  mobile += box(24, 116, 432, 162, "Research inputs", descriptions.input);
  mobile += '<path d="M240 280V310" class="arrow"/>';
  mobile += box(24, 318, 432, 162, "Verification", descriptions.verify);
  mobile += '<path d="M240 482V514H10V786H18M240 514V524" class="arrow"/>';
  mobile += box(24, 532, 432, 162, "Full report · Private", descriptions.report);
  mobile += box(24, 730, 432, 162, "Public share · Allowlist", descriptions.share);
  mobile += text(24, 946, "Research done ≠ Order authorized", "label");
  mobile += box(24, 974, 432, 162, "Execution contract", descriptions.execute);
  mobile += text(24, 1190, "Preserve observations; revise judgments.", "muted");
  outputs["repo-ops-artifacts-mobile.svg"] = frame(480, 1222, "Report, sharing and execution boundaries", "Verification yields a private report and an allowlisted public share. Neither authorizes live orders.", mobile);
  const directory = resolve(root, "docs/blog/agentic/images");
  await mkdir(directory, { recursive: true });
  await Promise.all(Object.entries(outputs).map(([name, svg]) => {
    if (/\p{Script=Han}/u.test(svg)) throw new Error(`Figure text must be English: ${name}`);
    return writeFile(resolve(directory, name), svg.replace('<svg xmlns=', '<svg xml:lang="en" xmlns='));
  }));
}
