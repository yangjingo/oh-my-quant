import type { OhQuantSettings } from "../types/config.ts";

export interface DoctorResult {
  ready: boolean;
  auth: Record<string, { available: boolean; source: "env" | "config" | "missing"; value: string }>;
  config: {
    model: string;
    baseUrl: string;
    endpointMode: string;
  };
  hints: string[];
}

const AUTH_KEYS = [
  "WHYJ_QUANT_API_KEY",
  "WHYJ_QUANT_AUTH_TOKEN",
  "WHYJ_QUANT_BASE_URL",
  "WHYJ_QUANT_TUSHARE_TOKEN",
  "WHYJ_QUANT_LLMQUANT_API_KEY",
  "WHYJ_QUANT_FINANCIAL_DATASETS_KEY",
] as const;

export function describeEndpointMode(baseUrl: string): string {
  const url = baseUrl.toLowerCase();
  if (url.includes("anthropic") || url.includes("claude")) return "Anthropic Messages";
  if (url.includes("deepseek")) return "DeepSeek API";
  if (url.includes("openai") || url.includes("chat/completions")) return "OpenAI Compatible";
  if (url.includes("localhost") || url.includes("127.0.0.1")) return "Local";
  if (url.includes("openrouter")) return "OpenRouter";
  return "Custom";
}

export function runDoctor(
  settings: OhQuantSettings,
  processEnv: Record<string, string | undefined>,
): DoctorResult {
  const env = settings.env ?? {};
  const auth: DoctorResult["auth"] = {};

  for (const key of AUTH_KEYS) {
    const fromEnv = typeof processEnv[key] === "string" && processEnv[key]!.trim();
    const fromConfig = typeof env[key] === "string" && env[key].trim();
    if (fromEnv) {
      auth[key] = { available: true, source: "env", value: redact(fromEnv as string) };
    } else if (fromConfig) {
      auth[key] = { available: true, source: "config", value: redact(fromConfig as string) };
    } else {
      auth[key] = { available: false, source: "missing", value: "-" };
    }
  }

  const hasApiKey = auth.WHYJ_QUANT_API_KEY?.available ?? false;
  const source: string = settings.preferences?.source ?? "llmquant-data";
  const sourceTokenKey = sourceTokenEnvKey(source);
  const hasSourceToken = source === "akshare"
    || (sourceTokenKey ? (auth[sourceTokenKey]?.available ?? false) : false);

  const baseUrl = env.WHYJ_QUANT_BASE_URL || processEnv.WHYJ_QUANT_BASE_URL || "";

  const hints: string[] = [];
  if (!hasApiKey) hints.push("Add WHYJ_QUANT_API_KEY");
  if (!hasSourceToken && source !== "akshare") {
    hints.push(`Add a market data key (${sourceTokenKey ?? "WHYJ_QUANT_API_KEY"})`);
  }

  return {
    ready: hasApiKey,
    auth,
    config: {
      model: stripAnsi(settings.model || "sonnet"),
      baseUrl,
      endpointMode: baseUrl ? describeEndpointMode(baseUrl) : "",
    },
    hints,
  };
}

export function formatDoctorText(doctor: DoctorResult): string {
  const lines: string[] = [
    "WhyJ Doctor",
    "",
    `  status        ${doctor.ready ? "ready" : "not ready"}`,
    `  command        whyj doctor`,
    `  model          ${doctor.config.model}`,
    doctor.config.baseUrl
      ? `  base url       ${doctor.config.baseUrl} · ${doctor.config.endpointMode}`
      : "  base url       (not set)",
    "",
    "Credentials",
  ];

  for (const key of AUTH_KEYS) {
    const entry = doctor.auth[key];
    if (!entry) continue;
    lines.push(`  key     ${pad(key, 28)} ${pad(entry.available ? "OK" : "missing", 8)} ${entry.source.padEnd(7)} ${entry.value}`);
  }

  lines.push("");
  lines.push("Hints");
  if (doctor.hints.length === 0) {
    lines.push("- All checks passed.");
  } else {
    for (const hint of doctor.hints) lines.push(`- ${hint}`);
  }

  return lines.join("\n");
}

// -- helpers --

function redact(value: string): string {
  const stripped = stripAnsi(value);
  const fp = simpleFingerprint(stripped);
  if (stripped.length <= 8) return `${stripped} · fp:${fp}`;
  return `${stripped.slice(0, 4)}...${stripped.slice(-4)} · fp:${fp}`;
}

function stripAnsi(value: string): string {
  return value.replace(/\x1b\[[0-9;]*m/g, "").trim();
}

function simpleFingerprint(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = ((hash << 5) - hash) + value.charCodeAt(i);
    hash |= 0;
  }
  return (hash >>> 0).toString(16).padStart(8, "0").slice(0, 8);
}

function pad(value: string, width: number): string {
  return value.length >= width ? value : value + " ".repeat(width - value.length);
}

function sourceTokenEnvKey(source: string): string | null {
  switch (source) {
    case "tushare": return "WHYJ_QUANT_TUSHARE_TOKEN";
    case "llmquant-data": return "WHYJ_QUANT_LLMQUANT_API_KEY";
    case "financial-datasets": return "WHYJ_QUANT_FINANCIAL_DATASETS_KEY";
    default: return null;
  }
}
