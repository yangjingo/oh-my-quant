import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

for (const scenario of ["timeout", "provider-startup-failure", "provider-stop-failure"] as const) test(`Workbench naming ${scenario} restores the environment before the next test`, async () => {
  const tempRoot = resolve(tmpdir());
  const root = mkdtempSync(join(tempRoot, "whyj-summary-lifetime-"));
  if (dirname(root) !== tempRoot || !basename(root).startsWith("whyj-summary-lifetime-")) throw new Error("Unexpected temporary path");
  try {
    const source = readFileSync(new URL("./workbench-summary.test.ts", import.meta.url), "utf8");
    const target = 'process.env.OHQUANT_DIR = root; process.env.NO_PROXY = "127.0.0.1,localhost";';
    const anchor = "const fixtureLifetime = createFixtureLifetime();";
    expect(source.split(target)).toHaveLength(2);
    expect(source.split(anchor)).toHaveLength(2);
    expect(source).toMatch(/\}\)\);\s*$/);
    let controlled = source.replace(/from "(\.\.\/\.\.\/[^\"]+)"/g,
      (_match, specifier: string) => `from ${JSON.stringify(fileURLToPath(new URL(specifier, import.meta.url)))}`);
    controlled = controlled.replace('"../../apps/web/src/state/workbench-store"',
      JSON.stringify(fileURLToPath(new URL("../../apps/web/src/state/workbench-store", import.meta.url))));
    const injection = scenario === "timeout" ? "await Bun.sleep(300);" : scenario === "provider-startup-failure" ? 'throw new Error("CONTROLLED_PROVIDER_FAILURE");' : "";
    controlled = controlled.replace(anchor, `const controlledBaseline = process.env.OHQUANT_DIR, controlledProxy = process.env.NO_PROXY;\n${anchor}`)
      .replace(target, `${target} console.log("SUMMARY_OVERRIDE_SET"); ${injection}`);
    if (scenario === "timeout") controlled = controlled.replace(/\}\)\);\s*$/, "}), 50);");
    if (scenario === "provider-stop-failure") {
      const stop = "try { await provider?.stop(true); }";
      expect(controlled.split(stop)).toHaveLength(2);
      controlled = controlled.replace(stop, 'try { await provider?.stop(true); throw new Error("CONTROLLED_PROVIDER_STOP_FAILURE"); }');
    }
    controlled += `\ntest("following test observes restored state", () => {\n  console.log("SUMMARY_FOLLOWING=" + (process.env.OHQUANT_DIR === controlledBaseline ? "restored" : "leaked"));\n  console.log("SUMMARY_PROXY=" + (process.env.NO_PROXY === controlledProxy ? "restored" : "leaked"));\n});\n`;
    const fixture = join(root, "controlled.test.ts");
    writeFileSync(fixture, controlled);
    const child = Bun.spawn({ cmd: [process.execPath, "test", fixture], cwd: root,
      env: { ...process.env, OHQUANT_DIR: join(root, "baseline"), NO_PROXY: "summary-control.invalid", TMPDIR: root, TMP: root, TEMP: root },
      stdout: "pipe", stderr: "pipe", timeout: 35000 });
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    const output = stdout + stderr;
    expect(code).toBe(1); // The first test intentionally fails.
    if (scenario === "timeout") {
      expect(output).toContain("timed out after 50ms");
      expect(output).toContain('WHYJ_WORKBENCH_SUMMARY_PENDING {"phase":"setup","modelRequests":0}');
    } else expect(output).toContain(scenario === "provider-startup-failure" ? "CONTROLLED_PROVIDER_FAILURE" : "CONTROLLED_PROVIDER_STOP_FAILURE");
    expect(output).toContain("SUMMARY_OVERRIDE_SET");
    expect(output).toContain("SUMMARY_FOLLOWING=restored");
    expect(output).toContain("SUMMARY_PROXY=restored");
    expect(output).not.toContain("SUMMARY_FOLLOWING=leaked");
    expect(output).not.toContain("SUMMARY_PROXY=leaked");
    expect(output).toContain("(pass) following test observes restored state");
  } finally { rmSync(root, { recursive: true, force: true }); }
}, 40000);
