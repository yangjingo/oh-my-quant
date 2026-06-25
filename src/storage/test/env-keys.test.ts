import { describe, expect, it } from "bun:test";
import { canonicalizeWhyjEnv, hasWhyjEnvValue, readWhyjEnvValue } from "../src/env-keys.ts";
import { readWhyjEnvValue as readWhyjEnvValueFromBarrel } from "../index.ts";

describe("WhyJ env key aliases", () => {
  it("reads the canonical source keys", () => {
    const env = {
      WHYJ_QUANT_API_KEY: "api-key",
      WHYJ_QUANT_BASE_URL: "https://api.deepseek.com/anthropic",
      WHYJ_QUANT_TUSHARE_TOKEN: "tushare",
      WHYJ_QUANT_FINANCIAL_DATASETS_KEY: "fd",
      WHYJ_QUANT_LLMQUANT_API_KEY: "llmq",
    };

    expect(readWhyjEnvValue(env, "apiKey")).toBe("api-key");
    expect(readWhyjEnvValue(env, "baseUrl")).toBe("https://api.deepseek.com/anthropic");
    expect(readWhyjEnvValue(env, "tushareToken")).toBe("tushare");
    expect(readWhyjEnvValue(env, "financialDatasetsKey")).toBe("fd");
    expect(readWhyjEnvValue(env, "llmquantApiKey")).toBe("llmq");
    expect(hasWhyjEnvValue(env, "apiKey")).toBe(true);
  });

  it("does not resolve removed legacy source aliases", () => {
    const env = {
      WHYJ_API_KEY: "legacy-api-key",
      WHYJ_AUTH_TOKEN: "legacy-auth-token",
    };

    expect(readWhyjEnvValue(env, "apiKey")).toBeUndefined();
    expect(readWhyjEnvValue(env, "authToken")).toBeUndefined();
    expect(hasWhyjEnvValue(env, "apiKey")).toBe(false);
    expect(canonicalizeWhyjEnvKeyList(env)).toEqual(["WHYJ_API_KEY", "WHYJ_AUTH_TOKEN"]);
  });

  it("re-exports readWhyjEnvValue through the storage barrel", () => {
    const env = {
      WHYJ_QUANT_API_KEY: "api-key",
    };

    expect(readWhyjEnvValueFromBarrel(env, "apiKey")).toBe("api-key");
  });
});

function canonicalizeWhyjEnvKeyList(env: Record<string, string>) {
  return Object.keys(canonicalizeWhyjEnv(env)).sort();
}
