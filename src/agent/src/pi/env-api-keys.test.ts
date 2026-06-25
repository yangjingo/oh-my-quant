import { describe, expect, it } from "bun:test";

describe("getEnvApiKey", () => {
  it("prefers WHYJ_QUANT_API_KEY and falls back to WHYJ_QUANT_AUTH_TOKEN", async () => {
    const originalApiKey = process.env.WHYJ_QUANT_API_KEY;
    const originalAuthToken = process.env.WHYJ_QUANT_AUTH_TOKEN;
    process.env.WHYJ_QUANT_API_KEY = "provider-key";
    process.env.WHYJ_QUANT_AUTH_TOKEN = "legacy-auth-token";
    const { getEnvApiKey } = await import(`./env-api-keys.ts?case=${Date.now()}`);
    expect(getEnvApiKey("deepseek")).toBe("provider-key");

    delete process.env.WHYJ_QUANT_API_KEY;
    const { getEnvApiKey: getFallback } = await import(`./env-api-keys.ts?case=fallback-${Date.now()}`);
    expect(getFallback("deepseek")).toBe("legacy-auth-token");

    if (originalApiKey == null) delete process.env.WHYJ_QUANT_API_KEY;
    else process.env.WHYJ_QUANT_API_KEY = originalApiKey;
    if (originalAuthToken == null) delete process.env.WHYJ_QUANT_AUTH_TOKEN;
    else process.env.WHYJ_QUANT_AUTH_TOKEN = originalAuthToken;
  });
});
