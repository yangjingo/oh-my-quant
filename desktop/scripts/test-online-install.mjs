import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createReadStream, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildOnline } from "./build-online.mjs";

// This installs the real appId. Never emulate these flags on a developer account.
if (process.env.GITHUB_ACTIONS !== "true" || process.env.RUNNER_ENVIRONMENT !== "github-hosted") {
  throw new Error("Online installation acceptance requires a disposable GitHub-hosted Windows runner");
}
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const production = await buildOnline();
const payload = join(root, "release", production.payloadName);
const requests = [];
const server = createServer((request, response) => {
  requests.push(request.url);
  response.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Length": production.payloadBytes });
  if (request.url === "/corrupt") {
    // Same length, wrong content: exercises SHA-512, not just the size check.
    response.write(Buffer.from("NZ"));
    const stream = createReadStream(payload, { start: 2 });
    stream.pipe(response); response.on("close", () => stream.destroy());
  } else {
    const stream = createReadStream(payload);
    stream.pipe(response); response.on("close", () => stream.destroy());
  }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
try {
  const url = `http://127.0.0.1:${server.address().port}`;
  const installer = await buildOnline({ payload, testUrl: `${url}/payload`, testName: "installation" });
  const failure = await buildOnline({ payload, testUrl: `${url}/corrupt`, testName: "installed-failure" });
  assert.equal(installer.payloadSha512, production.payloadSha512);
  const code = await new Promise((resolve, reject) => {
    const child = spawn("pwsh", ["-NoProfile", "-File", join(root, "desktop/scripts/test-install.ps1"),
      "-InstallerPath", installer.output, "-FailureInstallerPath", failure.output], { stdio: "inherit", windowsHide: true });
    child.once("error", reject); child.once("exit", resolve);
  });
  assert.equal(code, 0, "Installed application acceptance failed");
  assert.equal(requests.filter(path => path === "/payload").length, 2, "Install and reinstall must both download the candidate");
  assert.equal(requests.filter(path => path === "/corrupt").length, 1);
  writeFileSync(join(root, "output/desktop-online/installation.json"), JSON.stringify({ production, installer, failure, requests,
    transport: "loopback HTTP; same payload SHA-512 as the production HTTPS entry", checks: ["online-install", "online-reinstall", "failed-download-preserves-installation", "installed-app-acceptance"] }, null, 2));
} finally {
  writeFileSync(join(root, "output/desktop-online/installation-downloads.json"), JSON.stringify({ requests, payloadSha512: production.payloadSha512 }, null, 2));
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
