// Generate the approved article for the independent Node-only site build.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../../", import.meta.url));
const relative = "site/content/blog/vibe-repo-ops";
const output = path.resolve(root, relative);
if (path.dirname(output) !== path.resolve(root, "site/content/blog")) throw new Error("Invalid article staging path");
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
const result = spawnSync("bun", ["run", "site/previews/vibe-repo-ops/build.ts"], {
  cwd: root,
  env: { ...process.env, BLOG_PREVIEW_OUTPUT: relative, BLOG_PUBLISH: "1" },
  stdio: "inherit",
});
if (result.error) throw result.error;
if (result.status !== 0) throw new Error("Article generation failed");
// Deployment configuration belongs to the website, not the article route.
await rm(path.join(output, "vercel.json"));
const sha = (data) => createHash("sha256").update(data).digest("hex");
const files = {};
async function inventory(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await inventory(file);
    else files[path.relative(output, file).replaceAll("\\", "/")] = sha(await readFile(file));
  }
}
await inventory(output);
const source = "docs/blog/agentic/vibe-repo-ops-merged-draft.md";
await writeFile(path.join(output, "manifest.json"), JSON.stringify({
  source,
  sourceSha256: sha(await readFile(path.join(root, source))),
  designCommit: "10184e1a2ad99d976c33e6c55d6872d7083fe827",
  locale: "zh-CN",
  translationStatus: "Chinese original; English translation not published",
  path: "/blog/vibe-repo-ops/",
  files,
}, null, 2) + "\n");
console.log(`Prepared ${Object.keys(files).length} public article files with source and output hashes.`);
