import { afterEach, beforeEach, expect, it } from "bun:test";
import { mkdtempSync, readdirSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import type { ProviderAuthInteraction, OAuthCredential } from "@earendil-works/pi-ai";
import { ModelOAuthFile, readSettings, saveSettings } from "../../../src/storage/index.ts";
import { getProvider, getModels } from "../../../src/agent/src/kernel/llm.ts";
import { loginModelOAuth } from "../../../src/agent/src/model-oauth.ts";
import { signInModelConnection, signOutModelConnection, openModelAuthUrl, type ModelOAuthOptions } from "../../../src/runtime/models/model-oauth.ts";
import { ModelSettingsPanel } from "../src/model-settings-panel.ts";
import { PanelController } from "../src/panel.ts";
import { Buffer } from "../src/buffer.ts";
import { nextInputAction } from "../src/input.ts";

let root: string, previous: string | undefined;
let panels: Array<ModelSettingsPanel | PanelController>, pending: Promise<unknown>[], releases: Array<() => void>;
const token = (): OAuthCredential => ({ type: "oauth", access: "fixture-access", refresh: "fixture-refresh", expires: Date.now() + 3600000 });
type Panel = ModelSettingsPanel | PanelController;
function press(panel: Panel, name: string) { return panel.handleKey("", { name }); }
function screen(panel: Panel, width = 120, height = 32): string { const buf = new Buffer(width, height); panel.render(buf); return buf.toPlain().join("\n"); }
function choose(panel: Panel, label: string): void {
  for (let i = 0; i < 35; i++) {
    if (screen(panel).includes(`> ${label} `)) { press(panel, "return"); return; }
    press(panel, "down");
  }
  throw new Error(`Missing field: ${label}`);
}
function gate() { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; }); releases.push(release); return { promise, release }; }
async function tick() { await Bun.sleep(0); }
function loginOptions(login: (interaction: ProviderAuthInteraction) => Promise<OAuthCredential>): ModelOAuthOptions {
  return { signIn: (settings, interaction) => {
    const task = signInModelConnection(settings, interaction, (id, ui, dir) => {
      const provider = getProvider(id)!;
      return loginModelOAuth(id, ui, dir, { ...provider, auth: { oauth: { ...provider.auth.oauth!, login } } });
    });
    pending.push(task); return task;
  } };
}
function panel(options: ModelOAuthOptions): ModelSettingsPanel {
  const item = new ModelSettingsPanel(readSettings(), {}, options); panels.push(item); return item;
}
beforeEach(() => {
  previous = process.env.OHQUANT_DIR; root = mkdtempSync(join(tmpdir(), "whyj-oauth-ui-")); process.env.OHQUANT_DIR = root;
  panels = []; pending = []; releases = [];
  const settings = readSettings(); settings.provider = "anthropic"; settings.model = getModels("anthropic")[0]!.id;
  settings.providers = { anthropic: { apiKey: "previous-fixture-key" } }; saveSettings(settings);
});
afterEach(async () => {
  for (const item of panels) { if (item instanceof PanelController) item.close(); else item.dispose(); }
  for (const release of releases) release();
  await Promise.allSettled(pending); await tick();
  if (previous === undefined) delete process.env.OHQUANT_DIR; else process.env.OHQUANT_DIR = previous;
  if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unexpected OAuth UI fixture path.");
  rmSync(root, { recursive: true, force: true });
});

it("discovers the OAuth-only Codex provider and requires sign-in before Save", () => {
  const item = panel({}); choose(item, "Provider"); item.handleKey("(openai-codex)", {}); press(item, "return");
  expect(screen(item)).toContain("Sign in & Save"); expect(screen(item)).not.toContain("API key");
  choose(item, "Save"); expect(screen(item)).toContain("Sign in & Save before using this provider");
  expect(readSettings().provider).toBe("anthropic");
});

it("reaches Pi's actual Codex login-method picker and cancels before any authorization request", async () => {
  const item = panel({}); choose(item, "Provider"); item.handleKey("(openai-codex)", {}); press(item, "return");
  choose(item, "Sign in & Save");
  for (let i = 0; i < 100 && !screen(item).includes("Device code login"); i++) await tick();
  expect(screen(item)).toContain("Browser login"); expect(screen(item)).toContain("Device code login");
  press(item, "escape"); await tick(); expect(readSettings().provider).toBe("anthropic");
});

