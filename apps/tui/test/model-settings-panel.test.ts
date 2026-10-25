import { expect, it } from "bun:test";
import { ModelSettingsPanel } from "../src/model-settings-panel.ts";
import { Buffer } from "../src/buffer.ts";
import { DEFAULT_SETTINGS, type OhQuantSettings } from "../../../src/types/config.ts";
import { providerModels, resolveConfiguredModel } from "../../../src/runtime/models/model-settings.ts";

function config(): OhQuantSettings {
  return { ...structuredClone(DEFAULT_SETTINGS), provider: "custom", model: "local-model", thinkingLevel: "off",
    providers: { custom: { baseUrl: "http://localhost:1234/v1", apiKey: "original-secret" } } };
}

function press(panel: ModelSettingsPanel, name: string) { return panel.handleKey("", { name }); }
function type(panel: ModelSettingsPanel, input: string) { return panel.handleKey(input, {}); }
function render(panel: ModelSettingsPanel, width = 120, height = 32): string {
  const buffer = new Buffer(width, height);
  panel.render(buffer);
  return buffer.toPlain().join("\n");
}
function select(panel: ModelSettingsPanel, label: string): void {
  for (let count = 0; count < 25; count++) {
    if (render(panel).includes(`> ${label} `)) return;
    press(panel, "down");
  }
  throw new Error(`Missing field: ${label}`);
}
function open(panel: ModelSettingsPanel, label: string): void { select(panel, label); press(panel, "return"); }

it("selects named custom providers and models, editing only the selected model protocol", () => {
  const original = config();
  original.providers!.desk = { custom: true, model: "shared", baseUrl: "http://localhost:2345/v1", apiKey: "desk-secret",
    models: { shared: { api: "openai-completions" }, second: { api: "openai-responses" } } };
  const panel = new ModelSettingsPanel(original);
  open(panel, "Provider"); type(panel, "(desk)");
  expect(render(panel)).toContain("desk (desk)"); press(panel, "return");
  open(panel, "Model"); type(panel, "second");
  expect(render(panel)).toContain("second"); press(panel, "return");
  expect(render(panel)).toContain("openai-responses");
  open(panel, "Protocol"); type(panel, "anthropic-messages"); press(panel, "return");
  select(panel, "Save"); const saved = press(panel, "return").saved!;
  expect(resolveConfiguredModel(saved)).toMatchObject({ provider: "desk", id: "second", api: "anthropic-messages" });
  expect(saved.providers!.desk!.models!.shared!.api).toBe("openai-completions");
  expect(saved.providers!.custom!.apiKey).toBe("original-secret");
  expect(original.providers!.desk!.models!.second!.api).toBe("openai-responses");
  const reopened = new ModelSettingsPanel(saved);
  open(reopened, "Provider"); type(reopened, "(custom)"); press(reopened, "return");
  select(reopened, "Save");
  expect(press(reopened, "return").saved).toMatchObject({ provider: "custom", model: "local-model" });
});

it("searches provider/model catalogs and commits only on Save", () => {
  const original = config();
  const panel = new ModelSettingsPanel(original);
  open(panel, "Provider");
  type(panel, "(openai)");
  expect(render(panel)).toContain("OpenAI (openai)");
  press(panel, "return");
  open(panel, "Model");
  type(panel, "gpt-4o-mini");
  expect(render(panel)).toContain("gpt-4o-mini");
  press(panel, "return");
  expect(original.provider).toBe("custom");
  select(panel, "Save");
  const result = press(panel, "return");
  expect(result).toMatchObject({ close: true, verify: false, saved: { provider: "openai", model: "gpt-4o-mini" } });
  expect(result.saved?.providers?.custom?.apiKey).toBe("original-secret");
  expect(result.saved?.providers?.openai?.apiKey).toBeUndefined();
});

it("edits an imported model URL independently and clears it back to the provider URL", () => {
  const original = config();
  original.providers!.custom!.models = { "local-model": { baseUrl: "http://localhost:2345/v1" } };
  const panel = new ModelSettingsPanel(original);
  open(panel, "Model URL"); press(panel, "home");
  for (let i = 0; i < "http://localhost:2345/v1".length; i++) press(panel, "delete");
  press(panel, "return"); select(panel, "Save");
  const saved = press(panel, "return").saved!;
  expect(resolveConfiguredModel(saved).baseUrl).toBe("http://localhost:1234/v1");
  expect(original.providers!.custom!.models!["local-model"]!.baseUrl).toBe("http://localhost:2345/v1");
});

it.each(["amazon-bedrock", "azure", "google-vertex", "mistral"])("offers the %s native protocol and saves it without resetting to Completions", provider => {
  const original = config(), model = providerModels(provider)[0]!;
  original.provider = provider; original.model = model.id; original.providers![provider] = {};
  const panel = new ModelSettingsPanel(original);
  open(panel, "Connection details"); open(panel, "Protocol"); type(panel, model.api);
  expect(render(panel)).toContain(model.api);
  press(panel, "return"); select(panel, "Save");
  const saved = press(panel, "return").saved!;
  expect(resolveConfiguredModel(saved)).toMatchObject({ provider, api: model.api, id: model.id });
  expect(saved.providers!.custom!.apiKey).toBe("original-secret");
});

