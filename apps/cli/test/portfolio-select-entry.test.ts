import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";

test("one-shot portfolio selection persists a quoted name or ID and rejects invalid choices without mutation", async () => {
  const root = mkdtempSync(join(tmpdir(), "whyj-portfolio-select-")), path = join(root, "panel-portfolio.json");
  const original = { updated: "2026-10-29", symbols: [], activeGroupId: "first", groups: [
    { id: "first", name: "First group", symbolCodes: [] }, { id: "second", name: "Second group", symbolCodes: [] },
  ] };
  writeFileSync(path, JSON.stringify(original));
  async function command(text: string) {
    const child = Bun.spawn([process.execPath, "src/index.ts", "--json", "-c", text], { cwd: resolve(import.meta.dir, "../../.."),
      env: { ...process.env, OHQUANT_DIR: root }, stdout: "pipe", stderr: "pipe", timeout: 10000 });
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect(stderr).toBe(""); return { code, value: JSON.parse(stdout) };
  }
  try {
    const byName = await command('/portfolio select "Second group"');
    expect(byName.code).toBe(0); expect(byName.value).toMatchObject({ ok: true, command: "portfolio", data: { activeGroupId: "second" } });
    expect(JSON.parse(readFileSync(path, "utf8")).activeGroupId).toBe("second");
    const byId = await command("/portfolio select first");
    expect(byId.code).toBe(0); expect(byId.value.data.activeGroupId).toBe("first");
    const bytes = readFileSync(path, "utf8");
    for (const input of ["/portfolio select", "/portfolio select first extra", "/portfolio select missing"]) {
      const result = await command(input);
      expect(result.code).toBe(1); expect(result.value.ok).toBe(false);
      expect(result.value.error.message).toContain(input.endsWith("missing") ? "not found or is ambiguous" : "Invalid portfolio action");
      expect(readFileSync(path, "utf8")).toBe(bytes);
    }
    const ambiguous = { ...original, groups: original.groups.map(group => ({ ...group, name: "Duplicate" })) };
    writeFileSync(path, JSON.stringify(ambiguous)); const before = readFileSync(path, "utf8");
    const duplicate = await command('/portfolio select "Duplicate"');
    expect(duplicate.code).toBe(1); expect(duplicate.value.error.message).toContain("not found or is ambiguous");
    expect(readFileSync(path, "utf8")).toBe(before);
    expect(existsSync(join(root, ".host"))).toBe(false);
    const sessions = join(root, "sessions");
    expect(existsSync(sessions) ? readdirSync(sessions, { recursive: true }).filter(name => String(name).endsWith(".jsonl")) : []).toEqual([]);
  } finally {
    if (!resolve(root).startsWith(resolve(tmpdir()) + sep + "whyj-portfolio-select-")) throw new Error("Unexpected portfolio test directory");
    rmSync(root, { recursive: true, force: true });
  }
}, 30000);
