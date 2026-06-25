import type { KnownProvider } from "./llm-types.ts";
import { readWhyjEnvValue } from "../../../storage/index.ts";

export function getEnvApiKey(provider: KnownProvider): string | undefined;
export function getEnvApiKey(provider: string): string | undefined;
export function getEnvApiKey(provider: string): string | undefined {
	void provider;
	return readWhyjEnvValue(process.env, "apiKey") || readWhyjEnvValue(process.env, "authToken");
}
