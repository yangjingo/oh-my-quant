import { expect, test } from "bun:test";
import { join } from "node:path";

test("tool labels and command guidance match the selected shell", async () => {
  const modulePath = join(import.meta.dir, "../bash-tool.ts");
  const script = `import { bashTool } from ${JSON.stringify(modulePath)}; console.log(JSON.stringify({ label: bashTool.label, description: bashTool.description, command: bashTool.parameters.properties.command.description }));`;
  const cases = [
    { override: undefined, expected: process.platform === "win32" ? "PowerShell" : "Bash" },
    { override: " BaSh ", expected: "Bash" },
    { override: " GiT-BaSh ", expected: "Bash" },
  ];
  for (const { override, expected } of cases) {
    const env = { ...process.env };
    if (override === undefined) delete env.WHYJ_SHELL; else env.WHYJ_SHELL = override;
    const child = Bun.spawn([process.execPath, "-e", script], { env, stdout: "pipe", stderr: "pipe" });
    const watchdog = setTimeout(() => child.kill(), 10_000);
    try {
      const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
      expect({ exit, stderr }).toEqual({ exit: 0, stderr: "" });
      const result = JSON.parse(stdout);
      expect(result.label).toBe(expected);
      expect(result.description).toContain(`Use ${expected}`);
      expect(result.command).toContain(`Use ${expected}`);
      if (expected === "Bash") expect(result.description).not.toContain("Use PowerShell");
    } finally { clearTimeout(watchdog); child.kill(); await child.exited; }
  }
}, 40_000);
