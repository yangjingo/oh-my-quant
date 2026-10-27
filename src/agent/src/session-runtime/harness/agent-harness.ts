import { HarnessOperation } from './operation.ts';
import { cloneStreamOptions, mergeHeaders, applyStreamOptionsPatch } from './stream-options.ts';
import {
	type AssistantMessage,
	type ImageContent,
	type Model,
} from "@earendil-works/pi-ai";
import { runAgentLoop } from "../../kernel/loop.ts";
import { streamSimple } from "../../kernel/llm.ts";
import type {
	AgentContext,
	AgentEvent,
	AgentLoopConfig,
	AgentMessage,
	AgentTool,
	QueueMode,
	StreamFn,
	ThinkingLevel,
} from "../types.ts";
import { compactSession } from "./session/compact-session.ts";
import { navigateSession } from "./session/navigate-session.ts";
import { convertToLlm, createDisplayUserMessage } from "./messages.ts";
import { formatPromptTemplateInvocation } from "./prompt-templates.ts";
import { formatSkillInvocation } from "./skills.ts";
import type {
	AbortResult,
	AgentHarnessEvent,
	AgentHarnessEventResultMap,
	AgentHarnessOptions,
	AgentHarnessOwnEvent,
	AgentHarnessResources,
	AgentHarnessStreamOptions,
	ExecutionEnv,
	NavigateTreeResult,
	PendingSessionWrite,
	PromptTemplate,
	Session,
	Skill,
} from "./types.ts";
import { AgentHarnessError, BranchSummaryError, CompactionError, SessionError, toError } from "./types.ts";

function createUserMessage(text: string, images?: ImageContent[], displayText = text): AgentMessage {
	return createDisplayUserMessage(text, displayText, images);
}

function createSkillDisplayText(name: string): string {
	return `SKILL.${name}`;
}

function createFailureMessage(model: Model<any>, error: unknown, aborted: boolean): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text: "" }],
		api: model.api,
		provider: model.provider,
		model: model.id,
		stopReason: aborted ? "aborted" : "error",
		errorMessage: error instanceof Error ? error.message : String(error),
		timestamp: Date.now(),
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
	};
}

function findDuplicateNames(names: string[]): string[] {
	const seen = new Set<string>();
	const duplicates = new Set<string>();
	for (const name of names) {
		if (seen.has(name)) duplicates.add(name);
		seen.add(name);
	}
	return [...duplicates];
}

const SUBSCRIBER_EVENT_TYPE = "*";

type AgentHarnessHandler = (event: any, signal?: AbortSignal) => Promise<any> | any;

function normalizeHarnessError(error: unknown, fallbackCode: AgentHarnessError["code"]): AgentHarnessError {
	if (error instanceof AgentHarnessError) return error;
	const cause = toError(error);
	if (cause instanceof SessionError) return new AgentHarnessError("session", cause.message, cause);
	if (cause instanceof CompactionError) return new AgentHarnessError("compaction", cause.message, cause);
	if (cause instanceof BranchSummaryError) return new AgentHarnessError("branch_summary", cause.message, cause);
	return new AgentHarnessError(fallbackCode, cause.message, cause);
}

function normalizeHookError(error: unknown): AgentHarnessError {
	return normalizeHarnessError(error, "hook");
}

interface AgentHarnessTurnState<
	TSkill extends Skill = Skill,
	TPromptTemplate extends PromptTemplate = PromptTemplate,
	TTool extends AgentTool = AgentTool,
> {
	messages: AgentMessage[];
	resources: AgentHarnessResources<TSkill, TPromptTemplate>;
	streamOptions: AgentHarnessStreamOptions;
	sessionId: string;
	systemPrompt: string;
	model: Model<any>;
	thinkingLevel: ThinkingLevel;
	tools: TTool[];
	activeTools: TTool[];
}

export class AgentHarness<
	TSkill extends Skill = Skill,
	TPromptTemplate extends PromptTemplate = PromptTemplate,
	TTool extends AgentTool = AgentTool,
