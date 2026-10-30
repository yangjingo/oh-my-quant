import { expect, it } from "bun:test";
import { mkdtempSync, existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { launchHostProcess } from "../process.ts";

const fixture = join(import.meta.dir, "fixtures/delayed-broker.ps1");
const entry = join(import.meta.dir, "fixtures/slow-broker-child.ts");
async function waitDone(root: string) {
  const deadline = Date.now() + 8000;
  while (!existsSync(join(root, "broker-done")) && Date.now() < deadline) await Bun.sleep(25);
  expect(existsSync(join(root, "broker-done"))).toBe(true);
  const path = join(root, "child-pid");
  if (existsSync(path)) {
    const pid = Number(readFileSync(path, "utf8"));
    expect(() => process.kill(pid, 0)).toThrow();
  }
}
function removeFixture(root: string) {
  expect(dirname(root)).toBe(resolve(tmpdir()));
  expect(basename(root)).toStartWith("whyj-broker-");
  rmSync(root, { recursive: true, force: true });
}

it.skipIf(process.platform !== "win32")("uses the caller's remaining budget for a slow broker and kills its owned child", async () => {
  const root = mkdtempSync(join(tmpdir(), "whyj-broker-"));
  let child: Awaited<ReturnType<typeof launchHostProcess>> | undefined, stopped = false;
  try {
    child = await launchHostProcess(process.execPath, entry, root, 6000, fixture);
    expect(child.pid).toBeGreaterThan(0);
    child.kill(); stopped = true;
    await waitDone(root);
  } finally {
    if (child && !stopped) child.kill();
    if (!existsSync(join(root, "broker-done"))) await waitDone(root);
    removeFixture(root);
  }
}, 12000);

it.skipIf(process.platform !== "win32")("enforces the caller's short budget and drains a late broker", async () => {
  const root = mkdtempSync(join(tmpdir(), "whyj-broker-"));
  try {
    const start = performance.now();
    await expect(launchHostProcess(process.execPath, entry, root, 200, fixture)).rejects.toThrow("did not respond");
    expect(performance.now() - start).toBeLessThan(2000);
    await waitDone(root);
  } finally {
    if (!existsSync(join(root, "broker-done"))) await waitDone(root);
    removeFixture(root);
  }
}, 12000);
