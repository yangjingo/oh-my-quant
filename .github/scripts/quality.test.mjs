import { test } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { mkdirSync, mkdtempSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { parse } from "yaml";
import { checkPullRequest, primaryIssue, validateDescription } from "./pr-policy.mjs";
import { isOptionalPrivateEvidence } from "./documentation-links.mjs";
import { verifyReleaseTag } from "./desktop-release-tag.mjs";

const body = `Closes #17

## Outcome
Adds repeatable repository quality checks.
## Scope and Documentation
Automation only; docs/quant-harness/ci-release.md updated.
## Acceptance
The invalid policy examples fail.
## Verification
node --test .github/scripts/quality.test.mjs
## Visual Evidence
No user interface changes.
## Risks and Rollback
Revert automation; npm setup remains external.
`;
const files = ["docs/quant-harness/ci-release.md"];

test("accepts one issue and completed sections while ignoring examples", () => {
  assert.equal(validateDescription(body + "\n<!-- Fixes #99 -->\n```md\nCloses #88\n```\n`Fixes #77`", files), 17);
  assert.equal(validateDescription(body + "\n   ```md\nCloses #88\n   ````\n<!-- Fixes #99", files), 17);
});

for (const invalid of ["", "Closes #<issue>", "Closes #0", "Closes #17\nCloses #18", "Closes #17\nFixes #18", "Closes #17\nFixes: #18", "Closes #17, #18", "Closes owner/repo#17", "Closes https://github.com/owner/repo/issues/17", "<!-- Closes #17 -->", "```md\nCloses #17\n```", "   ```md\nCloses #17", "Closes #9007199254740992"]) {
  test(`rejects invalid primary issue: ${JSON.stringify(invalid)}`, () => {
    assert.throws(() => primaryIssue(invalid));
  });
}

test("rejects comment-only template sections and absent current docs", () => {
  assert.throws(() => validateDescription(body.replace("The invalid policy examples fail.", "<!-- Add acceptance evidence -->"), files), /Acceptance/);
  assert.throws(() => validateDescription(body, ["README.md"]), /docs/);
});

function api({ issue = { state: "open" }, other = [], listed = [{ filename: files[0], status: "modified" }], count = 1, snapshots = [{}], issueError } = {}) {
  const listFiles = Symbol("files");
  const list = Symbol("pulls");
  let reads = 0;
  return {
    rest: { pulls: { get: async () => ({ data: { body, changed_files: count, state: "open", head: { sha: "head" }, base: { sha: "base" },
      ...snapshots[Math.min(reads++, snapshots.length - 1)] } }), listFiles, list },
      issues: { get: async () => { if (issueError) throw issueError; return { data: issue }; } } },
    paginate: async method => method === listFiles ? listed : other,
  };
}
const check = options => checkPullRequest({ github: api(options), owner: "owner", repo: "repo", number: 20 });

test("validates a real open issue with no competing implementation PR", async () => {
  assert.equal(await check({ other: [{ number: 20, body }, { number: 21, body: "Refs #17" }] }), 17);
});

test("rejects PR references, closed issues, and competing implementation PRs", async () => {
  await assert.rejects(check({ issue: { state: "open", pull_request: {} } }), /open issue/);
  await assert.rejects(check({ issue: { state: "closed" } }), /open issue/);
  await assert.rejects(check({ other: [{ number: 21, body }] }), /active PR #21/);
});

test("rejects incomplete file pagination and documentation deletions", async () => {
  await assert.rejects(check({ count: 2 }), /every changed file/);
  await assert.rejects(check({ listed: [{ filename: files[0], status: "removed" }] }), /docs/);
});

test("closed PRs do not validate issues, including a merge during issue validation", async () => {
  assert.equal(await check({ snapshots: [{ state: "closed" }], issueError: new Error("must not fetch") }), null);
  assert.equal(await check({ snapshots: [{}, { state: "closed", merged: true }], issue: { state: "closed" } }), null);
  assert.equal(await check({ snapshots: [{}, { state: "closed" }], issueError: new Error("API unavailable") }), null);
});

test("revalidates edited metadata and rewritten heads instead of returning stale success", async () => {
  const invalid = { body: body.replace("Closes #17", "Closes #0") };
  await assert.rejects(check({ snapshots: [{}, invalid] }), /standalone/);
  assert.equal(await check({ snapshots: [invalid, {}] }), 17);
  await assert.rejects(check({ snapshots: [{}, { head: { sha: "new" }, changed_files: 2 }] }), /every changed file/);
  const changes = Array.from({ length: 6 }, (_, i) => ({ head: { sha: String(i) } }));
  await assert.rejects(check({ snapshots: changes }), /changed repeatedly/);
});

test("open PR API errors remain failures", async () => {
  await assert.rejects(check({ issueError: new Error("API unavailable") }), /API unavailable/);
});

test("target workflow pins trusted event code instead of a stale PR base or untrusted head", () => {
  const workflow = parse(readFileSync(new URL("../workflows/pr-policy.yml", import.meta.url), "utf8"));
  assert.ok(workflow.on.pull_request_target);
  const checkout = workflow.jobs.policy.steps.find(step => step.uses?.startsWith("actions/checkout@"));
  assert.equal(checkout.with.ref, "${{ github.sha }}");
  assert.equal(checkout.with["persist-credentials"], false);
  assert.ok(Object.values(workflow.permissions).every(value => value === "read"));
});

test("only repository-local output receipts are optional", () => {
  const root = resolve("fixture");
  assert.equal(isOptionalPrivateEvidence(root, resolve(root, "output/run/report.json")), true);
  for (const path of ["docs/missing.md", "src/missing.ts", "output-copy/report.json", "../output/report.json", "output/../docs/missing.md"]) {
    assert.equal(isOptionalPrivateEvidence(root, resolve(root, path)), false, path);
  }
});

test("the actual release guard accepts only main and the exact stable package", t => {
  const workflow = parse(readFileSync(new URL("../workflows/npm-publish.yml", import.meta.url), "utf8"));
  const step = workflow.jobs.validate.steps.find(step => step.name === "Validate release branch and version");
  const code = step.run.split("\n").slice(1, -2).join("\n");
  const directory = mkdtempSync(resolve(tmpdir(), "ohquant-release-guard-"));
  const manifest = resolve(directory, "package.json");
  t.after(() => { unlinkSync(manifest); rmdirSync(directory); });
  for (const [ref, input, version, name, succeeds] of [
    ["refs/heads/main", "1.4.0", "1.4.0", "whyj-quant", true],
    ["refs/heads/feature", "1.4.0", "1.4.0", "whyj-quant", false],
    ["refs/tags/v1.4.0", "1.4.0", "1.4.0", "whyj-quant", false],
    ["refs/heads/main", "1.4.1", "1.4.0", "whyj-quant", false],
    ["refs/heads/main", "1.4.0-rc.1", "1.4.0-rc.1", "whyj-quant", false],
    ["refs/heads/main", "1.4.0", "1.4.0", "other-package", false],
  ]) {
    writeFileSync(manifest, JSON.stringify({ name, version }));
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", code], {
      cwd: directory, encoding: "utf8", env: { ...process.env, GITHUB_REF: ref, RELEASE_VERSION: input },
    });
    assert.equal(result.status === 0, succeeds, `${ref} ${input} ${name}: ${result.stderr}`);
  }
});

