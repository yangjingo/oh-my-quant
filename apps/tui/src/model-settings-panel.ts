import type { Key } from "node:readline";
import type { ModelProviderSettings, OhQuantSettings } from "../../../src/types/config.ts";
import { DEFAULT_TERMINAL_OPERATION_KEYBINDINGS } from "../../../src/types/config.ts";
import {
  createModelSettingsDraft, resolveConfiguredModel, configuredThinking, configuredThinkingLevels,
  modelProviders, providerModels, modelProtocols, selectModelProvider, modelAuthLabel, validateModelBaseUrl,
  configureProviderCredentials, type AuthPrompt,
} from "../../../src/runtime/models/model-settings.ts";
import { Buffer, strWidth, truncate } from "./buffer.ts";
import { drawPanelFrame } from "./panel-chrome.ts";
import { S } from "./styles.ts";
import { signInModelConnection, signOutModelConnection, openModelAuthUrl, type ModelOAuthOptions } from "../../../src/runtime/models/model-oauth.ts";
import { ModelAuthNotice } from "./model-auth-notice.ts";

type Choice = { id: string; label: string; detail?: string };
type Row = { label: string; value: string; run(): void };
export interface ModelSettingsResult { close?: boolean; saved?: OhQuantSettings; verify?: boolean }

export const DEFAULT_EDITOR_KEYBINDINGS = {
  left: ["left"], right: ["right"], home: ["home", "ctrl+a"], end: ["end", "ctrl+e"],
  backspace: ["backspace"], delete: ["delete"],
};
export const DEFAULT_APP_KEYBINDINGS = {
  confirm: ["return"], cancel: ["escape"], previous: ["up"], next: ["down"],
  capabilities: ["v"],
  probeEndpoint: ["p"],
  helpSection: ["tab", "shift+tab"], helpUsage: ["?"],
  openAuthLink: ["ctrl+o"], authPageUp: ["pageup"], authPageDown: ["pagedown"],
  doctorPageUp: ["pageup"], doctorPageDown: ["pagedown"],
  ...DEFAULT_TERMINAL_OPERATION_KEYBINDINGS,
};
type ModelKeybindings = Record<keyof typeof DEFAULT_EDITOR_KEYBINDINGS | keyof typeof DEFAULT_APP_KEYBINDINGS, readonly string[]>;

/** A single draft editor used by Settings and Doctor. No persistence in the renderer. */
export class ModelSettingsPanel {
  private settings: OhQuantSettings;
  private selection = 0;
  private picker: { title: string; items: Choice[]; select(id: string): void; query: string; index: number } | null = null;
  private editor: { label: string; value: string; cursor: number; secret: boolean; apply(value: string): void } | null = null;
  private readonly bindings: ModelKeybindings;
  private advanced = false;
  private status = "Select provider, model and credentials. Esc discards changes.";
  private auth = "Checking credential source...";
  private generation = 0;
  private setup: AbortController | null = null;
  private disposed = false;
  private notice: ModelAuthNotice | null = null;
  private readonly options: ModelOAuthOptions;
  private result: ModelSettingsResult = {};

  constructor(settings: OhQuantSettings, bindings: Partial<ModelKeybindings> = {}, options: ModelOAuthOptions = {}) {
    this.options = options;
    this.bindings = { ...DEFAULT_EDITOR_KEYBINDINGS, ...DEFAULT_APP_KEYBINDINGS, ...bindings };
    try { this.settings = createModelSettingsDraft(settings); }
    catch { this.settings = { ...structuredClone(settings), provider: "custom", model: settings.model, providers: { ...settings.providers, custom: { api: "openai-completions" } } }; }
    this.refreshAuth();
  }

  setError(message: string): void { this.status = message; }
  dispose(): void { this.disposed = true; this.setup?.abort(); this.notice = null; this.editor = null; this.picker = null; this.generation++; }

  private cancelSetup(): void {
    const controller = this.setup;
    this.setup = null; this.notice = null; this.editor = null; this.picker = null;
    controller?.abort();
    this.status = "Provider setup cancelled.";
    this.refreshAuth();
    this.options.onChange?.();
  }

  private connection(): ModelProviderSettings {
    this.settings.providers ??= {};
    return this.settings.providers[this.settings.provider!] ??= {};
  }

  private refreshAuth(): void {
    const version = ++this.generation;
    void modelAuthLabel(structuredClone(this.settings)).then(label => { if (version === this.generation && !this.disposed) { this.auth = label; this.options.onChange?.(); } });
  }

