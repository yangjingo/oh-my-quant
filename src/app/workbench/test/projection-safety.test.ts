import { expect, test } from "bun:test";
import { DEFAULT_SETTINGS } from "../../../types/config.ts";
import { secretValues } from "../model.ts";
import { redactModelText } from "../redaction.ts";
import { hasExplicitReference } from "../references.ts";

test("supported canonical and legacy credential slots feed the same streaming redaction", () => {
  for (const name of ["WHYJ_QUANT_TUSHARE_TOKEN", "TUSHARE_TOKEN", "WHYJ_QUANT_FINANCIAL_DATASETS_KEY", "FINANCIAL_DATASETS_KEY"]) {
    const settings = structuredClone(DEFAULT_SETTINGS), key = "synthetic-review-" + name;
    settings.env = { [name]: key }; const secrets = secretValues(settings);
    expect(secrets.includes(key)).toBe(true);
    expect(redactModelText("readable " + key.slice(0, 15), secrets, true)).toBe("readable ");
    expect(redactModelText("readable " + key, secrets, true)).toBe("readable [REDACTED]");
    expect(redactModelText("readable " + key, secrets)).toBe("readable [REDACTED]");
  }
});
test("explicit references do not conflate emails, escaped examples or code with access requests", () => {
  for (const text of ["@file:a.md", "Read @dir:docs", "Use (@session:123)", "Check @evidence:abc"]) expect(hasExplicitReference(text)).toBe(true);
  for (const text of ["user@example.com", "\\@file:a.md", "`@file:a.md`", "```text\n@file:a.md\n```", "@", "ordinary @mention"]) expect(hasExplicitReference(text)).toBe(false);
});


test("a path containing a configured credential remains hidden during partial streaming", () => {
  const path = "/home/synthetic-user/reports/annual.html", secrets = ["synthetic-user", path];
  expect(redactModelText("Report: " + path.slice(0, 20), secrets, true)).toBe("Report: ");
  expect(redactModelText("Report: " + path, secrets, true)).toBe("Report: [REDACTED]");
  expect(redactModelText("Report: " + path, secrets)).toBe("Report: [REDACTED]");
});
