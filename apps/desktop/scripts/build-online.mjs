import { createHash } from "node:crypto";
import { createReadStream, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const desktop = join(root, "apps/desktop");
export const ONLINE_LIMIT_BYTES = 50_000_000;
const quote = value => String(value).replaceAll("$", () => "$$").replaceAll('"', '$\\"');

export function onlineIdentity(version, testUrl, testName = "fixture") {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) throw new Error("A stable version is required");
  const payloadName = `WhyJ-Quant-Setup-${version}-win-x64.exe`;
  const url = `https://github.com/yangjingo/oh-my-quant/releases/download/v${version}/${payloadName}`;
  if (testUrl !== undefined) {
    const parsed = new URL(testUrl);
    if (parsed.protocol !== "http:" || parsed.hostname !== "127.0.0.1" || !parsed.port || parsed.username || parsed.password
      || parsed.search || parsed.hash || !/^[a-z0-9-]+$/.test(testName)) throw new Error("Tests require an explicit loopback URL and safe test name");
    return { version, payloadName, url: parsed.href, output: join(root, "output/desktop-online", `online-${testName}-test.exe`), testOnly: true };
  }
  return { version, payloadName, url, output: join(root, "release", `WhyJ-Quant-Online-${version}-win-x64.exe`), testOnly: false };
}

export async function buildOnline({ payload, testUrl, testName } = {}) {
  const version = JSON.parse(readFileSync(join(desktop, "package.json"), "utf8")).version;
  const identity = onlineIdentity(version, testUrl, testName);
  payload = resolve(payload ?? join(root, "release", identity.payloadName));
  if (!identity.testOnly && basename(payload) !== identity.payloadName) throw new Error("Payload filename must match the release version");
  const payloadBytes = statSync(payload).size;
  if (payloadBytes < 2 || payloadBytes >= 2 ** 31) throw new Error("Payload must be a nonempty installer below 2 GiB");
  const hash = createHash("sha512");
  let prefix;
  for await (const chunk of createReadStream(payload)) { prefix ??= chunk.subarray(0, 2).toString(); hash.update(chunk); }
  if (prefix !== "MZ") throw new Error("Payload must be a Windows executable");
  const sha512 = hash.digest("hex").toUpperCase();
  const require = createRequire(join(desktop, "package.json"));
  const { getMakeNsisPath, getNsisPluginsPath } = require("app-builder-lib/out/toolsets/windows.js");
  const { nsisTemplatesDir } = require("app-builder-lib/out/targets/nsis/nsisUtil.js");
  const compiler = await getMakeNsisPath();
  const plugins = join(await getNsisPluginsPath(), "x86-unicode");
  const constants = { APP_VERSION: version, ONLINE_OUTPUT: identity.output, APP_ICON: join(desktop, "assets/app-icon.ico"),
    PAYLOAD_URL: identity.url, PAYLOAD_MIB: (payloadBytes / 1048576).toFixed(2), PAYLOAD_BYTES: payloadBytes, PAYLOAD_SHA512: sha512 };
  const script = `!addincludedir "${quote(join(nsisTemplatesDir, "include"))}"\n!addplugindir /x86-unicode "${quote(plugins)}"\n`
    + Object.entries(constants).map(([key, value]) => `!define ${key} "${quote(value)}"`).join("\n") + "\n"
    + readFileSync(join(desktop, "assets/online-installer.nsi"), "utf8");
  mkdirSync(dirname(identity.output), { recursive: true });
  const result = spawnSync(compiler.path, ["-INPUTCHARSET", "UTF8", "-V2", "-"], {
    input: script, encoding: "utf8", windowsHide: true, timeout: 120000, env: { ...process.env, ...compiler.env },
  });
  if (result.error || result.status !== 0) throw new Error(`Online installer compilation failed: ${result.error ?? result.stderr ?? result.stdout}`);
  const onlineBytes = statSync(identity.output).size;
  if (onlineBytes >= ONLINE_LIMIT_BYTES) throw new Error("Online installer exceeds the 50,000,000-byte limit");
  const receipt = { ...identity, payloadBytes, payloadSha512: sha512, onlineBytes,
    onlineSha256: createHash("sha256").update(readFileSync(identity.output)).digest("hex"),
    sourceHashes: Object.fromEntries(["apps/desktop/scripts/build-online.mjs", "apps/desktop/assets/online-installer.nsi"].map(path =>
      [path, createHash("sha256").update(readFileSync(join(root, path))).digest("hex")])),
    sourceRevision: spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", windowsHide: true }).stdout.trim() };
  mkdirSync(join(root, "output/desktop-online"), { recursive: true });
  writeFileSync(join(root, "output/desktop-online", identity.testOnly ? `receipt-${testName ?? "fixture"}.json` : "receipt.json"), JSON.stringify(receipt, null, 2) + "\n");
  return receipt;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(JSON.stringify(await buildOnline(), null, 2));