  private async oauth(signOut = false): Promise<void> {
    const controller = new AbortController(); this.setup = controller;
    this.notice = signOut ? null : new ModelAuthNotice();
    this.status = signOut ? "Signing out locally..." : "OAuth sign-in · success saves this connection";
    try {
      if (signOut) {
        await (this.options.signOut ?? signOutModelConnection)(structuredClone(this.settings), controller.signal);
        if (!this.disposed && this.setup === controller) this.status = "Signed out locally. OAuth remains selected.";
      } else {
        const saved = await (this.options.signIn ?? signInModelConnection)(structuredClone(this.settings), {
          signal: controller.signal,
          prompt: prompt => this.promptCredential(prompt, controller.signal),
          notify: event => { if (!controller.signal.aborted && !this.disposed) { this.notice?.notify(event); this.options.onChange?.(); } },
        });
        if (this.disposed || controller.signal.aborted) return;
        this.settings = structuredClone(saved);
        this.options.onSaved?.(structuredClone(saved));
        this.status = "Signed in and saved. Applies to the next prompt.";
      }
    } catch (error) {
      if (!this.disposed && this.setup === controller) this.status = controller.signal.aborted ? "OAuth operation cancelled." : error instanceof Error ? error.message : "OAuth operation failed.";
    } finally {
      if (this.setup === controller) {
        this.setup = null; this.notice = null; this.editor = null; this.picker = null;
        if (!this.disposed) { this.refreshAuth(); this.options.onChange?.(); }
      }
    }
  }

  private async openAuthLink(): Promise<void> {
    const controller = this.setup, url = this.notice?.url;
    if (!url || !controller || controller.signal.aborted) return;
    try { await (this.options.openUrl ?? openModelAuthUrl)(url); }
    catch { if (!this.disposed && this.setup === controller) { this.status = "Browser unavailable. Copy the authorization URL."; this.options.onChange?.(); } }
  }

  private edit(label: string, value: string, apply: (value: string) => void, secret = false): void {
    this.editor = { label, value: secret ? "" : value, cursor: secret ? 0 : [...value].length, secret, apply };
    this.status = secret ? "Enter a replacement key. Blank keeps the current key; Esc cancels." : "Enter to apply; Esc cancels this edit.";
  }

  private choose(title: string, items: Choice[], current: string, select: (id: string) => void): void {
    this.picker = { title, items, select, query: "", index: Math.max(0, items.findIndex(item => item.id === current)) };
    this.status = "Type to search · Up/Down choose · Enter select · Esc back";
  }

  private async setupCredentials(): Promise<void> {
    const controller = new AbortController();
    this.setup = controller;
    const cfg = this.connection();
    try {
      const credential = await configureProviderCredentials(this.settings.provider!, {
        signal: controller.signal,
        prompt: prompt => this.promptCredential(prompt, controller.signal),
        notify: event => { if (event.type === "info" || event.type === "progress") this.status = event.message; },
      });
      if (this.disposed) return;
      cfg.apiKey = credential.key;
      cfg.env = credential.env;
      this.status = "Provider setup added to draft. Save to apply.";
      this.refreshAuth();
    } catch (error) {
      if (!this.disposed && this.setup === controller) this.status = controller.signal.aborted ? "Provider setup cancelled. No credentials changed." : error instanceof Error ? error.message : "Provider setup failed.";
    } finally {
      if (this.setup === controller) { this.setup = null; if (!this.disposed) this.options.onChange?.(); }
    }
  }

  private promptCredential(prompt: AuthPrompt, signal: AbortSignal): Promise<string> {
    return new Promise((resolve, reject) => {
      let editor: typeof this.editor = null, picker: typeof this.picker = null;
      const abort = () => {
        cleanup();
        if (this.editor === editor) this.editor = null;
        if (this.picker === picker) this.picker = null;
        if (!this.disposed) this.options.onChange?.();
        reject(new Error("Provider setup cancelled"));
      };
      const cleanup = () => { signal.removeEventListener("abort", abort); prompt.signal?.removeEventListener("abort", abort); };
      const submit = (value: string) => { cleanup(); resolve(value); };
      if (signal.aborted || prompt.signal?.aborted) { abort(); return; }
      signal.addEventListener("abort", abort, { once: true });
      prompt.signal?.addEventListener("abort", abort, { once: true });
      if (prompt.type === "select") this.choose(prompt.message, prompt.options.map(option => ({ id: option.id, label: option.label, detail: option.description })), "", submit);
      else this.edit(prompt.message, "", submit, prompt.type === "secret" || prompt.type === "manual_code");
      editor = this.editor; picker = this.picker;
      this.status = "Provider setup · Enter continues · Esc cancels all setup changes";
      this.options.onChange?.();
    });
  }

