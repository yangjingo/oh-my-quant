import type { Model } from "./llm-types.ts";

export const MODELS = {
	"deepseek": {
		"deepseek-v4-flash": {
			id: "deepseek-v4-flash",
			name: "DeepSeek V4 Flash",
			api: "openai-completions",
			provider: "deepseek",
			baseUrl: "https://api.deepseek.com",
			compat: {"requiresReasoningContentOnAssistantMessages":true,"thinkingFormat":"deepseek"},
			reasoning: true,
			thinkingLevelMap: {"minimal":null,"low":null,"medium":null,"high":"high","xhigh":"max"},
			input: ["text"],
			cost: {
				input: 0.14,
				output: 0.28,
				cacheRead: 0.0028,
				cacheWrite: 0,
			},
			contextWindow: 1000000,
			maxTokens: 384000,
		} satisfies Model<"openai-completions">,
		"deepseek-v4-pro": {
			id: "deepseek-v4-pro",
			name: "DeepSeek V4 Pro",
			api: "openai-completions",
			provider: "deepseek",
			baseUrl: "https://api.deepseek.com",
			compat: {"requiresReasoningContentOnAssistantMessages":true,"thinkingFormat":"deepseek"},
			reasoning: true,
			thinkingLevelMap: {"minimal":null,"low":null,"medium":null,"high":"high","xhigh":"max"},
			input: ["text"],
			cost: {
				input: 0.435,
				output: 0.87,
				cacheRead: 0.003625,
				cacheWrite: 0,
			},
			contextWindow: 1000000,
			maxTokens: 384000,
		} satisfies Model<"openai-completions">,
	},
	"openrouter": {
		"openai/gpt-5.5": {
			id: "openai/gpt-5.5",
			name: "OpenAI: GPT-5.5",
			api: "openai-completions",
			provider: "openrouter",
			baseUrl: "https://openrouter.ai/api/v1",
			reasoning: true,
			thinkingLevelMap: {"xhigh":"xhigh"},
			input: ["text", "image"],
			cost: {
				input: 5,
				output: 30,
				cacheRead: 0.5,
				cacheWrite: 0,
			},
			contextWindow: 1050000,
			maxTokens: 128000,
		} satisfies Model<"openai-completions">,
	},
} as const;