it("bundles the real OAuth flow without relying on unshipped relative module files", async () => {
  const build = await Bun.build({ entrypoints: [join(import.meta.dir, "../../../src/runtime/test/fixtures/model-oauth-bundle.ts")], outdir: join(root, "bundle"), target: "node" });
  expect(build.success).toBe(true);
  const child = Bun.spawn([process.execPath, build.outputs[0]!.path, root], { cwd: root, stdout: "pipe", stderr: "pipe" });
  try {
    expect(await child.exited).toBe(0); expect(await new Response(child.stderr).text()).toBe("");
    expect(await new Response(child.stdout).text()).toBe("prompt reached; cancelled before network\n");
  } finally { if (child.exitCode === null) child.kill(9); await child.exited; }
}, 20000);

it.each([[60, 20], [80, 24], [120, 32]])("renders authorization and masked manual code at %s x %s, opening the full URL on request", async (width, height) => {
  const url = `https://fixture.invalid/authorize?state=${"s".repeat(180)}&last=visible-end`;
  let opened = "", submitted = "", paints = 0;
  const item = panel({ ...loginOptions(async ui => {
    ui.notify({ type: "auth_url", url, instructions: "Authorize the fixture account" });
    submitted = await ui.prompt({ type: "manual_code", message: "Paste the authorization code from the browser callback" }); return token();
  }), openUrl: async value => { opened = value; }, onChange: () => { paints++; } });
  choose(item, "Sign in & Save"); await tick();
  expect(screen(item, width, height)).toContain("Authorize the fixture");
  const action = nextInputAction("\x0f").action;
  expect(action?.type).toBe("key");
  if (action?.type === "key") item.handleKey(action.char ?? "", action);
  await tick(); expect(opened).toBe(url);
  item.handleKey("private-callback-code", {});
  expect(screen(item, width, height)).not.toContain("private-callback-code");
  expect(screen(item, width, height)).toContain("••"); expect(screen(item, width, height)).toContain("|");
  for (let i = 0; i < 8; i++) { press(item, "pagedown"); screen(item, width, height); }
  expect(screen(item, width, height)).toContain("visible-end");
  press(item, "return"); await Promise.all(pending); await tick();
  expect(submitted).toBe("private-callback-code"); expect(readSettings().providers!.anthropic!.oauthId).toBeDefined();
  expect(readFileSync(join(root, "settings.json"), "utf8")).not.toContain("fixture-access");
  expect(paints).toBeGreaterThan(1); expect(screen(item)).toContain("Signed in and saved");
});

it("shows device codes and keeps the link through polling progress; Esc cancels without saving", async () => {
  const item = panel(loginOptions(async ui => {
    ui.notify({ type: "device_code", userCode: "FIXT-1234", verificationUri: "https://fixture.invalid/device", expiresInSeconds: 900 });
    ui.notify({ type: "progress", message: "Waiting for authorization" });
    await ui.prompt({ type: "text", message: "Fixture wait" }); return token();
  }));
  const before = readSettings().revision;
  choose(item, "Sign in & Save"); await tick();
  expect(screen(item)).toContain("FIXT-1234"); expect(screen(item)).toContain("https://fixture.invalid/device");
  expect(press(item, "escape")).toEqual({}); await tick();
  expect(readSettings().revision).toBe(before); expect(press(item, "escape")).toEqual({ close: true });
});

it("honors remapped browser keys from raw terminal input and keeps authorization editable on launch failure", async () => {
  let launches = 0;
  const item = new ModelSettingsPanel(readSettings(), { openAuthLink: ["ctrl+l"] }, {
    ...loginOptions(async ui => {
      ui.notify({ type: "auth_url", url: "https://fixture.invalid/auth" });
      await ui.prompt({ type: "manual_code", message: "Authorization code" }); return token();
    }), openUrl: async () => { launches++; throw new Error("fixture launch failure"); },
  }); panels.push(item); choose(item, "Sign in & Save"); await tick();
  expect(screen(item)).toContain("Ctrl+l open link");
  for (const input of ["\x0f", "\x0c"]) {
    const action = nextInputAction(input).action;
    if (action?.type === "key") item.handleKey(action.char ?? "", action);
    await tick(); expect(launches).toBe(input === "\x0f" ? 0 : 1);
  }
  expect(screen(item)).toContain("Browser unavailable"); expect(screen(item)).toContain("https://fixture.invalid/auth");
  item.handleKey("fixture-code", {}); press(item, "return"); await Promise.all(pending); await tick();
  expect(readSettings().providers!.anthropic!.oauthId).toBeDefined();
});

it("clears a cancelled manual prompt when the callback wins without cancelling the whole login", async () => {
  const callback = new AbortController(), finish = gate();
  const item = panel(loginOptions(async ui => {
    try { await ui.prompt({ type: "manual_code", message: "Manual fallback", signal: callback.signal }); } catch { /* callback wins */ }
    ui.signal.throwIfAborted(); await finish.promise; return token();
  }));
  choose(item, "Sign in & Save"); await tick(); expect(screen(item)).toContain("Manual fallback");
  callback.abort(); await tick(); expect(screen(item)).not.toContain("Manual fallback:");
  finish.release(); await Promise.all(pending); await tick(); expect(readSettings().providers!.anthropic!.oauthId).toBeDefined();
});