  private rows(): Row[] {
    const cfg = this.connection();
    cfg.models ??= {};
    const capabilities = cfg.models[this.settings.model] ??= {};
    const provider = modelProviders(this.settings).find(item => item.id === this.settings.provider);
    let info: ReturnType<typeof resolveConfiguredModel> | undefined;
    try { info = resolveConfiguredModel(this.settings); } catch { /* incomplete draft */ }
    const rows: Row[] = [
      { label: "Provider", value: provider?.name ?? "Custom endpoint", run: () => this.choose("Provider", [
        ...modelProviders(this.settings).map(item => ({ id: item.id, label: `${item.name} (${item.id})`, detail: item.auth })),
        { id: "custom", label: "Custom endpoint (custom)", detail: "OpenAI-compatible, Responses, Anthropic or Gemini" },
      ], this.settings.provider!, id => { selectModelProvider(this.settings, id); this.refreshAuth(); }) },
      { label: "Model", value: this.settings.model || "Choose or enter a model ID", run: () => {
        const items = providerModels(this.settings.provider!, this.settings).map(item => ({ id: item.id, label: item.id,
          detail: `${item.name} · ${Math.round(item.contextWindow / 1000)}k context · ${item.reasoning ? "reasoning" : "no reasoning"}` }));
        this.choose("Model", [{ id: "__custom__", label: "Enter custom model ID..." }, ...items], this.settings.model, id => {
          if (id === "__custom__") this.edit("Model ID", this.settings.model, value => { if (!value) throw new Error("Model ID is required."); this.settings.model = value; });
          else { this.settings.model = id; this.settings.thinkingLevel = configuredThinking(this.settings); }
        });
      } },
      ...(!cfg.oauthId && provider?.canApiKey !== false ? [{ label: "API key", value: cfg.apiKey ? "Saved · hidden" : this.auth, run: () => this.edit("API key", "", value => { if (value) cfg.apiKey = value; this.refreshAuth(); }, true) }] : []),
      ...(!cfg.oauthId && provider?.canConfigure ? [{ label: "Provider setup", value: provider.auth, run: () => { void this.setupCredentials(); } }] : []),
      ...(provider?.canOAuth ? [{ label: "Sign in & Save", value: provider.oauthLabel ?? "OAuth", run: () => { void this.oauth(); } }] : []),
      ...(cfg.oauthId ? [{ label: "Sign out", value: "Remove local access; account not revoked", run: () => { void this.oauth(true); } },
        ...(provider?.canApiKey !== false ? [{ label: "Use API key", value: "Switch authentication in draft", run: () => { delete cfg.oauthId; this.refreshAuth(); this.status = "API-key selected in draft. Save to apply."; } }] : [])] : []),
      { label: "Thinking", value: info ? configuredThinking(this.settings) : this.settings.thinkingLevel, run: () => {
        const levels = configuredThinkingLevels(this.settings);
        this.choose("Thinking", levels.map(id => ({ id, label: id })), configuredThinking(this.settings), id => { this.settings.thinkingLevel = id; });
      } },
      { label: "Connection details", value: this.advanced ? "Hide" : `${info?.api ?? cfg.api ?? "Protocol"} · edit`, run: () => { this.advanced = !this.advanced; } },
    ];
    if (this.advanced || this.settings.provider === "custom" || cfg.custom === true) rows.push(
      { label: "Base URL", value: cfg.baseUrl || info?.baseUrl || (this.settings.provider === "custom" || cfg.custom ? "Required" : "Provider environment/default"), run: () => this.edit("Base URL (blank = provider default)", cfg.baseUrl ?? "", value => { cfg.baseUrl = value ? validateModelBaseUrl(value) : undefined; this.refreshAuth(); }) },
      ...(capabilities.baseUrl !== undefined ? [{ label: "Model URL", value: capabilities.baseUrl, run: () => this.edit("Model URL (blank = provider default)", capabilities.baseUrl ?? "", value => { capabilities.baseUrl = value ? validateModelBaseUrl(value) : undefined; this.refreshAuth(); }) }] : []),
      { label: "Protocol", value: capabilities.api || `${info?.api ?? cfg.api ?? "openai-completions"} (provider default)`, run: () => this.choose("Model protocol", [
        { id: "default", label: "Provider default" }, ...modelProtocols(this.settings.provider!).map(id => ({ id, label: id })),
      ], capabilities.api || "default", id => { capabilities.api = id === "default" ? undefined : id as ModelProviderSettings["api"]; }) },
      { label: "Context window", value: String(capabilities.contextWindow ?? info?.contextWindow ?? 128000), run: () => this.edit("Context tokens (blank = catalog default)", String(capabilities.contextWindow ?? ""), value => { capabilities.contextWindow = this.positiveInteger(value); }) },
      { label: "Output limit", value: String(capabilities.maxTokens ?? info?.maxTokens ?? 8192), run: () => this.edit("Output tokens (blank = catalog default)", String(capabilities.maxTokens ?? ""), value => { capabilities.maxTokens = this.positiveInteger(value); }) },
      { label: "Reasoning support", value: capabilities.reasoning === undefined ? "Catalog default" : capabilities.reasoning ? "Enabled" : "Disabled", run: () => this.choose("Reasoning support", [
        { id: "default", label: "Catalog default" }, { id: "on", label: "Enabled" }, { id: "off", label: "Disabled" },
      ], capabilities.reasoning === undefined ? "default" : capabilities.reasoning ? "on" : "off", id => { capabilities.reasoning = id === "default" ? undefined : id === "on"; }) },
      ...(!cfg.oauthId && provider?.canApiKey !== false ? [{ label: "Remove saved key", value: "Use provider environment instead", run: () => { delete cfg.apiKey; this.refreshAuth(); this.status = "Saved key removed from draft."; } }] : []),
    );
    rows.push(
      { label: "Save", value: "Apply to the next submitted prompt", run: () => this.save(false) },
      { label: "Save & Verify", value: "Send a small model request", run: () => this.save(true) },
    );
    return rows;
  }

