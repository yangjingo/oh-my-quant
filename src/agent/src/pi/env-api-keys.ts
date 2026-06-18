import type { KnownProvider } from "./llm-types.ts";

function getApiKeyEnvVars(provider: string): readonly string[] | undefined {
	const envMap: Record<string, string> = {
		deepseek: "DEEPSEEK_API_KEY",
		openrouter: "OPENROUTER_API_KEY",
	};
	const envVar = envMap[provider];
	return envVar ? [envVar] : undefined;
}

export function getEnvApiKey(provider: KnownProvider): string | undefined;
export function getEnvApiKey(provider: string): string | undefined;
export function getEnvApiKey(provider: string): string | undefined {
	const envVars = getApiKeyEnvVars(provider);
	if (envVars?.[0]) {
		return process.env[envVars[0]];
	}
	return undefined;
}
