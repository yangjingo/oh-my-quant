import type { ToolActivity } from "../../types/workbench.ts";
import { redactModelText } from "./redaction.ts";

const LIMIT = 16_000;
const credential = /^(?:authorization|proxy-authorization|cookie|set-cookie|password|passwd|secret|token|access_token|refresh_token|api[-_]?key)$/i;

/** Only model-visible text blocks, never provider envelopes, binary bodies or local files. */
export function toolResult(result: unknown, secrets: readonly string[]): NonNullable<ToolActivity["result"]> {
  const content = result && typeof result === "object" ? (result as { content?: unknown }).content : undefined;
  const blocks = Array.isArray(content) ? content : [];
  let omittedBlocks = 0;
  const texts: string[] = [];
  for (const block of blocks) {
    if (!block || block.type !== "text" || typeof block.text !== "string") { omittedBlocks++; continue; }
    let text = redactModelText(block.text, secrets);
    // Replace credential scalar fields without parsing numbers or reformatting the result.
    text = text.replace(/("(?:\\.|[^"\\])*")(\s*:\s*)("(?:\\.|[^"\\])*"|true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g,
      (whole, key: string, separator: string) => {
        try { return credential.test(JSON.parse(key) as string) ? key + separator + '"[REDACTED]"' : whole; }
        catch { return whole; }
      });
    text = text.replace(/\b(Bearer\s+)\S+/gi, "$1[REDACTED]")
      .replace(/((?:api[-_]?key|access_token|refresh_token|password|authorization)\s*[=:]\s*)[^\s&,;]+/gi, "$1[REDACTED]");
    texts.push(text);
  }
  const text = texts.join("\n\n");
  return { text: text.slice(0, LIMIT), truncated: text.length > LIMIT, omittedBlocks, capturedAt: new Date().toISOString() };
}
