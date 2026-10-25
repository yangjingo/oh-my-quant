import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
const assets = join(import.meta.dirname, "../dist/assets");
const scripts = readdirSync(assets).filter(file => file.endsWith(".js"));
if (!scripts.length) throw new Error("Production build is missing");
for (const script of scripts) {
  const source = readFileSync(join(assets, script), "utf8");
  for (const marker of ["demo-run-", "demo-workspace", "quant-web.demo-preferences", "ws-sample-300308"]) {
    if (source.includes(marker)) throw new Error("Development fixture leaked into " + script + ": " + marker);
  }
}
console.log("Production bundle excludes the development client and synthetic session data.");
