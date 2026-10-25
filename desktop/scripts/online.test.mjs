import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildOnline, ONLINE_LIMIT_BYTES, onlineIdentity } from "./build-online.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
test("production identity is immutable HTTPS; test endpoints cannot become release assets", () => {
  const prod = onlineIdentity("1.4.0");
  assert.equal(prod.url, "https://github.com/yangjingo/oh-my-quant/releases/download/v1.4.0/WhyJ-Quant-Setup-1.4.0-win-x64.exe");
  for (const version of ["1.4", "1.4.0/latest", "1.4.0-rc", '1.4.0"']) assert.throws(() => onlineIdentity(version));
  for (const url of ["https://evil.example/payload", "http://localhost:1234/payload", "http://127.0.0.1/payload", "http://user@127.0.0.1:1234/payload", "http://127.0.0.1:1234/payload?token=x"]) assert.throws(() => onlineIdentity("1.4.0", url));
  const fixture = onlineIdentity("1.4.0", "http://127.0.0.1:1234/payload");
  assert.equal(fixture.testOnly, true);
  assert.ok(fixture.output.startsWith(join(root, "output/desktop-online")) && fixture.output.endsWith("-test.exe"));
  assert.throws(() => onlineIdentity("1.4.0", "http://127.0.0.1:1234/payload", "../../release/setup"));
});

test("real online executable verifies before launch, forwards arguments and propagates exit status", { skip: process.platform !== "win32", timeout: 120000 }, async () => {
  const evidence = join(root, "output/desktop-online/fixture");
  mkdirSync(evidence, { recursive: true });
  const fixture = join(evidence, "payload.exe"), marker = join(evidence, "executed.txt");
  const requested = join(evidence, "download-requested.txt");
  // A harmless Win32 fixture, not the application installer. No application/registry changes.
  const source = join(evidence, "fixture.cs");
  writeFileSync(source, 'using System; using System.IO; class Fixture { static int Main() { File.WriteAllText(Environment.GetEnvironmentVariable("WHYJ_FIXTURE_MARKER"), Environment.CommandLine); return int.Parse(Environment.GetEnvironmentVariable("WHYJ_FIXTURE_EXIT") ?? "0"); } }');
  execFileSync(join(process.env.SystemRoot, "Microsoft.NET/Framework64/v4.0.30319/csc.exe"), ["/nologo", "/target:winexe", `/out:${fixture}`, source], { windowsHide: true });
  const bytes = readFileSync(fixture);
  let mode = "missing", requests = 0;
  const server = createServer((_request, response) => {
    requests++;
    if (mode === "missing") { response.writeHead(404); response.end("missing"); return; }
    if (mode === "disconnected") { response.destroy(); return; }
    if (mode === "slow") {
      response.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Length": bytes.length });
      response.write(bytes.subarray(0, 1));
      writeFileSync(requested, "download started");
      return; // The interactive cancel test must close this pending download.
    }
    const body = mode === "truncated" ? bytes.subarray(0, 128) : Buffer.from(bytes);
    if (mode === "corrupt") body[body.length - 1] ^= 1;
    response.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Length": body.length });
    response.end(body);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const checks = [];
  try {
    const receipt = await buildOnline({ payload: fixture, testUrl: `http://127.0.0.1:${port}/payload`, testName: "fixture" });
    assert.ok(receipt.onlineBytes < ONLINE_LIMIT_BYTES);
    const run = (exit = "0") => new Promise((resolve, reject) => {
      const child = spawn(receipt.output, ["/S", "/currentuser", "/D=D:\\安装 验收\\WhyJ Quant"], {
        env: { ...process.env, WHYJ_FIXTURE_MARKER: marker, WHYJ_FIXTURE_EXIT: exit }, windowsHide: true, stdio: "ignore",
      });
      const timer = setTimeout(() => { child.kill(); reject(new Error("Online fixture timed out")); }, 25000);
      child.once("error", error => { clearTimeout(timer); reject(error); });
      child.once("exit", code => { clearTimeout(timer); resolve(code); });
    });
    for (const failure of ["missing", "disconnected", "truncated", "corrupt"]) {
      mode = failure;
      writeFileSync(marker, "existing application sentinel");
      assert.equal(await run(), 2, failure);
      assert.equal(readFileSync(marker, "utf8"), "existing application sentinel", `${failure} executed an unverified payload`);
      checks.push(failure);
    }
    mode = "valid";
    assert.equal(await run(), 0);
    const args = readFileSync(marker, "utf8");
    assert.ok(args.includes("/S") && args.includes("/currentuser") && args.includes("安装 验收\\WhyJ Quant"));
    checks.push("verified-download-and-arguments");
    assert.equal(await run("7"), 7);
    checks.push("child-exit-status");
    assert.ok(requests >= 6);
    if (process.env.GITHUB_ACTIONS === "true" && process.env.RUNNER_ENVIRONMENT === "github-hosted") {
      mode = "slow";
      writeFileSync(requested, "waiting");
      writeFileSync(marker, "existing application sentinel");
      const code = await new Promise((resolve, reject) => {
        const child = spawn("pwsh", ["-NoProfile", "-File", join(root, "desktop/scripts/test-online-ui.ps1"),
          "-Installer", receipt.output, "-Requested", requested], {
          env: { ...process.env, WHYJ_FIXTURE_MARKER: marker, WHYJ_FIXTURE_EXIT: "0" }, stdio: "inherit", windowsHide: true,
        });
        child.once("error", reject); child.once("exit", resolve);
      });
      assert.equal(code, 0, "Interactive cancellation acceptance failed");
      assert.equal(readFileSync(marker, "utf8"), "existing application sentinel", "Cancellation launched the payload");
      checks.push("interactive-download-cancel");
    }
    writeFileSync(join(evidence, "result.json"), JSON.stringify({ checks, requests, receipt }, null, 2));
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
