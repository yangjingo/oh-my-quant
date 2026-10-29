import { expect, it } from "bun:test";
import { resolve } from "node:path";

const source = resolve(import.meta.dir, "../src/index.ts");
async function cli(args: string[]) {
  const child = Bun.spawn([process.execPath, "run", source, ...args], {
    env: { ...processEnv(), ALPACA_PAPER_KEY_ID: "", ALPACA_PAPER_SECRET_KEY: "" }, stdout: "pipe", stderr: "pipe", timeout: 10_000 });
  const [code, output] = await Promise.all([child.exited, new Response(child.stdout).text()]);
  return { code, output };
}
function processEnv(): Record<string, string> {
  return Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}

it("lists the external paper entry without opening settings or a broker connection", async () => {
  const result = await cli(["--json", "--help"]);
  expect(result.code).toBe(0);
  expect(result.output).toContain("alpaca-paper");
}, 20_000);

it("requires the exact explicit action and separate paper credentials before broker access", async () => {
  const missingAction = await cli(["--json", "alpaca-paper"]);
  expect(missingAction.code).toBe(1);
  expect(JSON.parse(missingAction.output)).toMatchObject({ ok: false, command: "alpaca-paper" });
  const missingCredentials = await cli(["--json", "alpaca-paper", "account", "--root", resolve("private-paper"), "--account", "paper-account"]);
  expect(missingCredentials.code).toBe(1);
  expect(JSON.parse(missingCredentials.output)).toMatchObject({ ok: false, command: "alpaca-paper" });
  expect(missingCredentials.output).toContain("ALPACA_PAPER_KEY_ID");
}, 20_000);
