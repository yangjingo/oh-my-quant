import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { createLocalPaperService } from "../../../src/app/paper-execution/index.ts";
import { DEFAULT_SETTINGS } from "../../../src/types/config.ts";

let root: string, ledger: string, state: string;
beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "whyj-paper-agent-entry-"));
  ledger = join(root, "private-ledger"); state = join(root, "state");
  mkdirSync(state); writeFileSync(join(state, "settings.json"), JSON.stringify(DEFAULT_SETTINGS));
  const paper = createLocalPaperService({ root: ledger,
    target: { adapterId: "local-paper", accountRef: "entry-test", mode: "paper" },
    openingAccount: { balances: [{ currency: "USD", cash: "100" }], positions: [] } });
  await paper.adapter.account(new AbortController().signal);
});
afterEach(() => {
  if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unexpected paper Agent CLI fixture root.");
  rmSync(root, { recursive: true, force: true });
});

function spawn(args: string[], stdin: "pipe" | "ignore" = "ignore") {
  return Bun.spawn([process.execPath, "src/index.ts", ...args], { cwd: resolve(import.meta.dir, "../../.."),
    env: { ...process.env, OHQUANT_DIR: state }, stdin, stdout: "pipe", stderr: "pipe", timeout: 15_000 });
}

test("real source CLI opens the selected private paper Agent and exits on /exit without model or order actions", async () => {
  const child = spawn(["paper", "agent", "--root", ledger, "--account", "entry-test"], "pipe");
  const decoder = new TextDecoder();
  const reader = child.stdout.getReader();
  let output = "", sentExit = false;
  const read = (async () => {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      output += decoder.decode(next.value);
      if (!sentExit && output.includes("Private paper Agent ready")) {
        sentExit = true; child.stdin!.write("/exit\n"); child.stdin!.end();
      }
    }
  })();
  const [code, error] = await Promise.all([child.exited, new Response(child.stderr).text(), read]);
  expect(code).toBe(0); expect(error).toBe(""); expect(sentExit).toBe(true);
  expect(output).toContain("Private paper Agent ready");
  expect(output).toContain("sends paper account/order context to the configured model provider");
  expect(output).not.toContain("approve submit");
}, 20_000);

test("JSON, missing root and nonexistent private account fail before interactive model startup", async () => {
  for (const args of [["--json", "paper", "agent", "--root", ledger, "--account", "entry-test"],
    ["paper", "agent"], ["paper", "agent", "--root", join(root, "absent"), "--account", "entry-test"]]) {
    const child = spawn(args);
    const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect(code).toBe(1); expect(out).not.toContain("\x1b"); expect(err).not.toContain("\x1b");
  }
}, 20_000);