test("desktop publishing rejects other branches, prereleases, and mismatched versions", t => {
  const workflow = parse(readFileSync(new URL("../workflows/desktop.yml", import.meta.url), "utf8"));
  const step = workflow.jobs.publish.steps.find(step => step.name === "Validate desktop release branch and version");
  const code = step.run.split("\n").slice(1, -2).join("\n");
  const directory = mkdtempSync(resolve(tmpdir(), "ohquant-desktop-guard-"));
  const desktop = resolve(directory, "apps/desktop"); mkdirSync(desktop, { recursive: true });
  t.after(() => {
    unlinkSync(resolve(desktop, "package.json")); unlinkSync(resolve(directory, "package.json"));
    rmdirSync(desktop); rmdirSync(resolve(directory, "apps")); rmdirSync(directory);
  });
  for (const [ref, cli, app, succeeds] of [
    ["refs/heads/main", "1.4.0", "1.4.0", true],
    ["refs/heads/feature", "1.4.0", "1.4.0", false],
    ["refs/tags/v1.4.0", "1.4.0", "1.4.0", false],
    ["refs/heads/main", "1.4.0", "1.4.1", false],
    ["refs/heads/main", "1.4.0-rc.1", "1.4.0-rc.1", false],
  ]) {
    writeFileSync(resolve(directory, "package.json"), JSON.stringify({ version: cli }));
    writeFileSync(resolve(desktop, "package.json"), JSON.stringify({ version: app }));
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", code], {
      cwd: directory, encoding: "utf8", env: { ...process.env, GITHUB_REF: ref },
    });
    assert.equal(result.status === 0, succeeds, `${ref} ${cli}/${app}: ${result.stderr}`);
  }
});

