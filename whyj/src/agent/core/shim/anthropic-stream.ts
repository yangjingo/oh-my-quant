import Anthropic from "@anthropic-ai/sdk";
import type {
  MessageParam,
  TextBlockParam,
  ImageBlockParam,
  ToolResultBlockParam,
  ToolUseBlock,
  Tool,
} from "@anthropic-ai/sdk/resources/messages/index.js";
import type {
  AssistantMessage,
  Context,
  Model,
  SimpleStreamOptions,
  TextContent,
  ThinkingContent,
  ToolCall,
  Usage,
} from "./types.ts";
import { AssistantMessageEventStream } from "./event-stream.ts";

// Default thinking budgets (tokens) per level
const DEFAULT_THINKING_BUDGETS: Record<string, number> = {
  minimal: 1_024,
  low: 2_048,
  medium: 4_096,
  high: 8_192,
  xhigh: 16_384,
};

/**
 * Anthropic-only streamSimple implementation.
 * Converts @anthropic-ai/sdk streaming to pi AssistantMessageEvent protocol.
 */
export function streamSimple(
  model: Model,
  context: Context,
  options?: SimpleStreamOptions,
): AssistantMessageEventStream {
  const stream = new AssistantMessageEventStream();
  void runStream(stream, model, context, options).catch((err) => {
    // Only push error if stream hasn't already been completed
    try {
      stream.push({
        type: "error" as const,
        reason: "error" as const,
        error: buildError(err, model),
      });
    } catch {
      // stream already closed
    }
  });
  return stream;
}

async function runStream(
  stream: AssistantMessageEventStream,
  model: Model,
  context: Context,
  options?: SimpleStreamOptions,
): Promise<void> {
  const signal = options?.signal;
  const apiKey = options?.apiKey || process.env["ANTHROPIC_API_KEY"];

  const client = new Anthropic({ apiKey });

  // Build system prompt
  const system = context.systemPrompt
    ? [{ type: "text" as const, text: context.systemPrompt, cache_control: { type: "ephemeral" as const } }]
    : undefined;

  // Cache control on tools
  const tools: Tool[] = (context.tools || []).map((t, i) => {
    const anthropicTool = {
      name: t.name,
      description: t.description,
      input_schema: t.parameters as unknown as Tool["input_schema"],
    } satisfies Tool;
    if (i === (context.tools?.length || 0) - 1) {
      (anthropicTool as Record<string, unknown>).cache_control = { type: "ephemeral" };
    }
    return anthropicTool;
  });

  // Convert messages
  const messages = convertMessages(context.messages);

  // Thinking config
  const thinkingLevel = options?.reasoning || "off";
  const budgets = options?.thinkingBudgets || {};
  let thinking: { type: "enabled"; budget_tokens: number } | { type: "disabled" } | undefined;
  if (thinkingLevel !== "off" && thinkingLevel !== "minimal") {
    thinking = {
      type: "enabled" as const,
      budget_tokens: (budgets as Record<string, number>)[thinkingLevel] || DEFAULT_THINKING_BUDGETS[thinkingLevel] || 4_096,
    };
  }

  // Build partial AssistantMessage progressively
  const partial: AssistantMessage = {
    role: "assistant",
    content: [],
    api: "anthropic-messages",
    provider: "anthropic",
    model: model.id,
    usage: zeroUsage(),
    stopReason: "stop",
    timestamp: Date.now(),
  };

  stream.push({ type: "start", partial: { ...partial } });

  try {
    const msgStream = client.messages.stream({
      model: model.id,
      max_tokens: options?.maxTokens || model.maxTokens || 4096,
      messages,
      system,
      tools: tools.length > 0 ? tools : undefined,
      thinking,
    });

    let contentIdx = 0;
    let currentToolCall: { id: string; name: string; args: string } | null = null;

    for await (const event of msgStream) {
      if (signal?.aborted) {
        stream.push({
          type: "error" as const,
          reason: "aborted" as const,
          error: { ...partial, stopReason: "aborted", errorMessage: "Request aborted" },
        });
        return;
      }

      switch (event.type) {
        case "content_block_start": {
          const block = event.content_block;
          if (block.type === "text") {
            partial.content.push({ type: "text", text: "" });
            stream.push({ type: "text_start", contentIndex: contentIdx, partial: { ...partial } });
          } else if (block.type === "thinking") {
            partial.content.push({ type: "thinking", thinking: "", thinkingSignature: block.signature });
            stream.push({ type: "thinking_start", contentIndex: contentIdx, partial: { ...partial } });
          } else if (block.type === "tool_use") {
            currentToolCall = { id: block.id, name: block.name, args: "" };
            partial.content.push({
              type: "toolCall",
              id: block.id,
              name: block.name,
              arguments: {},
            });
            stream.push({ type: "toolcall_start", contentIndex: contentIdx, partial: { ...partial } });
          }
          break;
        }

        case "content_block_delta": {
          const delta = event.delta;
          if (delta.type === "text_delta") {
            const tc = partial.content[contentIdx] as TextContent;
            tc.text += delta.text;
            stream.push({ type: "text_delta", contentIndex: contentIdx, delta: delta.text, partial: { ...partial } });
          } else if (delta.type === "thinking_delta") {
            const th = partial.content[contentIdx] as ThinkingContent;
            th.thinking += delta.thinking;
            stream.push({ type: "thinking_delta", contentIndex: contentIdx, delta: delta.thinking, partial: { ...partial } });
          } else if (delta.type === "input_json_delta") {
            if (currentToolCall) {
              currentToolCall.args += delta.partial_json;
              try {
                (partial.content[contentIdx] as ToolCall).arguments = JSON.parse(currentToolCall.args);
              } catch {
                // partial JSON, continue
              }
              stream.push({ type: "toolcall_delta", contentIndex: contentIdx, delta: delta.partial_json, partial: { ...partial } });
            }
          }
          break;
        }

        case "content_block_stop": {
          const block = partial.content[contentIdx];
          if (block?.type === "text") {
            stream.push({ type: "text_end", contentIndex: contentIdx, content: (block as TextContent).text, partial: { ...partial } });
          } else if (block?.type === "thinking") {
            stream.push({ type: "thinking_end", contentIndex: contentIdx, content: (block as ThinkingContent).thinking, partial: { ...partial } });
          } else if (block?.type === "toolCall") {
            const tc = block as ToolCall;
            stream.push({ type: "toolcall_end", contentIndex: contentIdx, toolCall: { ...tc }, partial: { ...partial } });
          }
          contentIdx++;
          break;
        }

        case "message_start": {
          // Just update model info if present
          if (event.message.model) partial.model = event.message.model;
          break;
        }

        case "message_delta": {
          if (event.usage) partial.usage = computeUsage(event.usage, model);
          if (event.delta.stop_reason) {
            partial.stopReason = mapStopReason(event.delta.stop_reason as string);
          }
          break;
        }

        case "message_stop": {
          // Finalize
          stream.push({
            type: "done",
            reason: (partial.stopReason === "stop" || partial.stopReason === "length" || partial.stopReason === "toolUse")
              ? partial.stopReason as "stop" | "length" | "toolUse"
              : "stop",
            message: { ...partial },
          });
          return;
        }
      }
    }
  } catch (err) {
    stream.push({
      type: "error" as const,
      reason: "error" as const,
      error: buildError(err, model),
    });
  }
}

