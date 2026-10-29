import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("desktop first-run selects bundled public data without overwriting a saved source", async () => {
  const directory = mkdtempSync(join(tmpdir(), "whyj-desktop-defaults-"));
  try {
    const run = async () => {
      const child = Bun.spawn([process.execPath, "src/index.ts", "--json", "-c", "/config"], {
        env: { ...process.env, WHYJ_DESKTOP: "1", OHQUANT_DIR: directory }, stdout: "pipe", stderr: "pipe", timeout: 15000,
      });
      const [exit, out, error] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
      expect(error).toBe(""); expect(exit).toBe(0); expect(JSON.parse(out).ok).toBe(true);
      return JSON.parse(readFileSync(join(directory, "settings.json"), "utf8"));
    };
    const initial = await run();
    expect(initial.preferences.source).toBe("akshare");
    initial.preferences.source = "tushare";
    writeFileSync(join(directory, "settings.json"), JSON.stringify(initial));
    expect((await run()).preferences.source).toBe("tushare");
  } finally { rmSync(directory, { recursive: true, force: true }); }
}, 30000);