it("ignores a cancelled login's late result while another login succeeds", async () => {
  const first = gate(); let calls = 0;
  const item = panel(loginOptions(async ui => {
    if (++calls === 1) { await first.promise; ui.notify({ type: "progress", message: "obsolete-login-result" }); }
    return token();
  }));
  choose(item, "Sign in & Save"); await tick(); press(item, "escape");
  choose(item, "Sign in & Save"); await tick(); const savedId = readSettings().providers!.anthropic!.oauthId;
  expect(savedId).toBeDefined(); first.release(); await Promise.allSettled(pending); await tick();
  expect(screen(item)).not.toContain("obsolete-login-result"); expect(screen(item)).toContain("Signed in and saved");
  expect(readSettings().providers!.anthropic!.oauthId).toBe(savedId); expect(readdirSync(join(root, "model-auth"))).toHaveLength(1);
});

it("preserves a concurrent configuration and cleans up the rejected UI login", async () => {
  const finish = gate(); const item = panel(loginOptions(async () => { await finish.promise; return token(); }));
  choose(item, "Sign in & Save"); await tick();
  const other = readSettings(); other.preferences.hudMode = "off"; saveSettings(other);
  finish.release(); await Promise.allSettled(pending); await tick();
  expect(screen(item)).toContain("Settings changed"); expect(readSettings().providers!.anthropic!.oauthId).toBeUndefined();
  expect(readSettings().preferences.hudMode).toBe("off"); expect(readdirSync(join(root, "model-auth"))).toEqual([]);
});

it("syncs committed OAuth settings to the parent so later toggles cannot overwrite the connection", async () => {
  const item = new PanelController(undefined, { modelAuth: loginOptions(async () => token()) }); panels.push(item); item.open("config");
  press(item, "return"); choose(item, "Sign in & Save"); await Promise.all(pending); await tick();
  const id = readSettings().providers!.anthropic!.oauthId;
  press(item, "escape"); choose(item, "External Skills");
  expect(readSettings().skillIntegrations.external).toBe(true); expect(readSettings().providers!.anthropic!.oauthId).toBe(id);
});

it("closing a parent panel cancels the login and rejects its late completion", async () => {
  const finish = gate();
  const item = new PanelController(undefined, { modelAuth: loginOptions(async () => { await finish.promise; return token(); }) }); panels.push(item); item.open("config");
  press(item, "return"); choose(item, "Sign in & Save"); await tick(); item.close(); finish.release();
  await Promise.allSettled(pending); await tick(); expect(item.isOpen()).toBe(false); expect(readSettings().providers!.anthropic!.oauthId).toBeUndefined();
});

it("logs out locally without fallback; switching back to API-key remains a cancellable draft", async () => {
  const deleted = gate(), finishLogout = gate();
  const item = panel({ ...loginOptions(async () => token()), signOut: (settings, signal) => {
    const task = signOutModelConnection(settings, signal).then(async () => { deleted.release(); await finishLogout.promise; });
    pending.push(task); return task;
  } }); choose(item, "Sign in & Save"); await Promise.all(pending); await tick();
  const id = readSettings().providers!.anthropic!.oauthId!;
  choose(item, "Sign out");
  await deleted.promise;
  expect(new ModelOAuthFile("anthropic", id).read()).toBeUndefined(); expect(readSettings().providers!.anthropic!.oauthId).toBe(id);
  expect(screen(item)).toContain("Signing out locally...");
  press(item, "down"); expect(screen(item)).toContain("> Sign out "); // File disappearance is not UI operation completion.
  finishLogout.release(); await Promise.all(pending); await tick();
  expect(screen(item)).toContain("Signed out locally. OAuth remains selected.");
  choose(item, "Use API key"); expect(readSettings().providers!.anthropic!.oauthId).toBe(id); press(item, "escape");
  const reopened = panel({}); choose(reopened, "Use API key");
  for (let i = 0; i < 35 && !screen(reopened).includes("> Save "); i++) press(reopened, "down");
  const result = reopened.handleKey("", { name: "return" });
  expect(result.saved!.providers!.anthropic!.oauthId).toBeUndefined(); expect(result.saved!.providers!.anthropic!.apiKey).toBe("previous-fixture-key");
});

it.each(["file:///private", "javascript:alert(1)", "https://user:password@fixture.invalid", "https://fixture.invalid/\ncommand"])("rejects non-browser authorization targets %s before launching", async url => {
  await expect(openModelAuthUrl(url)).rejects.toThrow("Invalid authorization URL");
});
