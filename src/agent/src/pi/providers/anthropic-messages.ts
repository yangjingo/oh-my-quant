import { Anthropic } from "@anthropic-ai/sdk";
import { calculateCost, clampThinkingLevel } from "../models.ts";
import type {
	AssistantMessage,
	AssistantMessageEvent,
	Context,
	Message,
	Model,
	SimpleStreamOptions,
	StopReason,
	StreamFunction,
	StreamOptions,
	TextContent,
	ThinkingContent,
	ToolCall,
	ToolResultMessage,
	Usage,
} from "../llm-types.ts";
import { AssistantMessageEventStream } from "../utils/event-stream.ts";
import { headersToRecord } from "../utils/headers.ts";
import { parseStreamingJson } from "../utils/json-parse.ts";
import { transformMessages } from "./transform-messages.ts";

export interface AnthropicMessagesOptions extends StreamOptions {
	toolChoice?: Anthropic.ToolChoice;
}

type AnthropicContentBlock =
	| Anthropic.TextBlockParam
	| Anthropic.ImageBlockParam
	| Anthropic.ThinkingBlockParam
	| Anthropic.RedactedThinkingBlockParam
	| Anthropic.ToolUseBlockParam
	| Anthropic.ToolResultBlockParam;

interface StreamingToolCallBlock extends ToolCall {
	partialArgs?: string;
	streamIndex?: number;
}

