// Pure editor operations. UI and future Host adapters share the same token contract.
export function detect(text, caret, refs = []) {
  if (refs.some((r) => caret > r.start && caret <= r.end)) return null;
  const before = text.slice(0, caret);
  const match =
    /(^|[\s(（，,。:：\p{Script=Han}])([/@])("[^"\n]*|[^\s"@]*)$/u.exec(before);
  if (!match) return null;
  const [, boundary, trigger, raw] = match;
  if (trigger === "/" && (!/^[\s(（]*$/.test(boundary) || /[/:]/.test(raw)))
    return null;
  if (trigger === "@" && /\p{Script=Han}/u.test(boundary) && /\S\.\S/.test(raw))
    return null;
  return {
    trigger,
    query: raw.replace(/^"/, ""),
    quoted: raw.startsWith('"'),
    start: caret - raw.length - 1,
    end: caret,
  };
}

export function score(value, query) {
  value = value.toLowerCase();
  query = query.toLowerCase();
  if (!query) return 0;
  if (value.startsWith(query)) return value.length - query.length;
  const pos = value.indexOf(query);
  if (pos >= 0) return 100 + pos;
  let offset = 0,
    total = 250;
  for (const char of query) {
    const i = value.indexOf(char, offset);
    if (i < 0) return Infinity;
    total += i - offset;
    offset = i + 1;
  }
  return total;
}

export function replaceToken(text, active, token, keepOpen = false) {
  // Only consume a matching completion tail. Text after a bare trigger stays intact.
  const q = active.query.toLowerCase();
  const candidate = token.replace(/^[/@]"?/, "").replace(/"$/, "");
  let end = active.end;
  if (q && candidate.toLowerCase().startsWith(q)) {
    const expected = candidate.slice(q.length);
    const tail = text.slice(end).match(/^[^\s"@]*/)?.[0] || "";
    const n = Math.min(tail.length, expected.length);
    if (n && expected.toLowerCase().startsWith(tail.slice(0, n).toLowerCase()))
      end += n;
    if (text[end] === '"' && active.quoted) end++;
  }
  const insert = token + (keepOpen ? "" : " ");
  return {
    text: text.slice(0, active.start) + insert + text.slice(end),
    caret: active.start + insert.length,
    start: active.start,
    end,
    insert,
  };
}

export function remapRefs(previous, next, refs) {
  let start = 0;
  while (
    start < previous.length &&
    start < next.length &&
    previous[start] === next[start]
  )
    start++;
  let oldEnd = previous.length,
    newEnd = next.length;
  while (
    oldEnd > start &&
    newEnd > start &&
    previous[oldEnd - 1] === next[newEnd - 1]
  ) {
    oldEnd--;
    newEnd--;
  }
  const delta = newEnd - oldEnd;
  return refs
    .flatMap((r) => {
      if (r.end <= start) return [{ ...r }];
      if (r.start >= oldEnd)
        return [{ ...r, start: r.start + delta, end: r.end + delta }];
      return []; // Editing within a reference removes its authority.
    })
    .filter((r) => next.slice(r.start, r.end) === r.token);
}

export function serialize(text, refs) {
  let result = text;
  for (const r of [...refs].sort((a, b) => b.start - a.start)) {
    if (text.slice(r.start, r.end) !== r.token)
      throw new Error("引用已变化，请重新选择");
    result = result.slice(0, r.start) + r.canonical + result.slice(r.end);
  }
  return result;
}
