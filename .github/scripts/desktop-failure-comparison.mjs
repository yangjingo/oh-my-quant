import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const color = /\x1b\[[0-9;]*m/g;
const targetFailure = /✖ Windows (?:shortcut resources and Shell icons match the shared brand|query finds a live child and observes its exit)/;
const allowedStages = new Set(["WHYJ_ICON_STAGE=start", "WHYJ_ICON_STAGE=helper-enter", "WHYJ_ICON_STAGE=helper-drawing-load", "WHYJ_ICON_STAGE=helper-interop-init", "WHYJ_ICON_STAGE=helper-interop-ready", "WHYJ_ICON_STAGE=helper-loaded", "WHYJ_ICON_STAGE=shortcut-checks-complete",
  "WHYJ_ICON_STAGE=large-start", "WHYJ_ICON_STAGE=large-complete", "WHYJ_ICON_STAGE=small-start", "WHYJ_ICON_STAGE=small-complete",
  ...["large", "small"].flatMap(size => ["shell-read", "overlay-compare", "overlay-record", "mismatch-compare", "mismatch-record", "evidence-read", "final-record"].map(phase => `WHYJ_ICON_STAGE=${size}-${phase}`)),
  "WHYJ_QUERY_STAGE=start", "WHYJ_QUERY_STAGE=enumerated"]);

export function isTargetFailure(log) {
  const plain = log.replace(color, "");
  return targetFailure.test(plain) && plain.includes("ETIMEDOUT");
}

export function compare(log, run = spawnSync, now = () => performance.now(), counts = {}) {
  if (!isTargetFailure(log)) return { status: "not-applicable" };
  const allowed = ["node", "bun", "pwsh", "powershell"];
  const processCounts = Object.fromEntries(allowed.map(name => [name, Number.isSafeInteger(counts[name]) && counts[name] >= 0 ? counts[name] : null]));
  const start = now();
  const result = run(process.execPath, ["--test", "--test-concurrency=1", "--test-reporter=tap",
    "apps/desktop/test/shell-icons.test.mjs", "apps/desktop/test/smoke.test.mjs"],
  { encoding: "utf8", windowsHide: true, timeout: 90000, maxBuffer: 4 * 1024 * 1024 });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.replace(color, "");
  const stages = [...output.matchAll(/WHYJ_(?:ICON|QUERY)_STAGE=[a-z-]+/g)].map(match => match[0]).filter(stage => allowedStages.has(stage));
  const total = name => { const match = output.match(new RegExp(`^# ${name} (\\d+)$`, "m")); return match ? Number(match[1]) : null; };
  return { status: "compared", exitCode: result.status, signal: result.signal ?? null,
    timedOut: result.error?.code === "ETIMEDOUT", elapsedMs: Math.round(now() - start),
    processCounts, passed: total("pass"), failed: total("fail"), stages };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const counts = JSON.parse(process.env.WHYJ_CI_PROCESS_COUNTS ?? "{}");
    const result = compare(readFileSync(process.argv[2], "utf8"), spawnSync, undefined, counts);
    writeFileSync(process.argv[3], JSON.stringify(result, null, 2) + "\n");
    console.log("Desktop failure comparison:", JSON.stringify(result));
  } catch {
    // The original failed gate remains authoritative even if diagnostics fail.
    console.error("Desktop failure comparison could not be recorded.");
  }
}