function zeroUsage(): Usage {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

function mapStopReason(reason: Anthropic.StopReason | null | undefined): {
	stopReason: StopReason;
	errorMessage?: string;
} {
	switch (reason) {
		case "end_turn":
			return { stopReason: "stop" };
		case "max_tokens":
			return { stopReason: "length" };
		case "tool_use":
			return { stopReason: "toolUse" };
		case "pause_turn":
			return { stopReason: "stop" };
		case "refusal":
			return { stopReason: "error", errorMessage: "Provider stop_reason: refusal" };
		case null:
		case undefined:
			return { stopReason: "stop" };
		default:
			return { stopReason: "error", errorMessage: `Provider stop_reason: ${reason}` };
	}
}

function mapUsage(usage: { input_tokens?: number | null; output_tokens?: number | null; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null } | undefined, model: Model<"anthropic-messages">): Usage {
	const result = zeroUsage();
	if (usage) {
		result.input = usage.input_tokens ?? 0;
		result.output = usage.output_tokens ?? 0;
		result.cacheRead = usage.cache_read_input_tokens ?? 0;
		result.cacheWrite = usage.cache_creation_input_tokens ?? 0;
		result.totalTokens = result.input + result.output + result.cacheRead + result.cacheWrite;
	}
	calculateCost(model, result);
	return result;
}

function isTextContentBlock(block: TextContent | ThinkingContent | ToolCall): block is TextContent {
	return block.type === "text";
}

function isThinkingContentBlock(block: TextContent | ThinkingContent | ToolCall): block is ThinkingContent {
	return block.type === "thinking";
}

function isToolCallBlock(block: TextContent | ThinkingContent | ToolCall): block is ToolCall {
	return block.type === "toolCall";
}

function toAnthropicTextPart(content: TextContent): Anthropic.TextBlockParam {
	return { type: "text", text: content.text };
}

function toAnthropicImagePart(content: { data: string; mimeType: string }): Anthropic.ImageBlockParam {
	const mediaType = content.mimeType as Anthropic.Base64ImageSource["media_type"];
	return {
		type: "image",
		source: {
			type: "base64",
			data: content.data,
			media_type: mediaType,
		},
	};
}

function toAnthropicContentBlock(block: TextContent | ThinkingContent | ToolCall | { type: "image"; data: string; mimeType: string }): AnthropicContentBlock {
	if (block.type === "text") {
		return toAnthropicTextPart(block);
	}
	if (block.type === "image") {
		return toAnthropicImagePart(block);
	}
	if (block.type === "thinking") {
		if (block.redacted) {
			return {
				type: "redacted_thinking",
				data: block.thinkingSignature || block.thinking,
			};
		}
		return {
			type: "thinking",
			thinking: block.thinking,
			signature: block.thinkingSignature || "",
		};
	}
	return {
		type: "tool_use",
		id: block.id,
		name: block.name,
		input: block.arguments,
	};
}

function toAnthropicMessage(msg: Message): Anthropic.MessageParam | null {
	if (msg.role === "user") {
		if (typeof msg.content === "string") {
			return { role: "user", content: msg.content };
		}
		return {
			role: "user",
			content: msg.content.map((block) =>
				block.type === "image" ? toAnthropicImagePart(block) : toAnthropicTextPart(block)
			),
		};
	}

	if (msg.role === "toolResult") {
		const toolResult = msg as ToolResultMessage;
		return {
			role: "user",
			content: [
				{
					type: "tool_result",
					tool_use_id: toolResult.toolCallId,
					is_error: toolResult.isError,
					content:
						toolResult.content.length === 1 && toolResult.content[0]?.type === "text"
							? toolResult.content[0].text
							: toolResult.content.map((block) =>
									block.type === "text"
										? toAnthropicTextPart(block)
										: toAnthropicImagePart(block),
								),
				},
			],
		};
	}

	if (msg.role === "assistant") {
		return {
			role: "assistant",
			content: msg.content.map((block) => toAnthropicContentBlock(block)),
		};
	}

	return null;
}

function buildMessages(context: Context, model: Model<"anthropic-messages">): Anthropic.MessageParam[] {
	const transformed = transformMessages(context.messages as Message[], model);
	const result: Anthropic.MessageParam[] = [];

	for (let i = 0; i < transformed.length; i++) {
		const msg = transformed[i];
		if (msg.role !== "toolResult") {
			const anthropicMsg = toAnthropicMessage(msg);
			if (
				anthropicMsg &&
				!(anthropicMsg.role === "assistant" && Array.isArray(anthropicMsg.content) && anthropicMsg.content.length === 0)
			) {
				result.push(anthropicMsg);
			}
			continue;
		}

		const toolResults: ToolResultMessage[] = [];
		for (; i < transformed.length && transformed[i].role === "toolResult"; i++) {
			toolResults.push(transformed[i] as ToolResultMessage);
		}
		i -= 1;

		result.push({
			role: "user",
			content: toolResults.flatMap((toolResult) => {
				const parts: Anthropic.ToolResultBlockParam[] = [
					{
						type: "tool_result",
						tool_use_id: toolResult.toolCallId,
						is_error: toolResult.isError,
						content:
							toolResult.content.length === 1 && toolResult.content[0]?.type === "text"
								? toolResult.content[0].text
								: toolResult.content.map((block) =>
										block.type === "text"
											? toAnthropicTextPart(block)
											: toAnthropicImagePart(block),
									),
					},
				];
				return parts;
			}),
		});
	}

	return result;
}

function buildTools(context: Context): Anthropic.Tool[] | undefined {
	if (!context.tools || context.tools.length === 0) return undefined;
	return context.tools.map((tool) => ({
		name: tool.name,
		description: tool.description,
		input_schema: tool.parameters as Anthropic.Tool.InputSchema,
	}));
}

function buildClient(model: Model<"anthropic-messages">, options?: StreamOptions): Anthropic {
	const defaultHeaders = {
		...(model.headers || {}),
		...(options?.headers || {}),
	};
	return new Anthropic({
		apiKey: options?.apiKey,
		baseURL: model.baseUrl,
		timeout: options?.timeoutMs,
		maxRetries: options?.maxRetries,
		defaultHeaders,
	});
}

function createLazyMessage(
	model: Model<"anthropic-messages">,
	error: unknown,
): AssistantMessage {
	return {
		role: "assistant",
		content: [],
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: zeroUsage(),
		stopReason: "error",
		errorMessage: error instanceof Error ? error.message : String(error),
		timestamp: Date.now(),
	};
}

function updateUsage(output: AssistantMessage, usage: Anthropic.Usage | undefined, model: Model<"anthropic-messages">): void {
	if (!usage) return;
	output.usage = mapUsage(usage, model);
}

function pushContentStart(
	stream: AssistantMessageEventStream,
	output: AssistantMessage,
	block: TextContent | ThinkingContent | StreamingToolCallBlock,
	index: number,
): void {
	if (block.type === "text") {
		stream.push({ type: "text_start", contentIndex: index, partial: output });
		return;
	}
	if (block.type === "thinking") {
		stream.push({ type: "thinking_start", contentIndex: index, partial: output });
		return;
	}
	stream.push({ type: "toolcall_start", contentIndex: index, partial: output });
}

function finishBlock(
	stream: AssistantMessageEventStream,
	output: AssistantMessage,
	block: TextContent | ThinkingContent | StreamingToolCallBlock,
	index: number,
): void {
	if (block.type === "text") {
		stream.push({ type: "text_end", contentIndex: index, content: block.text, partial: output });
		return;
	}
	if (block.type === "thinking") {
		stream.push({ type: "thinking_end", contentIndex: index, content: block.thinking, partial: output });
		return;
	}
	block.arguments = parseStreamingJson(block.partialArgs);
	delete block.partialArgs;
	delete block.streamIndex;
	stream.push({ type: "toolcall_end", contentIndex: index, toolCall: block, partial: output });
}

function makeZeroedOutput(model: Model<"anthropic-messages">): AssistantMessage {
	return {
		role: "assistant",
		content: [],
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: zeroUsage(),
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

function updateAnthropicBlock(
	output: AssistantMessage,
	stream: AssistantMessageEventStream,
	blockByIndex: Map<number, TextContent | ThinkingContent | StreamingToolCallBlock>,
	index: number,
	delta: Anthropic.RawContentBlockDelta,
): void {
	const block = blockByIndex.get(index);
	if (!block) return;

	if (delta.type === "text_delta" && block.type === "text") {
		block.text += delta.text;
		stream.push({ type: "text_delta", contentIndex: index, delta: delta.text, partial: output });
		return;
	}

	if (delta.type === "thinking_delta" && block.type === "thinking") {
		block.thinking += delta.thinking;
		stream.push({ type: "thinking_delta", contentIndex: index, delta: delta.thinking, partial: output });
		return;
	}

	if (delta.type === "input_json_delta" && block.type === "toolCall") {
		block.partialArgs = (block.partialArgs ?? "") + delta.partial_json;
		block.arguments = parseStreamingJson(block.partialArgs);
		stream.push({ type: "toolcall_delta", contentIndex: index, delta: delta.partial_json, partial: output });
		return;
	}

	if (delta.type === "signature_delta" && block.type === "thinking") {
		block.thinkingSignature = delta.signature;
	}
}

export const streamAnthropicMessages: StreamFunction<"anthropic-messages", AnthropicMessagesOptions> = (
	model: Model<"anthropic-messages">,
	context: Context,
	options?: AnthropicMessagesOptions,
): AssistantMessageEventStream => {
	const stream = new AssistantMessageEventStream();

	(async () => {
		const output = makeZeroedOutput(model);
		try {
			const apiKey = options?.apiKey;
			if (!apiKey) {
				throw new Error("No API key configured. Set WHYJ_QUANT_API_KEY in .ohquant/settings.json or /config.");
			}

			const client = buildClient(model, options);
			const params: Anthropic.MessageCreateParamsStreaming = {
				model: model.id,
				max_tokens: options?.maxTokens ?? model.maxTokens,
				messages: buildMessages(context, model),
				stream: true,
			};

			if (context.systemPrompt) {
				params.system = context.systemPrompt;
			}

			const tools = buildTools(context);
			if (tools && tools.length > 0) {
				params.tools = tools;
				if (options?.toolChoice) {
					params.tool_choice = options.toolChoice;
				}
			}

			if (options?.temperature !== undefined) {
				params.temperature = options.temperature;
			}

			const request = client.messages.stream(params, {
				...(options?.signal ? { signal: options.signal } : {}),
			});
			const { data: messageStream, response } = await request.withResponse();
			await options?.onResponse?.({ status: response.status, headers: headersToRecord(response.headers) }, model);

			stream.push({ type: "start", partial: output });

			const blockByIndex = new Map<number, TextContent | ThinkingContent | StreamingToolCallBlock>();
			const messageStreamAny = messageStream as AsyncIterable<Anthropic.RawMessageStreamEvent>;

			for await (const event of messageStreamAny) {
				if (event.type === "message_start") {
					output.responseId ||= event.message.id;
					if (event.message.model && event.message.model !== model.id) {
						output.responseModel ||= event.message.model;
					}
					continue;
				}

				if (event.type === "content_block_start") {
					const block = event.content_block;
					let contentBlock: TextContent | ThinkingContent | StreamingToolCallBlock | null = null;
					if (block.type === "text") {
						contentBlock = { type: "text", text: block.text || "" };
					} else if (block.type === "thinking") {
						contentBlock = {
							type: "thinking",
							thinking: block.thinking || "",
							thinkingSignature: block.signature || undefined,
						};
					} else if (block.type === "redacted_thinking") {
						contentBlock = {
							type: "thinking",
							thinking: "",
							thinkingSignature: block.data,
							redacted: true,
						};
					} else if (block.type === "tool_use") {
						contentBlock = {
							type: "toolCall",
							id: block.id,
							name: block.name,
							arguments: typeof block.input === "object" && block.input ? (block.input as Record<string, any>) : {},
							partialArgs: "",
						};
					}

					if (contentBlock) {
						blockByIndex.set(event.index, contentBlock);
						(output.content as Array<TextContent | ThinkingContent | ToolCall>).push(contentBlock as any);
						pushContentStart(stream, output, contentBlock, event.index);
					}
					continue;
				}

				if (event.type === "content_block_delta") {
					updateAnthropicBlock(output, stream, blockByIndex, event.index, event.delta);
					continue;
				}

				if (event.type === "content_block_stop") {
					const block = blockByIndex.get(event.index);
					if (block) {
						finishBlock(stream, output, block, event.index);
					}
					continue;
				}

				if (event.type === "message_delta") {
					output.stopReason = mapStopReason(event.delta.stop_reason).stopReason;
					const mapped = mapStopReason(event.delta.stop_reason);
					if (mapped.errorMessage) output.errorMessage = mapped.errorMessage;
			updateUsage(output, event.usage as any, model);
				}
			}

			const finalMessage = await messageStream.finalMessage();
			output.responseId ||= finalMessage.id;
			if (finalMessage.model && finalMessage.model !== model.id) {
				output.responseModel ||= finalMessage.model;
			}
			output.stopReason = mapStopReason(finalMessage.stop_reason).stopReason;
			if (mapStopReason(finalMessage.stop_reason).errorMessage) {
				output.errorMessage = mapStopReason(finalMessage.stop_reason).errorMessage;
			}
			updateUsage(output, finalMessage.usage as any, model);

			if (output.stopReason === "error") {
				throw new Error(output.errorMessage || "Provider returned an error stop reason");
			}

			stream.push({ type: "done", reason: output.stopReason === "aborted" ? "stop" : output.stopReason, message: output });
			stream.end();
		} catch (error) {
			output.stopReason = options?.signal?.aborted ? "aborted" : "error";
			output.errorMessage = error instanceof Error ? error.message : JSON.stringify(error);
			stream.push({ type: "error", reason: output.stopReason, error: output });
			stream.end();
		}
	})();

	return stream;
};

export const streamSimpleAnthropicMessages: StreamFunction<"anthropic-messages", SimpleStreamOptions> = (
	model: Model<"anthropic-messages">,
	context: Context,
	options?: SimpleStreamOptions,
): AssistantMessageEventStream => {
	return streamAnthropicMessages(model, context, {
		...options,
		maxTokens: options?.maxTokens ?? model.maxTokens,
	});
};
