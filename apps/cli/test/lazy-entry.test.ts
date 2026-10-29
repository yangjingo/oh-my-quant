import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";

test("both entries keep help, version and one-shot help independent of TUI and Host initialization", async () => {
  const root = mkdtempSync(join(tmpdir(), "whyj-lazy-entry-"));
  const preload = join(root, "reject-entry-load.ts");
  writeFileSync(join(root, "settings.json"), "MALFORMED_SETTINGS");
  writeFileSync(preload, `import { plugin } from "bun";
    plugin({ name: "reject-ui-host-load", setup(build) {
      build.onLoad({ filter: /[\\\\/]apps[\\\\/]tui[\\\\/]|[\\\\/]app[\\\\/]bootstrap\\.ts$|[\\\\/]app[\\\\/]host[\\\\/]/ }, () => {
        throw new Error("Help/one-shot must not load TUI or Host");
      });
    }});`);
  try {
    for (const entry of ["src/index.ts", "apps/cli/src/index.ts"]) {
      for (const args of [["--version"], ["--json", "--help"], ["--json", "-c", "/help"]]) {
        const child = Bun.spawn([process.execPath, "--preload", preload, entry, ...args], {
          cwd: resolve(import.meta.dir, "../../.."), env: { ...process.env, OHQUANT_DIR: root },
          stdout: "pipe", stderr: "pipe", timeout: 10000,
        });
        const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
        expect({ entry, args, code, err }).toMatchObject({ code: 0, err: "" });
        expect(out).not.toContain("\x1b");
        if (args.includes("--json")) expect(JSON.parse(out).ok).toBe(true);
      }
    }
    expect(readFileSync(join(root, "settings.json"), "utf8")).toBe("MALFORMED_SETTINGS");
    expect(existsSync(join(root, ".host"))).toBe(false);
  } finally {
    if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unexpected test directory");
    rmSync(root, { recursive: true, force: true });
  }
}, 60000);
