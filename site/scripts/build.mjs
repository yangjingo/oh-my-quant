import { cp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { loadContent, renderPage, renderRuntimeMessages, routes } from "./render.mjs";
import { articlePath, articleDirectory } from "./article.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const source = path.join(root, "public");
const output = path.join(root, "dist");
const allowed = new Set([
  "styles.css",
  "download.css",
  "app.js",
  "favicon.svg",
  "logo-mark.svg",
  "icons.svg",
  "licenses",
  "fonts",
]);
const files = await readdir(source);
const content = await loadContent();
// Validate all translations before replacing the previous build.
const pages = routes.map((route) => ({ route, html: renderPage(content, route) }));
for (const file of allowed) {
  if (!files.includes(file)) throw new Error(`Missing public asset: ${file}`);
}
for (const file of files) {
  if (!allowed.has(file)) throw new Error(`Unreviewed public asset: ${file}`);
}
if (
  path.dirname(output) !== path.resolve(root) ||
  path.basename(output) !== "dist"
) {
  throw new Error(`Unexpected output directory: ${output}`);
}
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const file of files)
  await cp(path.join(source, file), path.join(output, file), {
    recursive: true,
  });
for (const { route, html } of pages) {
  const directory = path.join(output, route.path);
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "index.html"), html);
}
await writeFile(path.join(output, "messages.js"), renderRuntimeMessages(content));
for (const directory of ["assets", "images"]) {
  await cp(path.join(articleDirectory, directory), path.join(output, articlePath, directory), { recursive: true });
}
console.log(
  `Built ${pages.length} localized pages and ${files.length} public entries → site/dist. No application data included.`,
);