> {
	readonly env: ExecutionEnv;
	private session: Session;
	private readonly operation = new HarnessOperation();
	private pendingSessionWrites: PendingSessionWrite[] = [];
	private model: Model<any>;
	private thinkingLevel: ThinkingLevel;
	private systemPrompt: AgentHarnessOptions<TSkill, TPromptTemplate, TTool>["systemPrompt"];
	private streamOptions: AgentHarnessStreamOptions;
	private getApiKeyAndHeaders?: AgentHarnessOptions["getApiKeyAndHeaders"];
	private resources: AgentHarnessResources<TSkill, TPromptTemplate>;
	private readonly prepareTurnResources: AgentHarnessOptions<TSkill, TPromptTemplate, TTool>["prepareTurnResources"];
	private tools = new Map<string, TTool>();
	private activeToolNames: string[];
	private steerQueue: AgentMessage[] = [];
	private acceptingQueuedInput = false;
	private steeringQueueMode: QueueMode;
	private followUpQueue: AgentMessage[] = [];
	private followUpQueueMode: QueueMode;
	private nextTurnQueue: AgentMessage[] = [];
	private handlers = new Map<string, Set<AgentHarnessHandler>>();

	constructor(options: AgentHarnessOptions<TSkill, TPromptTemplate, TTool>) {
		this.env = options.env;
		this.session = options.session;
		this.resources = options.resources ?? {};
		this.prepareTurnResources = options.prepareTurnResources;
		this.streamOptions = cloneStreamOptions(options.streamOptions);
		this.systemPrompt = options.systemPrompt;
		this.getApiKeyAndHeaders = options.getApiKeyAndHeaders;
		this.validateUniqueNames(
			(options.tools ?? []).map((tool) => tool.name),
			"Duplicate tool name(s)",
		);
		for (const tool of options.tools ?? []) {
			this.tools.set(tool.name, tool);
		}
		this.model = options.model;
		this.thinkingLevel = options.thinkingLevel ?? "off";
		this.activeToolNames = options.activeToolNames
			? [...options.activeToolNames]
			: (options.tools ?? []).map((tool) => tool.name);
		this.validateUniqueNames(this.activeToolNames, "Duplicate active tool name(s)");
		this.validateToolNames(this.activeToolNames);
		this.steeringQueueMode = options.steeringMode ?? "one-at-a-time";
		this.followUpQueueMode = options.followUpMode ?? "one-at-a-time";
	}

	private getHandlers(type: string): Set<AgentHarnessHandler> | undefined {
		return this.handlers.get(type);
	}

	private async emitAny(event: AgentHarnessEvent<TSkill, TPromptTemplate>, signal?: AbortSignal): Promise<void> {
		for (const listener of this.getHandlers(SUBSCRIBER_EVENT_TYPE) ?? []) {
			try {
				await listener(event, signal);
			} catch (error) {
				throw normalizeHookError(error);
			}
		}
	}

	private async emitHook<TType extends keyof AgentHarnessEventResultMap>(
		event: Extract<AgentHarnessOwnEvent, { type: TType }>,
	): Promise<AgentHarnessEventResultMap[TType] | undefined> {
		const handlers = this.getHandlers(event.type as TType);
		if (!handlers || handlers.size === 0) return undefined;
		let lastResult: AgentHarnessEventResultMap[TType] | undefined;
		for (const handler of handlers) {
			try {
				const result = await handler(event);
				if (result !== undefined) {
					lastResult = result;
				}
			} catch (error) {
				throw normalizeHookError(error);
			}
		}
		return lastResult;
	}

	private async emitBeforeProviderRequest(
		model: Model<any>,
		sessionId: string,
		streamOptions: AgentHarnessStreamOptions,
	): Promise<AgentHarnessStreamOptions> {
		const handlers = this.getHandlers("before_provider_request");
		let current = cloneStreamOptions(streamOptions);
		if (handlers && handlers.size > 0) {
			for (const handler of handlers) {
				try {
					const result = await handler({
						type: "before_provider_request",
						model,
						sessionId,
						streamOptions: cloneStreamOptions(current),
					});
					if (result?.streamOptions) {
						current = applyStreamOptionsPatch(current, result.streamOptions);
					}
				} catch (error) {
					throw normalizeHookError(error);
				}
			}
		}
		await this.emitAny({
			type: "before_provider_request",
			model,
			sessionId,
			streamOptions: cloneStreamOptions(current),
		});
		return current;
	}

	private async emitBeforeProviderPayload(model: Model<any>, payload: unknown): Promise<unknown> {
		const handlers = this.getHandlers("before_provider_payload");
		let current = payload;
		if (handlers && handlers.size > 0) {
			for (const handler of handlers) {
				try {
					const result = await handler({ type: "before_provider_payload", model, payload: current });
					if (result !== undefined) {
						current = result.payload;
					}
				} catch (error) {
					throw normalizeHookError(error);
				}
			}
		}
		await this.emitAny({ type: "before_provider_payload", model, payload: current });
		return current;
	}

	private async emitQueueUpdate(): Promise<void> {
		await this.emitAny({
			type: "queue_update",
			steer: [...this.steerQueue],
			followUp: [...this.followUpQueue],
			nextTurn: [...this.nextTurnQueue],
		});
	}

	private async createTurnState(): Promise<AgentHarnessTurnState<TSkill, TPromptTemplate, TTool>> {
		const contextPromise = this.session.buildContext();
		let resources = this.getResources();
		const sessionMetadataPromise = this.session.getMetadata();
		const tools = [...this.tools.values()];
		let activeTools = this.activeToolNames
			.map((name) => this.tools.get(name))
			.filter((tool): tool is TTool => tool !== undefined);
		const [context, sessionMetadata] = await Promise.all([contextPromise, sessionMetadataPromise]);
		if (this.prepareTurnResources) {
			const enabled = new Map(activeTools.map(tool => [tool.name, tool]));
			const prepared = await this.prepareTurnResources({ session: this.session, activeTools: [...activeTools], resources, signal: this.operation.signal });
			this.operation.signal.throwIfAborted();
			this.validateToolNames(prepared.activeToolNames, enabled);
			activeTools = prepared.activeToolNames.map(name => enabled.get(name)!);
			resources = prepared.resources;
		}
		let systemPrompt = "You are a helpful assistant.";
		if (typeof this.systemPrompt === "string") {
			systemPrompt = this.systemPrompt;
		} else if (this.systemPrompt) {
			systemPrompt = await this.systemPrompt({
				env: this.env,
				session: this.session,
				model: this.model,
				thinkingLevel: this.thinkingLevel,
				activeTools,
				resources,
			});
		}
		return {
			messages: context.messages,
			resources,
			streamOptions: cloneStreamOptions(this.streamOptions),
			sessionId: sessionMetadata.id,
			systemPrompt,
			model: this.model,
			thinkingLevel: this.thinkingLevel,
			tools,
			activeTools,
		};
	}

	private createContext(
		turnState: AgentHarnessTurnState<TSkill, TPromptTemplate, TTool>,
		systemPrompt?: string,
	): AgentContext {
		return {
			systemPrompt: systemPrompt ?? turnState.systemPrompt,
			messages: turnState.messages.slice(),
			tools: turnState.activeTools.slice(),
		};
	}

	private createStreamFn(getTurnState: () => AgentHarnessTurnState<TSkill, TPromptTemplate, TTool>): StreamFn {
		return async (model, context, streamOptions) => {
			const turnState = getTurnState();
			const auth = await this.getApiKeyAndHeaders?.(model, streamOptions?.signal);
			const requestModel = auth?.baseUrl ? { ...model, baseUrl: auth.baseUrl } : model;
			const snapshotOptions: AgentHarnessStreamOptions = {
				...turnState.streamOptions,
				headers: mergeHeaders(turnState.streamOptions.headers, auth?.headers),
			};
			const requestOptions = await this.emitBeforeProviderRequest(model, turnState.sessionId, snapshotOptions);
			return streamSimple(requestModel, context, {
				env: auth?.env,
				cacheRetention: requestOptions.cacheRetention,
				headers: requestOptions.headers,
				maxRetries: requestOptions.maxRetries,
				maxRetryDelayMs: requestOptions.maxRetryDelayMs,
				metadata: requestOptions.metadata,
				onPayload: async (payload) => await this.emitBeforeProviderPayload(model, payload),
				onResponse: async (response) => {
					const headers = { ...(response.headers as Record<string, string>) };
					await this.emitAny(
						{ type: "after_provider_response", status: response.status, headers },
						streamOptions?.signal,
					);
				},
				reasoning: streamOptions?.reasoning,
				signal: streamOptions?.signal,
				sessionId: turnState.sessionId,
				timeoutMs: requestOptions.timeoutMs,
				transport: requestOptions.transport,
				apiKey: auth?.apiKey,
			});
		};
	}

	private async drainQueuedMessages(queue: AgentMessage[], mode: QueueMode): Promise<AgentMessage[]> {
		const messages = mode === "all" ? queue.splice(0) : queue.splice(0, 1);
		if (messages.length === 0) {
			// The final continuation poll must close admission before yielding.
			if (queue === this.followUpQueue) this.acceptingQueuedInput = false;
			return messages;
		}
		try {
			await this.emitQueueUpdate();
			return messages;
		} catch (error) {
			queue.unshift(...messages);
			throw normalizeHookError(error);
		}
	}

	private async clearTurnQueues(): Promise<void> {
		this.acceptingQueuedInput = false;
		const changed = this.steerQueue.length + this.followUpQueue.length > 0;
		this.steerQueue.length = 0;
		this.followUpQueue.length = 0;
		if (changed) await this.emitQueueUpdate();
	}

	private assertQueueAdmission(): void {
		if (this.operation.phase !== "turn" || !this.acceptingQueuedInput || this.operation.signal.aborted)
			throw new AgentHarnessError("invalid_state", "AgentHarness is not accepting queued input");
	}

	private createLoopConfig(
		getTurnState: () => AgentHarnessTurnState<TSkill, TPromptTemplate, TTool>,
		setTurnState: (turnState: AgentHarnessTurnState<TSkill, TPromptTemplate, TTool>) => void,
	): AgentLoopConfig {
		const turnState = getTurnState();
		return {
			model: turnState.model,
			reasoning: turnState.thinkingLevel === "off" ? undefined : turnState.thinkingLevel,
			convertToLlm,
			transformContext: async (messages) => {
				const result = await this.emitHook({ type: "context", messages: [...messages] });
				return result?.messages ?? messages;
			},
			beforeToolCall: async ({ toolCall, args }) => {
				const result = await this.emitHook({
					type: "tool_call",
					toolCallId: toolCall.id,
					toolName: toolCall.name,
					input: args as Record<string, unknown>,
				});
				return result ? { block: result.block, reason: result.reason, terminate: result.terminate } : undefined;
			},
			afterToolCall: async ({ toolCall, args, result, isError }) => {
				const patch = await this.emitHook({
					type: "tool_result",
					toolCallId: toolCall.id,
					toolName: toolCall.name,
					input: args as Record<string, unknown>,
					content: result.content,
					details: result.details,
					isError,
				});
				return patch
					? { content: patch.content, details: patch.details, isError: patch.isError, terminate: patch.terminate }
					: undefined;
			},
			prepareNextTurn: async () => {
				await this.flushPendingSessionWrites();
				const nextTurnState = await this.createTurnState();
				setTurnState(nextTurnState);
				return {
					context: this.createContext(nextTurnState),
					model: nextTurnState.model,
					thinkingLevel: nextTurnState.thinkingLevel,
				};
			},
			getSteeringMessages: async () => this.drainQueuedMessages(this.steerQueue, this.steeringQueueMode),
			// Steering may arrive after the last steering poll but before this poll.
			getFollowUpMessages: async () => this.steerQueue.length > 0
				? this.drainQueuedMessages(this.steerQueue, this.steeringQueueMode)
				: this.drainQueuedMessages(this.followUpQueue, this.followUpQueueMode),
		};
	}

	private validateUniqueNames(names: string[], message: string): void {
		const duplicates = findDuplicateNames(names);
		if (duplicates.length > 0)
			throw new AgentHarnessError("invalid_argument", `${message}: ${duplicates.join(", ")}`);
	}

	private validateToolNames(toolNames: string[], tools: Map<string, TTool> = this.tools): void {
		this.validateUniqueNames(toolNames, "Duplicate active tool name(s)");
		const missing = toolNames.filter((name) => !tools.has(name));
		if (missing.length > 0) throw new AgentHarnessError("invalid_argument", `Unknown tool(s): ${missing.join(", ")}`);
	}

	private async flushPendingSessionWrites(): Promise<void> {
		while (this.pendingSessionWrites.length > 0) {
			const write = this.pendingSessionWrites[0]!;
			if (write.type === "message") {
				await this.session.appendMessage(write.message);
			} else if (write.type === "model_change") {
				await this.session.appendModelChange(write.provider, write.modelId);
			} else if (write.type === "thinking_level_change") {
				await this.session.appendThinkingLevelChange(write.thinkingLevel);
			} else if (write.type === "active_tools_change") {
				await this.session.appendActiveToolsChange(write.activeToolNames);
			} else if (write.type === "custom") {
				await this.session.appendCustomEntry(write.customType, write.data);
			} else if (write.type === "custom_message") {
				await this.session.appendCustomMessageEntry(write.customType, write.content, write.display, write.details);
			} else if (write.type === "label") {
				await this.session.appendLabel(write.targetId, write.label);
			} else if (write.type === "session_info") {
				await this.session.appendSessionName(write.name ?? "");
			} else if (write.type === "leaf") {
				await this.session.getStorage().setLeafId(write.targetId);
			}
			this.pendingSessionWrites.shift();
		}
	}

	private async handleAgentEvent(event: AgentEvent, signal?: AbortSignal): Promise<void> {
		if (event.type === "message_end") {
			if (event.message.role === "assistant" &&
				(event.message.stopReason === "error" || event.message.stopReason === "aborted"))
				await this.clearTurnQueues();
			await this.session.appendMessage(event.message);
			await this.emitAny(event, signal);
			return;
		}
		if (event.type === "turn_end") {
			let eventError: unknown;
			try {
				await this.emitAny(event, signal);
			} catch (error) {
				eventError = error;
			}
			const hadPendingMutations = this.pendingSessionWrites.length > 0;
			await this.flushPendingSessionWrites();
			if (eventError) throw eventError;
			await this.emitAny({ type: "save_point", hadPendingMutations });
			return;
		}
		if (event.type === "agent_end") {
			await this.clearTurnQueues();
			await this.flushPendingSessionWrites();
			await this.emitAny(event, signal);
			await this.emitAny({ type: "settled", nextTurnCount: this.nextTurnQueue.length }, signal);
			return;
		}
		await this.emitAny(event, signal);
	}

	private async emitRunFailure(
		model: Model<any>,
		error: unknown,
		aborted: boolean,
		signal: AbortSignal,
	): Promise<AgentMessage[]> {
		await this.clearTurnQueues();
		const failureMessage = createFailureMessage(model, error, aborted);
		await this.handleAgentEvent({ type: "message_start", message: failureMessage }, signal);
		await this.handleAgentEvent({ type: "message_end", message: failureMessage }, signal);
		await this.handleAgentEvent({ type: "turn_end", message: failureMessage, toolResults: [] }, signal);
		await this.handleAgentEvent({ type: "agent_end", messages: [failureMessage] }, signal);
		return [failureMessage];
	}

	private async executeTurn(
		turnState: AgentHarnessTurnState<TSkill, TPromptTemplate, TTool>,
		text: string,
		options?: { images?: ImageContent[]; displayText?: string },
	): Promise<AssistantMessage> {
		let activeTurnState = turnState;
		let messages: AgentMessage[] = [createUserMessage(text, options?.images, options?.displayText ?? text)];
		if (this.nextTurnQueue.length > 0) {
			const queuedMessages = this.nextTurnQueue.splice(0);
			try {
				await this.emitQueueUpdate();
			} catch (error) {
				this.nextTurnQueue.unshift(...queuedMessages);
				throw normalizeHookError(error);
			}
			messages = [...queuedMessages, messages[0]!];
		}
		const beforeResult = await this.emitHook({
			type: "before_agent_start",
			prompt: text,
			images: options?.images,
			systemPrompt: turnState.systemPrompt,
			resources: turnState.resources,
		});
		if (beforeResult?.messages) messages = [...messages, ...beforeResult.messages];

		const signal = this.operation.signal;
		signal.throwIfAborted();
		const getTurnState = () => activeTurnState;
		const setTurnState = (nextTurnState: AgentHarnessTurnState<TSkill, TPromptTemplate, TTool>) => {
			activeTurnState = nextTurnState;
		};
		const runResultPromise = (async () => {
			try {
				return await runAgentLoop(
					messages,
					this.createContext(turnState, beforeResult?.systemPrompt),
					this.createLoopConfig(getTurnState, setTurnState),
					(event) => this.handleAgentEvent(event, signal),
					signal,
					this.createStreamFn(getTurnState),
				);
			} catch (error) {
				try {
					return await this.emitRunFailure(
						activeTurnState.model,
						error,
						signal.aborted,
						signal,
					);
				} catch (failureError) {
					const cause = new AggregateError(
						[toError(error), toError(failureError)],
						"Agent run failed and failure reporting failed",
					);
					throw new AgentHarnessError("unknown", cause.message, cause);
				}
			}
		})();
		try {
			const newMessages = await runResultPromise;
			for (let i = newMessages.length - 1; i >= 0; i--) {
				const message = newMessages[i]!;
				if (message.role === "assistant") {
					return message;
				}
			}
			throw new AgentHarnessError("invalid_state", "AgentHarness prompt completed without an assistant message");
		} finally {
			await this.flushPendingSessionWrites();
		}
	}

	async prompt(text: string, options?: { images?: ImageContent[]; displayText?: string }): Promise<AssistantMessage> {
		if (this.operation.phase !== "idle") throw new AgentHarnessError("busy", "AgentHarness is busy");
		const finishRunPromise = this.operation.start("turn");
		this.acceptingQueuedInput = true;
		try {
			const turnState = await this.createTurnState();
			return await this.executeTurn(turnState, text, options);
		} catch (error) {
			throw normalizeHarnessError(error, "unknown");
		} finally {
			try { await this.clearTurnQueues(); } finally { finishRunPromise(); }
		}
	}

	async skill(
		name: string,
		additionalInstructions?: string,
		options?: { displayText?: string },
	): Promise<AssistantMessage> {
		if (this.operation.phase !== "idle") throw new AgentHarnessError("busy", "AgentHarness is busy");
		const finishRunPromise = this.operation.start("turn");
		this.acceptingQueuedInput = true;
		try {
			const turnState = await this.createTurnState();
			const skill = (turnState.resources.skills ?? []).find((candidate) => candidate.name === name);
			if (!skill) throw new AgentHarnessError("invalid_argument", `Unknown skill: ${name}`);
			return await this.executeTurn(turnState, formatSkillInvocation(skill, additionalInstructions), {
				displayText: options?.displayText ?? createSkillDisplayText(name),
			});
		} catch (error) {
			throw normalizeHarnessError(error, "unknown");
		} finally {
			try { await this.clearTurnQueues(); } finally { finishRunPromise(); }
		}
	}

	async promptFromTemplate(name: string, args: string[] = []): Promise<AssistantMessage> {
		if (this.operation.phase !== "idle") throw new AgentHarnessError("busy", "AgentHarness is busy");
		const finishRunPromise = this.operation.start("turn");
		this.acceptingQueuedInput = true;
		try {
			const turnState = await this.createTurnState();
			const template = (turnState.resources.promptTemplates ?? []).find((candidate) => candidate.name === name);
			if (!template) throw new AgentHarnessError("invalid_argument", `Unknown prompt template: ${name}`);
			return await this.executeTurn(turnState, formatPromptTemplateInvocation(template, args));
		} catch (error) {
			throw normalizeHarnessError(error, "unknown");
		} finally {
			try { await this.clearTurnQueues(); } finally { finishRunPromise(); }
		}
	}

	async steer(text: string, options?: { images?: ImageContent[]; displayText?: string }): Promise<void> {
		this.assertQueueAdmission();
		this.steerQueue.push(createUserMessage(text, options?.images, options?.displayText ?? text));
		await this.emitQueueUpdate();
	}

	async followUp(text: string, options?: { images?: ImageContent[]; displayText?: string }): Promise<void> {
		this.assertQueueAdmission();
		this.followUpQueue.push(createUserMessage(text, options?.images, options?.displayText ?? text));
		await this.emitQueueUpdate();
	}

	async nextTurn(text: string, options?: { images?: ImageContent[] }): Promise<void> {
		this.nextTurnQueue.push(createUserMessage(text, options?.images));
		await this.emitQueueUpdate();
	}

	async appendMessage(message: AgentMessage): Promise<void> {
		try {
			if (this.operation.phase === "idle") {
				await this.session.appendMessage(message);
			} else {
				this.pendingSessionWrites.push({ type: "message", message });
			}
		} catch (error) {
			throw normalizeHarnessError(error, "session");
		}
	}

	async compact(
		customInstructions?: string,
	): Promise<{ summary: string; firstKeptEntryId: string; tokensBefore: number; details?: unknown }> {
		if (this.operation.phase !== "idle") throw new AgentHarnessError("busy", "compact() requires idle harness");
		const finish = this.operation.start("compaction");
		const signal = this.operation.signal;
		try {
			return await compactSession({
				session: this.session, model: this.model, thinkingLevel: this.thinkingLevel,
				signal, getApiKeyAndHeaders: this.getApiKeyAndHeaders,
			}, (event) => this.emitHook(event), (event) => this.emitAny(event), customInstructions);
		} catch (error) {
			throw normalizeHarnessError(error, "compaction");
		} finally {
			try { await this.flushPendingSessionWrites(); } finally { finish(); }
		}
	}

	async navigateTree(
		targetId: string,
		options?: { summarize?: boolean; customInstructions?: string; replaceInstructions?: boolean; label?: string },
	): Promise<NavigateTreeResult> {
		if (this.operation.phase !== "idle") throw new AgentHarnessError("busy", "navigateTree() requires idle harness");
		const finish = this.operation.start("branch_summary");
		const signal = this.operation.signal;
		try {
			return await navigateSession({
				session: this.session, model: this.model, thinkingLevel: this.thinkingLevel,
				signal, getApiKeyAndHeaders: this.getApiKeyAndHeaders,
			}, (event) => this.emitHook(event), (event) => this.emitAny(event), targetId, options);
		} catch (error) {
			throw normalizeHarnessError(error, "branch_summary");
		} finally {
			try { await this.flushPendingSessionWrites(); } finally { finish(); }
		}
	}

	getModel(): Model<any> {
		return this.model;
	}

	async setModel(model: Model<any>): Promise<void> {
		try {
			const previousModel = this.model;
			if (this.operation.phase === "idle") {
				await this.session.appendModelChange(model.provider, model.id);
			} else {
				this.pendingSessionWrites.push({ type: "model_change", provider: model.provider, modelId: model.id });
			}
			this.model = model;
			await this.emitAny({ type: "model_update", model, previousModel, source: "set" });
		} catch (error) {
			throw normalizeHarnessError(error, "session");
		}
	}

	getThinkingLevel(): ThinkingLevel {
		return this.thinkingLevel;
	}

	async setThinkingLevel(level: ThinkingLevel): Promise<void> {
		try {
			const previousLevel = this.thinkingLevel;
			if (this.operation.phase === "idle") {
				await this.session.appendThinkingLevelChange(level);
			} else {
				this.pendingSessionWrites.push({ type: "thinking_level_change", thinkingLevel: level });
			}
			this.thinkingLevel = level;
			await this.emitAny({ type: "thinking_level_update", level, previousLevel });
		} catch (error) {
			throw normalizeHarnessError(error, "session");
		}
	}

	getTools(): TTool[] {
		return [...this.tools.values()];
	}

	async setTools(tools: TTool[], activeToolNames?: string[]): Promise<void> {
		try {
			this.validateUniqueNames(
				tools.map((tool) => tool.name),
				"Duplicate tool name(s)",
			);
			const nextTools = new Map(tools.map((tool) => [tool.name, tool]));
			const nextActiveToolNames = activeToolNames ? [...activeToolNames] : this.activeToolNames;
			this.validateToolNames(nextActiveToolNames, nextTools);
			const previousToolNames = [...this.tools.keys()];
			const previousActiveToolNames = [...this.activeToolNames];
			if (this.operation.phase === "idle") {
				await this.session.appendActiveToolsChange(nextActiveToolNames);
			} else {
				this.pendingSessionWrites.push({ type: "active_tools_change", activeToolNames: [...nextActiveToolNames] });
			}
			this.tools = nextTools;
			this.activeToolNames = [...nextActiveToolNames];
			await this.emitAny({
				type: "tools_update",
				toolNames: [...this.tools.keys()],
				previousToolNames,
				activeToolNames: [...this.activeToolNames],
				previousActiveToolNames,
				source: "set",
			});
		} catch (error) {
			throw normalizeHarnessError(error, "invalid_argument");
		}
	}

	getActiveTools(): TTool[] {
		return this.activeToolNames.map((name) => this.tools.get(name)!);
	}

	async setActiveTools(toolNames: string[]): Promise<void> {
		try {
			this.validateToolNames(toolNames);
			const previousToolNames = [...this.tools.keys()];
			const previousActiveToolNames = [...this.activeToolNames];
			if (this.operation.phase === "idle") {
				await this.session.appendActiveToolsChange(toolNames);
			} else {
				this.pendingSessionWrites.push({ type: "active_tools_change", activeToolNames: [...toolNames] });
			}
			this.activeToolNames = [...toolNames];
			await this.emitAny({
				type: "tools_update",
				toolNames: [...this.tools.keys()],
				previousToolNames,
				activeToolNames: [...this.activeToolNames],
				previousActiveToolNames,
				source: "set",
			});
		} catch (error) {
			throw normalizeHarnessError(error, "invalid_argument");
		}
	}

	getSteeringMode(): QueueMode {
		return this.steeringQueueMode;
	}

	async setSteeringMode(mode: QueueMode): Promise<void> {
		this.steeringQueueMode = mode;
	}

	getFollowUpMode(): QueueMode {
		return this.followUpQueueMode;
	}

	async setFollowUpMode(mode: QueueMode): Promise<void> {
		this.followUpQueueMode = mode;
	}

	getResources(): AgentHarnessResources<TSkill, TPromptTemplate> {
		return {
			skills: this.resources.skills?.slice(),
			promptTemplates: this.resources.promptTemplates?.slice(),
		};
	}

	get isIdle(): boolean { return this.operation.phase === "idle"; }

	async setResources(resources: AgentHarnessResources<TSkill, TPromptTemplate>): Promise<void> {
		const previousResources = this.getResources();
		this.resources = {
			skills: resources.skills?.slice(),
			promptTemplates: resources.promptTemplates?.slice(),
		};
		await this.emitAny({ type: "resources_update", resources: this.getResources(), previousResources });
	}

	getStreamOptions(): AgentHarnessStreamOptions {
		return cloneStreamOptions(this.streamOptions);
	}

	async setStreamOptions(streamOptions: AgentHarnessStreamOptions): Promise<void> {
		this.streamOptions = cloneStreamOptions(streamOptions);
	}

	async abort(): Promise<AbortResult> {
		const clearedSteer = [...this.steerQueue];
		const clearedFollowUp = [...this.followUpQueue];
		this.steerQueue = [];
		this.followUpQueue = [];
		this.nextTurnQueue = [];
		this.operation.abort();
		const errors: Error[] = [];
		try {
			await this.emitQueueUpdate();
		} catch (error) {
			errors.push(toError(error));
		}
		try {
			await this.waitForIdle();
		} catch (error) {
			errors.push(toError(error));
		}
		try {
			await this.emitAny({ type: "abort", clearedSteer, clearedFollowUp });
		} catch (error) {
			errors.push(toError(error));
		}
		if (errors.length > 0) {
			const cause = errors.length === 1 ? errors[0]! : new AggregateError(errors, "Abort completed with errors");
			throw normalizeHarnessError(cause, "hook");
		}
		return { clearedSteer, clearedFollowUp };
	}

	async waitForIdle(): Promise<void> {
		await this.operation.waitForIdle();
	}

	subscribe(
		listener: (event: AgentHarnessEvent<TSkill, TPromptTemplate>, signal?: AbortSignal) => Promise<void> | void,
	): () => void {
		let handlers = this.handlers.get(SUBSCRIBER_EVENT_TYPE);
		if (!handlers) {
			handlers = new Set();
			this.handlers.set(SUBSCRIBER_EVENT_TYPE, handlers);
		}
		handlers.add(listener as AgentHarnessHandler);
		return () => handlers!.delete(listener as AgentHarnessHandler);
	}

	on<TType extends keyof AgentHarnessEventResultMap>(
		type: TType,
		handler: (
			event: Extract<AgentHarnessOwnEvent, { type: TType }>,
		) => Promise<AgentHarnessEventResultMap[TType]> | AgentHarnessEventResultMap[TType],
	): () => void {
		let handlers = this.handlers.get(type);
		if (!handlers) {
			handlers = new Set();
			this.handlers.set(type, handlers);
		}
		handlers.add(handler as AgentHarnessHandler);
		return () => handlers!.delete(handler as AgentHarnessHandler);
	}
}