test("PRs always create desktop checks and only explicit dispatch may publish", () => {
  const workflow = parse(readFileSync(new URL("../workflows/desktop.yml", import.meta.url), "utf8"));
  assert.ok(Object.hasOwn(workflow.on, "pull_request"));
  assert.equal(workflow.on.pull_request, null);
  assert.equal(workflow.jobs.windows.name, "Desktop required");
  assert.equal(workflow.jobs.windows.if, undefined);
  assert.equal(workflow.jobs.publish.if, "github.event_name == 'workflow_dispatch' && inputs.publish_release");
  assert.deepEqual(workflow.jobs.publish.needs, ["checks", "windows"]);
  assert.equal(workflow.jobs.checks.uses, "./.github/workflows/ci.yml");
});

test("cross-entry validation remains required and the platform aggregate fails closed", () => {
  const ci = parse(readFileSync(new URL("../workflows/ci.yml", import.meta.url), "utf8"));
  assert.equal(ci.jobs.required.name, "CI required");
  assert.deepEqual(ci.jobs.required.needs, "check");
  assert.match(ci.jobs.required.if, /always\(\)/);
  assert.match(ci.jobs.required.steps[0].run, /CHECK_RESULT.*success/);
  const desktop = parse(readFileSync(new URL("../workflows/desktop.yml", import.meta.url), "utf8"));
  const bundle = desktop.jobs.windows.steps.find(step => step.name === "Bundle runtimes and installer");
  assert.match(bundle.run, /bun run test:entry-e2e\s+if \(\$LASTEXITCODE\) \{ exit \$LASTEXITCODE \}/);
  const evidence = desktop.jobs.windows.steps.find(step => step.with?.name === "desktop-evidence");
  assert.match(evidence.with.path, /output\/playwright\/entry-contracts/);
});

test("Desktop release tags must resolve to the tested installer source", () => {
  const current = "a".repeat(40), old = "b".repeat(40), tagObject = "c".repeat(40);
  const ref = "refs/tags/v1.4.0";
  for (const refs of ["", `${current}\t${ref}\n`, `${tagObject}\t${ref}\n${current}\t${ref}^{}\n`])
    assert.doesNotThrow(() => verifyReleaseTag("1.4.0", current, tag => { assert.equal(tag, ref); return refs; }));
  for (const refs of [`${old}\t${ref}\n`, `${tagObject}\t${ref}\n${old}\t${ref}^{}\n`])
    assert.throws(() => verifyReleaseTag("1.4.0", current, () => refs), /tested build/);
  assert.throws(() => verifyReleaseTag("1.4.0", current, () => { throw new Error("remote lookup failed"); }), /remote lookup failed/);
  assert.throws(() => verifyReleaseTag("1.4.0", current, () => "invalid remote output"), /Unexpected/);
  assert.throws(() => verifyReleaseTag("1.4.0", undefined, () => ""), /exact tested commit/);
});

test("Desktop publication runs the tag guard before creating a Release", () => {
  const workflow = parse(readFileSync(new URL("../workflows/desktop.yml", import.meta.url), "utf8"));
  const command = workflow.jobs.publish.steps.find(step => step.name === "Publish the tested installer").run;
  const guard = command.indexOf("node .github/scripts/desktop-release-tag.mjs");
  assert.ok(guard >= 0 && guard < command.indexOf("gh release create"));
});
