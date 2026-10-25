/** Explicit @ references only: email addresses and escaped @ are ordinary text. */
export function activeReferenceQuery(input: string): { start: number; query: string } | null {
  if (input.startsWith("/")) return null;
  const match = /(?:^|\s)@(?:"([^"\r\n]*)|([^\s"]*))$/.exec(input);
  return match ? { start: match.index + (match[0].startsWith("@") ? 0 : 1), query: match[1] ?? match[2] ?? "" } : null;
}

export function referenceTokens(input: string): string[] {
  if (input.startsWith("/")) return [];
  const tokens = [...input.matchAll(/(?:^|\s)@(?:"([^"\r\n]+)"|([^\s"]+))/g)].map(match => match[1] ?? match[2]!);
  if (/(?:^|\s)@"[^"\r\n]*$/.test(input)) throw new Error("引用路径的引号未闭合。");
  return [...new Set(tokens)];
}

export function referenceText(value: string): string {
  return /\s/.test(value) ? `@"${value}"` : `@${value}`;
}
