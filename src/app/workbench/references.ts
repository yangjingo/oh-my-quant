/** Only recognized explicit reference tokens; emails and escaped/code-literal @ remain ordinary text. */
export function hasExplicitReference(text: string): boolean {
  let code = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\\") { i++; continue; }
    if (text[i] === "`") {
      let count = 1; while (text[i + count] === "`") count++;
      if (!code) code = count; else if (code === count) code = 0;
      i += count - 1; continue;
    }
    if (!code && text[i] === "@" && (i === 0 || /[\s([{]/u.test(text[i - 1]!))
      && /^@(file|dir|directory|session|evidence):\S+/u.test(text.slice(i))) return true;
  }
  return false;
}