it("recovers from an empty search and cancels without a saved result", () => {
  const original = config();
  const before = structuredClone(original);
  const panel = new ModelSettingsPanel(original);
  open(panel, "Provider");
  type(panel, "no-such-provider");
  expect(render(panel)).toContain("No matches");
  expect(press(panel, "return")).toEqual({});
  press(panel, "escape");
  open(panel, "API key");
  type(panel, "discarded-secret");
  press(panel, "return");
  expect(press(panel, "escape")).toEqual({ close: true });
  expect(original).toEqual(before);
});

it("masks replacement keys while typing and supports explicit removal", () => {
  const panel = new ModelSettingsPanel(config());
  open(panel, "API key");
  type(panel, "replacement-secret");
  const screen = render(panel);
  expect(screen).toContain("••••");
  expect(screen).not.toContain("replacement-secret");
  expect(screen).not.toContain("original-secret");
  press(panel, "return");
  open(panel, "Remove saved key");
  select(panel, "Save");
  expect(press(panel, "return").saved?.providers?.custom?.apiKey).toBeUndefined();
});

it("supports cursor editing, Unicode text and exact model IDs", () => {
  const panel = new ModelSettingsPanel(config());
  open(panel, "Model");
  type(panel, "custom");
  press(panel, "return");
  press(panel, "home");
  for (let i = 0; i < "local-model".length; i++) press(panel, "delete");
  type(panel, "租户/model[1m]");
  press(panel, "home");
  press(panel, "right");
  press(panel, "delete");
  type(panel, "用");
  press(panel, "end");
  press(panel, "return");
  select(panel, "Save");
  expect(press(panel, "return").saved?.model).toBe("租用/model[1m]");
});

it("keeps invalid drafts editable and reports context/output conflicts", () => {
  const panel = new ModelSettingsPanel(config());
  open(panel, "Context window");
  type(panel, "100");
  press(panel, "return");
  select(panel, "Save");
  expect(press(panel, "return").saved).toBeUndefined();
  expect(render(panel)).toContain("Output limit cannot exceed context window");
  open(panel, "Output limit");
  type(panel, "-1");
  press(panel, "return");
  expect(render(panel)).toContain("positive integer");
  press(panel, "escape");
  open(panel, "Output limit");
  type(panel, "50");
  press(panel, "return");
  select(panel, "Save & Verify");
  const result = press(panel, "return");
  expect(result.verify).toBe(true);
  expect(result.saved?.providers?.custom?.models?.["local-model"]).toMatchObject({ contextWindow: 100, maxTokens: 50 });
});

it.each([[60, 20], [80, 24], [120, 32]])("keeps the selected row and edit cursor visible at %s x %s", (width, height) => {
  const panel = new ModelSettingsPanel(config());
  select(panel, "Save & Verify");
  expect(render(panel, width, height)).toContain("> Save & Verify");
  open(panel, "Base URL");
  type(panel, "/very/long/endpoint/".repeat(8));
  expect(render(panel, width, height)).toContain("|");
  const lines = render(panel, width, height).split("\n");
  expect(lines).toHaveLength(height);
  expect(lines.every(line => line.length <= width)).toBe(true);
});

it("honors overridden editor key bindings", () => {
  const panel = new ModelSettingsPanel(config(), { home: ["ctrl+h"] });
  open(panel, "Base URL");
  panel.handleKey("", { name: "h", ctrl: true });
  type(panel, "invalid:");
  press(panel, "return");
  expect(render(panel)).toContain("HTTP(S)");
  expect(press(panel, "escape")).toEqual({});
});

it("uses Pi's Cloudflare setup prompts and saves key/account/gateway as one draft", async () => {
  const original = config();
  original.provider = "cloudflare-ai-gateway";
  original.model = providerModels(original.provider)[0]!.id;
  const panel = new ModelSettingsPanel(original);
  open(panel, "Provider setup");
  expect(render(panel)).toContain("Enter Cloudflare API key");
  type(panel, "cloudflare-secret");
  expect(render(panel)).not.toContain("cloudflare-secret");
  press(panel, "return");
  await Bun.sleep(0);
  expect(render(panel)).toContain("Enter Cloudflare account ID");
  type(panel, "fixture-account");
  press(panel, "return");
  await Bun.sleep(0);
  expect(render(panel)).toContain("Enter Cloudflare AI Gateway ID");
  type(panel, "fixture-gateway");
  press(panel, "return");
  await Bun.sleep(0);
  expect(original.providers?.[original.provider]).toBeUndefined();
  select(panel, "Save");
  expect(press(panel, "return").saved?.providers?.[original.provider]).toMatchObject({ apiKey: "cloudflare-secret", env: { CLOUDFLARE_ACCOUNT_ID: "fixture-account", CLOUDFLARE_GATEWAY_ID: "fixture-gateway" } });
});

it("cancels multi-step provider setup without replacing existing credentials", async () => {
  const original = config();
  original.provider = "cloudflare-ai-gateway";
  original.model = providerModels(original.provider)[0]!.id;
  original.providers![original.provider] = { apiKey: "old-key", env: { CLOUDFLARE_ACCOUNT_ID: "old-account", CLOUDFLARE_GATEWAY_ID: "old-gateway" } };
  const panel = new ModelSettingsPanel(original);
  open(panel, "Provider setup");
  type(panel, "new-secret");
  press(panel, "return");
  await Bun.sleep(0);
  press(panel, "escape");
  await Bun.sleep(0);
  expect(render(panel)).toContain("Provider setup cancelled");
  select(panel, "Save");
  expect(press(panel, "return").saved?.providers?.[original.provider]).toEqual({ ...original.providers![original.provider], model: original.model, models: { [original.model]: {} } });
});