// --- Helpers ---

function convertMessages(messages: { role: string; content: unknown; timestamp: number; toolCallId?: string; toolName?: string; isError?: boolean }[]): MessageParam[] {
  if (messages.length === 0) return [{ role: "user", content: "Hello" }];
  const result: MessageParam[] = [];
  for (const m of messages) {
    switch (m.role) {
      case "user":
        result.push({ role: "user", content: typeof m.content === "string" ? m.content : (m.content as (TextBlockParam | ImageBlockParam)[]) });
        break;
      case "assistant": {
        const content = (m.content as Array<Record<string, unknown>>).map((c: Record<string, unknown>) => {
          if (c.type === "toolCall") {
            return {
              type: "tool_use" as const,
              id: c.id as string,
              name: c.name as string,
              input: c.arguments as Record<string, unknown>,
            };
          }
          if (c.type === "thinking") {
            return {
              type: "thinking" as const,
              thinking: c.thinking as string,
              signature: (c as Record<string, string>).thinkingSignature || "",
            };
          }
          return { type: "text" as const, text: (c as Record<string, string>).text || "" };
        });
        result.push({ role: "assistant", content: content as MessageParam["content"] });
        break;
      }
      case "toolResult":
        result.push({
          role: "user",
          content: [{
            type: "tool_result" as const,
            tool_use_id: m.toolCallId || "",
            content: typeof m.content === "string" ? m.content : JSON.stringify((m.content as Array<{ text?: string }>)?.[0]?.text || m.content),
            is_error: m.isError,
          } as ToolResultBlockParam],
        });
        break;
    }
  }
  return result;
}

function computeUsage(
  usage: { input_tokens: number | null; output_tokens: number | null; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null },
  model: Model,
): Usage {
  const input = usage.input_tokens ?? 0;
  const output = usage.output_tokens ?? 0;
  const cacheRead = usage.cache_read_input_tokens || 0;
  const cacheWrite = usage.cache_creation_input_tokens || 0;
  const cost = model.cost || { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    totalTokens: input + output + cacheRead + cacheWrite,
    cost: {
      input: (input / 1_000_000) * cost.input,
      output: (output / 1_000_000) * cost.output,
      cacheRead: (cacheRead / 1_000_000) * cost.cacheRead,
      cacheWrite: (cacheWrite / 1_000_000) * cost.cacheWrite,
      total: 0,
    },
  };
}

function mapStopReason(reason: string): AssistantMessage["stopReason"] {
  switch (reason) {
    case "end_turn": return "stop";
    case "max_tokens": return "length";
    case "tool_use": return "toolUse";
    default: return "stop";
  }
}

function buildError(err: unknown, model: Model): AssistantMessage {
  const msg = err instanceof Error ? err.message : String(err);
  return {
    role: "assistant",
    content: [],
    api: "anthropic-messages",
    provider: "anthropic",
    model: model.id,
    usage: zeroUsage(),
    stopReason: "error",
    errorMessage: msg,
    timestamp: Date.now(),
  };
}

function zeroUsage(): Usage {
  return {
    input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}
