import { readSettings, saveSettings, readWhyjEnvValue } from "../../storage/index.ts";
import { configuredThinking, configuredThinkingLevels, resolveConfiguredModel } from "../../runtime/models/model-settings.ts";
import type { OhQuantSettings } from "../../types/config.ts";
import type { Preferences } from "../../types/workbench.ts";
import { WorkbenchError } from "./errors.ts";

export interface SettingsPort { read(): OhQuantSettings; save(settings: OhQuantSettings): void }
export const localSettings: SettingsPort = { read: readSettings, save: saveSettings };

export function publicPreferences(settings: OhQuantSettings): Preferences {
  const model = resolveConfiguredModel(settings);
  const provider = settings.provider ? settings.providers?.[settings.provider] : undefined;
  return { revision: settings.revision, model: model.id, modelProvider: model.provider, modelProtocol: model.api,
    thinkingLevel: configuredThinking(settings), availableThinkingLevels: configuredThinkingLevels(settings),
    modelCredentialsConfigured: !!provider?.apiKey || !!provider?.oauthId,
    researchSource: settings.preferences.source,
    researchSources: [
      { id: "akshare", label: "AKShare", requiresCredential: false, credentialConfigured: false },
      { id: "tushare", label: "Tushare", requiresCredential: true, credentialConfigured: !!readWhyjEnvValue({ ...process.env, ...settings.env }, "tushareToken") },
      { id: "llmquant-data", label: "LLMQuant", requiresCredential: true, credentialConfigured: !!readWhyjEnvValue({ ...process.env, ...settings.env }, "llmquantApiKey") },
      { id: "financial-datasets", label: "Financial Datasets", requiresCredential: true, credentialConfigured: !!readWhyjEnvValue({ ...process.env, ...settings.env }, "financialDatasetsKey") },
    ], source: "none", portfolio: "" };
}

export function updateModel(port: SettingsPort, next: Preferences) {
  if (next.source !== "none" || next.portfolio) throw new WorkbenchError("UNAVAILABLE", "此连接暂未接入行情概览与观察组设置。请使用研究工具取得数据。");
  if (!next.revision) throw new WorkbenchError("SETTINGS_REVISION", "请重新连接，取得当前设置版本后再保存。", 409);
  if (typeof next.model !== "string" || !next.model.trim() || next.model.length > 160) throw new WorkbenchError("MODEL_INVALID", "请输入不超过 160 字符的模型 ID。");
  const settings = port.read();
  if (next.researchSource !== undefined) {
    if (!["akshare", "tushare", "llmquant-data", "financial-datasets"].includes(next.researchSource)) throw new WorkbenchError("SOURCE_INVALID", "请选择已接入的研究数据源。");
    settings.preferences.source = next.researchSource;
  }
  settings.model = next.model.trim(); settings.revision = next.revision;
  if (next.thinkingLevel !== undefined) settings.thinkingLevel = next.thinkingLevel;
  try {
    resolveConfiguredModel(settings);
    const levels: readonly string[] = configuredThinkingLevels(settings);
    if (!levels.includes(settings.thinkingLevel)) throw new Error("Invalid thinking level");
  } catch { throw new WorkbenchError("MODEL_INVALID", "模型或推理强度无效，请检查当前服务商支持的配置。"); }
  port.save(settings);
}

export function secretValues(settings: OhQuantSettings): string[] {
  const slots = ["authToken", "apiKey", "tushareToken", "financialDatasetsKey", "llmquantApiKey"] as const;
  return [...new Set([...Object.values(settings.providers ?? {}).flatMap(provider => [provider.apiKey,
    ...Object.entries(provider.headers ?? {}).filter(([key]) => /authorization|key|token/i.test(key)).map(([, value]) => value)]),
    ...[process.env, settings.env].flatMap(env => slots.map(key => readWhyjEnvValue(env, key))),
    ...Object.entries({ ...process.env, ...settings.env }).filter(([key]) => /API_KEY|AUTH_TOKEN|API_TOKEN|SECRET|PASSWORD/.test(key)).map(([, value]) => value)]
    .filter((value): value is string => typeof value === "string" && value.length > 3))].sort((a, b) => b.length - a.length);
}
