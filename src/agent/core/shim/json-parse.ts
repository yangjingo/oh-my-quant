/**
 * Attempts to parse potentially incomplete JSON during streaming.
 * Always returns a valid object, even if the JSON is incomplete.
 *
 * @param partialJson The partial JSON string from streaming
 * @returns Parsed object or empty object if parsing fails
 */
export function parseStreamingJson<T = Record<string, unknown>>(partialJson: string | undefined): T {
	if (!partialJson || partialJson.trim() === "") {
		return {} as T;
	}

	try {
		return JSON.parse(partialJson) as T;
	} catch {
		// If the JSON is incomplete (streaming), try to find a valid prefix
		try {
			// Try wrapping unquoted keys for common streaming formats
			const cleaned = partialJson
				// Remove trailing comma before closing brace/bracket
				.replace(/,\s*$/, "")
				// Remove trailing comma before closing in nested structures
				.replace(/,\s*([}\]])/g, "$1");
			return JSON.parse(cleaned) as T;
		} catch {
			return {} as T;
		}
	}
}
