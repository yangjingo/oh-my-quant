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

test("argument errors and detailed help do not load the tool execution graph", async () => {
  const root = mkdtempSync(join(tmpdir(), "whyj-preflight-entry-"));
  const preload = join(root, "reject-tool-graph.ts");
  writeFileSync(join(root, "settings.json"), "MALFORMED_SETTINGS");
  writeFileSync(preload, `import { plugin } from "bun";
    plugin({ name: "reject-tool-graph", setup(build) {
      build.onLoad({ filter: /[\\\\/]runtime[\\\\/]data[\\\\/]tool-probe-catalog\\.ts$/ }, () => {
        throw new Error("TOOL_GRAPH_LOADED");
      });
    }});`);
  try {
    for (const entry of ["src/index.ts", "apps/cli/src/index.ts"]) {
      for (const [input, ok] of [["/config --pi apply", false], ["/doctor --phase data,typo", false], ["/help config", true]] as const) {
        const child = Bun.spawn([process.execPath, "--preload", preload, entry, "--json", "-c", input], {
          cwd: resolve(import.meta.dir, "../../.."), env: { ...process.env, OHQUANT_DIR: root },
          stdout: "pipe", stderr: "pipe", timeout: 10000,
        });
        const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
        expect({ entry, input, code, err }).toMatchObject({ code: ok ? 0 : 1, err: "" });
        const result = JSON.parse(out);
        expect(result.ok).toBe(ok);
        if (!ok) expect(result.error.code).toBe("command_failed");
        else expect(result.data.name).toBe("/config");
      }
    }
    // Confirm the guard really detects the graph on a schema query that needs it.
    const schema = Bun.spawn([process.execPath, "--preload", preload, "src/index.ts", "--json", "-c", "/doctor --tool search_symbols --market A --schema"], {
      cwd: resolve(import.meta.dir, "../../.."), env: { ...process.env, OHQUANT_DIR: root }, stdout: "pipe", stderr: "pipe", timeout: 10000,
    });
    const [schemaOut, schemaError, schemaCode] = await Promise.all([new Response(schema.stdout).text(), new Response(schema.stderr).text(), schema.exited]);
    expect(schemaCode).not.toBe(0); expect(schemaOut).toBe(""); expect(schemaError).toContain("TOOL_GRAPH_LOADED");
    expect(readFileSync(join(root, "settings.json"), "utf8")).toBe("MALFORMED_SETTINGS");
    expect(existsSync(join(root, ".host"))).toBe(false);
  } finally {
    if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unexpected test directory");
    rmSync(root, { recursive: true, force: true });
  }
}, 60000);
