import type { ToolActivity } from "../../types/workbench.ts";
import { redactModelText } from "./redaction.ts";

const LIMIT = 16_000;
const credential = /^(?:authorization|proxy-authorization|cookie|set-cookie|password|passwd|secret|token|access_token|refresh_token|api[-_]?key)$/i;

function redactHeaders(text: string): string {
  // Header values can contain spaces/commas and folded continuation lines.
  return text.replace(/(\b(?:proxy-)?authorization[\t ]*[=:][\t ]*)([^\r\n]*(?:\r?\n[\t ]+[^\r\n]*)*)/gi,
    (_, prefix: string, value: string) => prefix + value.replace(/[^\r\n]+/g, line => line.replace(/^([\t ]*).*$/, "$1[REDACTED]")))
    .replace(/\b(Bearer[\t ]+)\S+/gi, "$1[REDACTED]")
    .replace(/((?:api[-_]?key|access_token|refresh_token|password)[\t ]*[=:][\t ]*)[^\s&,;]+/gi, "$1[REDACTED]");
}

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
    try {
      JSON.parse(text); // Validate only; never serialize parsed financial numbers.
      // Header prose inside JSON strings ends at that string, not at the JSON line end.
      text = text.replace(/"(?:\\.|[^"\\])*"/g, token => {
        const decoded = JSON.parse(token) as string, safe = redactHeaders(decoded);
        return safe === decoded ? token : JSON.stringify(safe);
      });
    } catch { text = redactHeaders(text); }
    texts.push(text);
  }
  const text = texts.join("\n\n");
  return { text: text.slice(0, LIMIT), truncated: text.length > LIMIT, omittedBlocks, capturedAt: new Date().toISOString() };
}
