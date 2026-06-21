import { extractConversationSelection, lastAssistantPlainText, type ConversationSelection, type ConversationView } from "./selection.ts";
import type { UIMessage } from "./types.ts";

export function resolveCopyText(
  panel: "conversation" | "overview",
  view: ConversationView,
  selection: ConversationSelection | null,
  messages: UIMessage[],
): string {
  const fallback = panel === "conversation" ? lastAssistantPlainText(messages) : "";
  return selection ? extractConversationSelection(view, selection) : fallback;
}
