import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mountApp } from "../components/app-shell.js";
import { renderComposer } from "../components/composer.js";
import { overviewContent } from "../components/overview.js";
import { iconButton, fieldRow } from "../components/ui.js";

const root = { innerHTML: "" };
mountApp(root);
const ids = [...root.innerHTML.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
assert.equal(
  ids.length,
  new Set(ids).size,
  "Component composition must not duplicate IDs",
);
for (const id of [
  "app",
  "projects",
  "sessionList",
  "stream",
  "overview",
  "composer",
  "input",
  "send",
  "cmdMenu",
  "modal",
  "modalBody",
])
  assert.ok(ids.includes(id), id);
assert.match(
  renderComposer(),
  /id="send"[^>]*type="submit"|type="submit"[^>]*id="send"/,
);
assert.match(renderComposer(), /aria-hidden="true">↵/);
assert.ok(
  !overviewContent(false).includes("300308.SZ"),
  "Empty session must not inherit fixture market data",
);
assert.ok(overviewContent(false).includes('id="closePanel"'));
assert.match(
  iconButton({ name: "copy", label: '"<img src=x>' }),
  /&quot;&lt;img src=x&gt;/,
);
assert.match(
  fieldRow({ label: "<script>", status: '"test"' }),
  /&lt;script&gt;/,
);
const sprite = readFileSync(
  new URL("../assets/lucide.svg", import.meta.url),
  "utf8",
);
for (const [, name] of root.innerHTML.matchAll(/lucide\.svg#([\w-]+)/g))
  assert.ok(sprite.includes(`id="${name}"`), `Missing icon ${name}`);
console.log(
  "Component composition, unique IDs, submit semantics, empty-state isolation, escaping and icon references passed.",
);

// Issue #80: one local refresh event, no repeated presentation metadata.
const overview = overviewContent();
assert.equal((overview.match(/Refresh:/g) || []).length, 1);
assert.equal((overview.match(/data-component="QuoteRow"/g) || []).length, 9);
assert.ok(!/quote-meta|SourceSummary|2026-10-23/.test(overview));
assert.match(overviewContent(false), /Refresh: —/);
for (const state of ["loading", "partial", "error", "timeout"]) {
  const retained = overviewContent(true, {
    state,
    refreshedAt: "2026-10-24 13:00",
  });
  assert.match(retained, /Refresh: 2026-10-24 13:00/);
  assert.equal((retained.match(/Refresh:/g) || []).length, 1);
  if (state !== "loading") assert.match(retained, /旧值/);
}
assert.ok(!overviewContent(false, { state: "error" }).includes("保留旧值"));
assert.match(root.innerHTML, /id="sourceStatus"[^>]*>本地合成 · 示例/);
assert.match(root.innerHTML, /lucide.svg#cpu/);
console.log(
  "Overview: compact rows, refresh semantics, retained-value states and source placement passed.",
);
