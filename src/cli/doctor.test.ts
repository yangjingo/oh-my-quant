import { describe, expect, it } from "bun:test";
import { runDoctor, formatDoctorText } from "./doctor.ts";
import { DEFAULT_SETTINGS } from "../types/config.ts";

describe("doctor", () => {
  it("reports missing credentials with actionable hints", () => {
    const doctor = runDoctor(DEFAULT_SETTINGS, {});
    expect(doctor.ready).toBe(true);
    expect(doctor.auth.WHYJ_QUANT_API_KEY).toEqual({ available: false, source: "missing", value: "-" });
    expect(doctor.hints).toEqual([
      expect.stringContaining("Add WHYJ_QUANT_API_KEY"),
      expect.stringContaining("Add a market data key"),
    ]);

    const text = formatDoctorText(doctor);
    expect(text).toContain("WhyJ Doctor");
    expect(text).toContain("command        whyj doctor");
    expect(text).toContain("Credentials");
    expect(text).toContain("WHYJ_QUANT_API_KEY");
    expect(text).toContain("base url");
    expect(text).toContain("Hints");
    expect(text).not.toContain("secret");
  });

  it("prefers env source over config source and suppresses resolved hints", () => {
    const doctor = runDoctor({
      ...DEFAULT_SETTINGS,
      env: {
        WHYJ_QUANT_API_KEY: "from-config",
        WHYJ_QUANT_BASE_URL: "https://api.deepseek.com/anthropic",
        WHYJ_QUANT_LLMQUANT_API_KEY: "from-config",
      },
    }, {
      WHYJ_QUANT_API_KEY: "from-env",
    });

    expect(doctor.auth.WHYJ_QUANT_API_KEY).toEqual(expect.objectContaining({
      available: true,
      source: "env",
      value: expect.stringContaining("from...-env"),
    }));
    expect(doctor.auth.WHYJ_QUANT_LLMQUANT_API_KEY).toEqual(expect.objectContaining({
      available: true,
      source: "config",
      value: expect.stringContaining("from...nfig"),
    }));
    expect(doctor.config.baseUrl).toBe("https://api.deepseek.com/anthropic");
    expect(doctor.config.endpointMode).toBe("Anthropic Messages");
    expect(doctor.hints).toEqual([]);
  });

  it("shows redacted concrete values and sanitizes broken ANSI fragments", () => {
    const doctor = runDoctor({
      ...DEFAULT_SETTINGS,
      model: "deepseek-v4-pro\x1b[1m[1m]",
      thinkingLevel: "high",
      env: {
        WHYJ_QUANT_AUTH_TOKEN: "sk-test-secret-1234",
        WHYJ_QUANT_API_KEY: "provider-secret-1234",
        WHYJ_QUANT_BASE_URL: "https://api.deepseek.com/anthropic",
        WHYJ_QUANT_LLMQUANT_API_KEY: "llmq-secret-5678",
      },
    }, {});

    expect(doctor.config.model).toBe("deepseek-v4-pro");
    expect(doctor.config.baseUrl).toBe("https://api.deepseek.com/anthropic");
    expect(doctor.config.endpointMode).toBe("Anthropic Messages");
    expect(doctor.auth.WHYJ_QUANT_AUTH_TOKEN.value).toMatch(/^sk-t\.\.\.1234 · fp:[0-9a-f]{8}$/);
    expect(formatDoctorText(doctor)).toContain("value");
    expect(formatDoctorText(doctor)).not.toContain("[1m");
    expect(formatDoctorText(doctor)).not.toContain("sk-test-secret-1234");
  });
});
