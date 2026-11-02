import { strict as assert } from "node:assert";
import { test } from "node:test";
import { compare, isTargetFailure } from "./desktop-failure-comparison.mjs";

test("only a target Desktop timeout invokes the comparison", () => {
  const target = "✖ Windows shortcut resources and Shell icons match the shared brand\nError: spawnSync pwsh ETIMEDOUT";
  assert.equal(isTargetFailure(target), true);
  assert.equal(isTargetFailure("\x1b[31m✖ Windows query finds a live child and observes its exit\x1b[0m\nETIMEDOUT"), true);
  for (const other of ["passed Windows shortcut resources and Shell icons match the shared brand", "✖ unrelated test\nETIMEDOUT", "✖ Windows query finds a live child and observes its exit\nassertion failed"]) {
    assert.equal(isTargetFailure(other), false);
    assert.deepEqual(compare(other, () => { throw new Error("must not run"); }), { status: "not-applicable" });
  }
});

test("comparison preserves bounded original tests and reports only allowed aggregates", () => {
  const target = "✖ Windows query finds a live child and observes its exit\nETIMEDOUT";
  let called = false, tick = 0;
  const result = compare(target, (file, args, options) => {
    called = true;
    assert.equal(file, process.execPath);
    assert.ok(args.includes("--test-concurrency=1"));
    assert.ok(args.includes("apps/desktop/test/shell-icons.test.mjs"));
    assert.ok(args.includes("apps/desktop/test/smoke.test.mjs"));
    assert.equal(options.timeout, 90000);
    return { status: 1, stdout: "# pass 9\n# fail 2\nWHYJ_ICON_STAGE=start\nPRIVATE_PATH", stderr: "SECRET_DATA" };
  }, () => tick += 42, { node: 3, bun: 1, pwsh: 2, powershell: 4, other: "SECRET_DATA" });
  assert.equal(called, true);
  assert.deepEqual(result, { status: "compared", exitCode: 1, signal: null, timedOut: false, elapsedMs: 42,
    processCounts: { node: 3, bun: 1, pwsh: 2, powershell: 4 }, passed: 9, failed: 2, stages: ["WHYJ_ICON_STAGE=start"] });
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_PATH|SECRET_DATA/);
});

test("a timed-out comparison is reported as a failure without raw output", () => {
  const target = "✖ Windows query finds a live child and observes its exit\nETIMEDOUT";
  const result = compare(target, () => ({ status: null, signal: "SIGTERM", error: { code: "ETIMEDOUT" }, stderr: "SECRET_DATA" }), () => 100);
  assert.equal(result.status, "compared"); assert.equal(result.timedOut, true); assert.equal(result.exitCode, null);
  assert.equal(result.passed, null); assert.equal(result.failed, null);
  assert.doesNotMatch(JSON.stringify(result), /SECRET_DATA/);
});
