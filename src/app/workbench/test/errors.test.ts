import { expect, test } from "bun:test";
import { modelError, publicError } from "../errors.ts";

test("model failures have actionable categories without echoing private provider messages", () => {
  const key = "fixture-key-never-project";
  for (const [message, code] of [[`The socket connection was closed unexpectedly ${key}`, "MODEL_CONNECTION"], [`401 unauthorized ${key}`, "MODEL_AUTH"],
    [`429 rate limited ${key}`, "MODEL_RATE_LIMIT"], [`request timed out ${key}`, "MODEL_TIMEOUT"], [`unknown payload ${key}`, "MODEL_REQUEST_FAILED"]]) {
    const error = modelError(new Error(message)); expect(error.code).toBe(code); expect(error.message).not.toContain(key);
  }
  expect(publicError(new Error(key)).message).not.toContain(key);
});
