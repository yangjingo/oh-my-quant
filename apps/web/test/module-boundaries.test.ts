import { expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

test("renderer has no service IO, prototype controllers or development imports outside bootstrap", () => {
  const root = join(import.meta.dir, "../src");
  for (const file of readdirSync(root, { recursive: true, encoding: "utf8" }).filter(file => /\.[cm]?[jt]sx?$/.test(file))) {
    const source = readFileSync(join(root, file), "utf8");
    expect(source, file).not.toMatch(/(?:from\s*|import\s*\()\s*["'](?:node:|bun:|.*prototypes\/|.*src\/(?:storage|source|runtime|agent)\/)/);
    if (file !== "main.tsx") expect(source, file).not.toMatch(/(?:from\s*|import\s*\()\s*["'][^"']*\/dev\//);
    expect(source, file).not.toMatch(/innerHTML\s*=|dangerouslySetInnerHTML|window\.quantPreview/);
  }
});
