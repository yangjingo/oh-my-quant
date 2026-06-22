import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createAgent } from "../src/agent/src/session.ts";
import { canonicalizeWhyjEnv, readWhyjEnvValue } from "../src/storage/index.ts";
import type { OhQuantSettings } from "../src/types/config.ts";

type SmokeCase = {
  name: string;
  model: string;
  env: Record<string, string>;
};

type SmokeResult = {
  name: string;
  ok: boolean;
  provider?: string;
  api?: string;
  model?: string;
  baseUrl?: string;
  response?: string;
  error?: string;
};

const ROOT = resolve(import.meta.dir, "..");
const SETTINGS_PATH = resolve(ROOT, ".ohquant", "settings.json");
const PROMPT = "Reply with only ok.";

function loadProjectSettings(): OhQuantSettings {
  if (!existsSync(SETTINGS_PATH)) {
    throw new Error(`Missing settings file: ${SETTINGS_PATH}`);
  }
  return JSON.parse(readFileSync(SETTINGS_PATH, "utf-8")) as OhQuantSettings;
}

function buildSettingsCase(settings: OhQuantSettings): SmokeCase | null {
  const env = canonicalizeWhyjEnv(settings.env ?? {});
  const token = readWhyjEnvValue(env, "apiKey") || readWhyjEnvValue(env, "authToken");
  const baseUrl = readWhyjEnvValue(env, "baseUrl");
  if (!token || !baseUrl || !settings.model) return null;
  return {
    name: "current-settings",
    model: settings.model,
    env: {
      ...env,
      WHYJ_QUANT_API_KEY: token,
      WHYJ_QUANT_AUTH_TOKEN: token,
      WHYJ_QUANT_BASE_URL: baseUrl,
    },
  };
}

function readSmokeEnv(name: string): string | undefined {
  const value = process.env[name];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function buildVendorCases(): SmokeCase[] {
  const cases: SmokeCase[] = [];

  const glmToken = readSmokeEnv("WHYJ_SMOKE_GLM_AUTH_TOKEN");
  if (glmToken) {
    cases.push({
      name: "glm-anthropic",
      model: readSmokeEnv("WHYJ_SMOKE_GLM_ANTHROPIC_MODEL") || "glm-5.2",
      env: {
        WHYJ_QUANT_API_KEY: glmToken,
        WHYJ_QUANT_AUTH_TOKEN: glmToken,
        WHYJ_QUANT_BASE_URL: readSmokeEnv("WHYJ_SMOKE_GLM_ANTHROPIC_BASE_URL") || "https://open.bigmodel.cn/api/anthropic",
      },
    });
    cases.push({
      name: "glm-openai",
      model: readSmokeEnv("WHYJ_SMOKE_GLM_OPENAI_MODEL") || "glm-5.2",
      env: {
        WHYJ_QUANT_API_KEY: glmToken,
        WHYJ_QUANT_AUTH_TOKEN: glmToken,
        WHYJ_QUANT_BASE_URL: readSmokeEnv("WHYJ_SMOKE_GLM_OPENAI_BASE_URL") || "https://open.bigmodel.cn/api/v1",
      },
    });
  }

  const minimaxToken = readSmokeEnv("WHYJ_SMOKE_MINIMAX_AUTH_TOKEN");
  if (minimaxToken) {
    cases.push({
      name: "minimax-anthropic",
      model: readSmokeEnv("WHYJ_SMOKE_MINIMAX_ANTHROPIC_MODEL") || "MiniMax-M2.7",
      env: {
        WHYJ_QUANT_API_KEY: minimaxToken,
        WHYJ_QUANT_AUTH_TOKEN: minimaxToken,
        WHYJ_QUANT_BASE_URL: readSmokeEnv("WHYJ_SMOKE_MINIMAX_ANTHROPIC_BASE_URL") || "https://api.minimaxi.com/anthropic",
      },
    });
    cases.push({
      name: "minimax-openai",
      model: readSmokeEnv("WHYJ_SMOKE_MINIMAX_OPENAI_MODEL") || "MiniMax-M2.7",
      env: {
        WHYJ_QUANT_API_KEY: minimaxToken,
        WHYJ_QUANT_AUTH_TOKEN: minimaxToken,
        WHYJ_QUANT_BASE_URL: readSmokeEnv("WHYJ_SMOKE_MINIMAX_OPENAI_BASE_URL") || "https://api.minimaxi.com/v1",
      },
    });
  }

  return cases;
}

function extractAssistantText(messages: Array<{ role?: string; content?: unknown }>): string | undefined {
  const assistant = [...messages].reverse().find((message) => message.role === "assistant");
  if (!assistant) return undefined;
  if (typeof assistant.content === "string") return assistant.content;
  if (!Array.isArray(assistant.content)) return undefined;
  const text = assistant.content
    .filter((part): part is { type?: string; text?: string } => typeof part === "object" && part !== null)
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text!.trim())
    .filter(Boolean)
    .join(" ");
  return text || undefined;
}

async function runCase(smokeCase: SmokeCase): Promise<SmokeResult> {
  const tempDir = mkdtempSync(join(tmpdir(), "ohq-provider-smoke-"));
  const previousOhquantDir = process.env.OHQUANT_DIR;

  try {
    process.env.OHQUANT_DIR = tempDir;
    writeFileSync(join(tempDir, "settings.json"), JSON.stringify({
      version: 1,
      env: canonicalizeWhyjEnv(smokeCase.env),
      model: smokeCase.model,
      thinkingLevel: "off",
      insightEnabled: false,
      showPortfolioPanel: false,
      skillIntegrations: { codex: false, claude: false },
      permissions: {},
      preferences: {
        defaultMarket: "A",
        defaultBenchmark: "000300.SH",
        defaultCash: 100000,
        defaultFast: 20,
        defaultSlow: 60,
        currentPortfolioFile: "holdings.json",
        source: "llmquant-data",
      },
    }, null, 2), "utf-8");

    const agent = createAgent({
      cwd: ROOT,
      sessionsRoot: join(tempDir, "sessions"),
    });

    await agent.waitForIdle();
    await agent.prompt(PROMPT);
    await agent.waitForIdle();

    return {
      name: smokeCase.name,
      ok: true,
      provider: agent.state.model.provider,
      api: agent.state.model.api,
      model: agent.state.model.id,
      baseUrl: agent.state.model.baseUrl,
      response: extractAssistantText(agent.state.messages as Array<{ role?: string; content?: unknown }>) || "(empty)",
    };
  } catch (error) {
    return {
      name: smokeCase.name,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    if (previousOhquantDir == null) delete process.env.OHQUANT_DIR;
    else process.env.OHQUANT_DIR = previousOhquantDir;
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const projectSettings = loadProjectSettings();
  const cases = [
    buildSettingsCase(projectSettings),
    ...buildVendorCases(),
  ].filter((value): value is SmokeCase => value !== null);

  if (cases.length === 0) {
    throw new Error(
      "No runnable smoke cases. Configure .ohquant/settings.json or set WHYJ_SMOKE_GLM_AUTH_TOKEN / WHYJ_SMOKE_MINIMAX_AUTH_TOKEN.",
    );
  }

  const results: SmokeResult[] = [];
  for (const smokeCase of cases) {
    results.push(await runCase(smokeCase));
  }

  console.log(JSON.stringify(results, null, 2));
  if (results.some((result) => !result.ok)) {
    process.exitCode = 1;
  }
}

await main();
