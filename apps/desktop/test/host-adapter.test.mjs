import { test } from "node:test";
import { strict as assert } from "node:assert";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const project = resolve(desktop, "../..");

test("the isolated Windows Node adapter loads its bundled ownership addon", { skip: process.platform !== "win32" || process.arch !== "x64", timeout: 30_000 }, t => {
  const root = mkdtempSync(join(tmpdir(), "whyj-desktop-adapter-"));
  t.after(() => { assert.equal(dirname(root), resolve(tmpdir())); rmSync(root, { recursive: true, force: true }); });
  const adapter = join(root, "host-adapter.mjs"), addon = join(root, "host-koffi.node");
  const build = spawnSync("bun", ["build", join(desktop, "src/host-adapter.ts"), "--target=node", `--outdir=${root}`, "--entry-naming=host-adapter.mjs", "--asset-naming=host-[name].[ext]"], {
    cwd: project, encoding: "utf8", timeout: 20_000, windowsHide: true,
  });
  assert.equal(build.status, 0, build.stderr || build.stdout); assert.ok(existsSync(addon));
  // No node_modules is copied: a live synthetic owner forces the adapter to
  // acquire its startup lock before it refuses to start a second Host.
  const script = `import { randomUUID } from 'node:crypto'; import { mkdirSync, writeFileSync } from 'node:fs'; import { createRequire } from 'node:module';
    import { join } from 'node:path'; import { pathToFileURL } from 'node:url';
    const [adapter, root] = process.argv.slice(1), lock = join(root, '.host', 'owner.lock'), id = randomUUID();
    try { createRequire(pathToFileURL(adapter)).resolve('koffi'); throw new Error('Unexpected external koffi package'); }
    catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; }
    mkdirSync(lock, { recursive: true }); writeFileSync(join(lock, id + '.json'), JSON.stringify({ schemaVersion: 1, instanceId: id, pid: process.pid, startedAt: new Date().toISOString() }));
    const { connectWorkspaceHost } = await import(pathToFileURL(adapter).href);
    try { await connectWorkspaceHost({ workspaceRoot: root, executable: process.execPath, entrypoint: 'unused', timeoutMs: 1000 }); process.exitCode = 1; }
    catch (error) { if (error.code !== 'HOST_OWNER_NOT_READY') { console.error(error); process.exitCode = 1; } }`;
  const env = { ...process.env }; delete env.NODE_PATH;
  const child = spawnSync(process.execPath, ["--no-global-search-paths", "--input-type=module", "-e", script, adapter, join(root, "state")], {
    cwd: root, env, encoding: "utf8", timeout: 10_000, windowsHide: true,
  });
  assert.equal(child.status, 0, child.stderr || child.stdout);
});