  private positiveInteger(value: string): number | undefined {
    if (!value) return undefined;
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) <= 0) throw new Error("Enter a positive integer.");
    return Number(value);
  }

  private save(verify: boolean): void {
    const provider = modelProviders(this.settings).find(item => item.id === this.settings.provider);
    if (provider?.canApiKey === false && !this.connection().oauthId) throw new Error("Sign in & Save before using this provider.");
    resolveConfiguredModel(this.settings);
    this.settings.thinkingLevel = configuredThinking(this.settings);
    this.connection().model = this.settings.model;
    this.result = { saved: structuredClone(this.settings), verify, close: true };
  }

  private matches(): Choice[] {
    return this.picker?.items.filter(item => `${item.label} ${item.detail ?? ""}`.toLowerCase().includes(this.picker!.query.toLowerCase())) ?? [];
  }

  handleKey(input: string, key: Key): ModelSettingsResult {
    if (this.disposed) return {};
    this.result = {};
    const chord = `${key.ctrl ? "ctrl+" : ""}${key.meta ? "meta+" : ""}${key.name ?? ""}`;
    const action = Object.entries(this.bindings).find(([, chords]) => chords.includes(chord))?.[0];
    try {
      if (this.notice && action === "openAuthLink") { void this.openAuthLink(); return {}; }
      if (this.notice && (action === "authPageUp" || action === "authPageDown")) { this.notice.scroll(action === "authPageUp" ? -1 : 1); return {}; }
      if (this.editor) {
        const chars = [...this.editor.value];
        if (action === "cancel") { if (this.setup) this.cancelSetup(); else this.editor = null; return {}; }
        if (action === "confirm") { this.editor.apply(this.editor.value.trim()); this.editor = null; this.refreshAuth(); this.status = "Draft updated. Save to apply."; return {}; }
        if (action === "left") this.editor.cursor = Math.max(0, this.editor.cursor - 1);
        else if (action === "right") this.editor.cursor = Math.min(chars.length, this.editor.cursor + 1);
        else if (action === "home") this.editor.cursor = 0;
        else if (action === "end") this.editor.cursor = chars.length;
        else if (action === "delete") chars.splice(this.editor.cursor, 1);
        else if (action === "backspace" && this.editor.cursor > 0) chars.splice(--this.editor.cursor, 1);
        else if (input && !key.ctrl && !key.meta && !/[\x00-\x1f\x7f]/.test(input)) {
          chars.splice(this.editor.cursor, 0, ...input);
          this.editor.cursor += [...input].length;
        }
        this.editor.value = chars.join("");
        return {};
      }
      if (this.picker) {
        if (action === "cancel") { if (this.setup) this.cancelSetup(); else this.picker = null; return {}; }
        const items = this.matches();
        if (action === "previous" || action === "next") this.picker.index = Math.max(0, Math.min(items.length - 1, this.picker.index + (action === "previous" ? -1 : 1)));
        else if (action === "confirm") {
          const item = items[this.picker.index];
          if (item) { const select = this.picker.select; this.picker = null; select(item.id); this.refreshAuth(); }
        } else if (action === "backspace") { this.picker.query = this.picker.query.slice(0, -1); this.picker.index = 0; }
        else if (input && !key.ctrl && !key.meta && !/[\x00-\x1f\x7f]/.test(input)) { this.picker.query += input; this.picker.index = 0; }
        return {};
      }
      if (action === "cancel") { if (this.setup) { this.cancelSetup(); return {}; } return { close: true }; }
      if (this.setup) return {};
      const rows = this.rows();
      if (action === "previous" || action === "next") this.selection = (this.selection + (action === "previous" ? -1 : 1) + rows.length) % rows.length;
      else if (action === "confirm") rows[this.selection]?.run();
    } catch (error) { this.status = error instanceof Error ? error.message : "Check model settings."; }
    return this.result;
  }

  render(buf: Buffer): void {
    const frame = drawPanelFrame(buf, this.picker?.title ?? "Model connection", this.notice ? "OAuth" : "Draft", 3, 2);
    const { inner } = frame;
    buf.text(inner.x, inner.y, truncate(`${this.settings.provider} / ${this.settings.model || "Choose a model"}`, inner.w), S.cream);
    buf.text(inner.x, inner.y + 1, truncate(this.auth, inner.w), S.dim);
    const items = this.picker ? this.matches().map(item => ({ label: item.label, value: item.detail ?? "" })) : this.rows();
    const selected = this.picker?.index ?? this.selection;
    const rowHeight = this.picker ? 2 : 1;
    const count = Math.max(1, Math.floor((frame.contentH - (this.picker ? 1 : 0)) / rowHeight));
    const start = Math.max(0, Math.min(selected - Math.floor(count / 2), items.length - count));
    let y = frame.contentY;
    if (this.notice && !this.picker) this.notice.render(buf, frame);
    if (this.picker) buf.text(inner.x, y++, truncate(`Search: ${this.picker.query}|  (${items.length})`, inner.w), S.gold);
    for (const [offset, item] of (this.notice && !this.picker ? [] : items.slice(start, start + count)).entries()) {
      const active = start + offset === selected;
      const label = `${active ? ">" : " "} ${item.label}`;
      buf.text(inner.x, y++, truncate(this.picker ? label : `${label.padEnd(23)} ${item.value}`, inner.w), active ? S.goldB : S.cream);
      if (this.picker) buf.text(inner.x + 2, y++, truncate(item.value, inner.w - 2), S.dim);
    }
    if (!items.length) buf.text(inner.x, y, "No matches. Backspace to change search.", S.dim);
    if (this.editor) {
      const label = `${truncate(this.editor.label.split(" (")[0]!, Math.max(8, Math.floor(inner.w / 2)))}: `;
      const chars = [...this.editor.value].map(char => this.editor!.secret ? "•" : char);
      const before = chars.slice(0, this.editor.cursor);
      while (strWidth(before.join("")) > Math.max(1, inner.w - strWidth(label) - 2)) before.shift();
      const value = `${before.join("")}|${chars.slice(this.editor.cursor).join("")}`;
      buf.text(inner.x, frame.footerY - 2, truncate(label + value, inner.w), S.gold);
    }
    buf.text(inner.x, frame.footerY - 1, truncate(this.status, inner.w), S.dim);
    const openKey = this.bindings.openAuthLink[0]?.replace("ctrl+", "Ctrl+") ?? "Unbound";
    buf.text(inner.x, frame.footerY, truncate(this.notice ? `${openKey} open link · PgUp/PgDn scroll · Esc cancel` : "Up/Down navigate · Enter select · Esc back / discard", inner.w), S.dim);
  }
}
