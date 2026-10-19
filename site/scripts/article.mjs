import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const articlePath = "/blog/vibe-repo-ops/";
export const articleDirectory = fileURLToPath(new URL("../content/blog/vibe-repo-ops/", import.meta.url));
const sha = (data) => createHash("sha256").update(data).digest("hex");

export async function loadArticle() {
  const manifest = JSON.parse(await readFile(path.join(articleDirectory, "manifest.json"), "utf8"));
  if (manifest.path !== articlePath || manifest.locale !== "zh-CN" || !manifest.files["index.html"]) throw new Error("Invalid article manifest");
  const actual = [];
  async function verify(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await verify(file);
      else {
        const relative = path.relative(articleDirectory, file).replaceAll("\\", "/");
        if (relative === "manifest.json") continue;
        if (!/^(index\.html|(?:assets|images)\/[^.].*)$/.test(relative)) throw new Error(`Unexpected article file: ${relative}`);
        if (manifest.files[relative] !== sha(await readFile(file))) throw new Error(`Stale article file: ${relative}. Run node site/scripts/prepare-blog.mjs`);
        actual.push(relative);
      }
    }
  }
  await verify(articleDirectory);
  if (actual.length !== Object.keys(manifest.files).length) throw new Error("Missing article assets");
  // A Vercel upload from site/ does not contain the repository's docs tree.
  const manuscript = new URL("../../docs/blog/agentic/vibe-repo-ops-merged-draft.md", import.meta.url);
  try {
    if (sha(await readFile(manuscript)) !== manifest.sourceSha256) throw new Error("Article source changed; run node site/scripts/prepare-blog.mjs");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  return readFile(path.join(articleDirectory, "index.html"), "utf8");
}
