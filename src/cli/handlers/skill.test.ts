import { describe, expect, it } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { skillHandler } from "../../skill/handler.ts";
import { installSkills, SKILLS_DIR, skillPaths } from "../../skill/store.ts";

describe("skillHandler", () => {
  it("lists skills (or reports none found)", async () => {
    const result = await skillHandler({}, [], {});
    expect(result.success).toBe(true);
    expect(result.message).toBeDefined();
    expect(
      result.message!.includes("Skills") || result.message!.includes("No skills found"),
    ).toBe(true);
  });

  it("shows error for missing name on info", async () => {
    const result = await skillHandler({}, ["info"], {});
    expect(result.success).toBe(false);
    expect(result.message).toContain("/skill info <name>");
  });

  it("shows error for info on unknown skill", async () => {
    const result = await skillHandler({}, ["info", "nonexistent-skill-xyz"], {});
    expect(result.success).toBe(false);
    expect(result.message).toContain("Unknown skill");
  });

  it("shows error for run without agent session", async () => {
    const result = await skillHandler({}, ["run", "some-skill"], {});
    expect(result.success).toBe(false);
    expect(result.message).toContain("active agent session");
  });

  it("rejects run with missing skill name", async () => {
    const result = await skillHandler({}, ["run"], {});
    expect(result.success).toBe(false);
    expect(result.message).toContain("/skill");
  });

  it("rejects direct /skill:name invocation for unknown skill", async () => {
    const result = await skillHandler({}, ["nonexistent-skill-xyz"], {});
    expect(result.success).toBe(false);
    expect(result.message).toContain("Unknown skill");
  });

  it("shows usage for install without repo", async () => {
    const result = await skillHandler({}, ["install"], {});
    expect(result.success).toBe(false);
    expect(result.message).toContain("/skill install");
  });

  it("rejects invalid install repo format before invoking git", () => {
    const result = installSkills("not-a-github-repo");
    expect(result.success).toBe(false);
    expect(result.message).toContain("owner/repo");
  });

  it("discovers installed repo skills from nested skills directories", () => {
    const repoDir = join(SKILLS_DIR, "__skillpaths-test-repo__");
    mkdirSync(join(repoDir, "skills"), { recursive: true });
    mkdirSync(join(repoDir, "examples", "skills"), { recursive: true });
    try {
      const paths = skillPaths();
      expect(paths).toContain(join(repoDir, "skills"));
      expect(paths).not.toContain(repoDir);
    } finally {
      rmSync(repoDir, { recursive: true, force: true });
    }
  });
});
