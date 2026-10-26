import { gzipSync } from "node:zlib";
import { Header, type HeaderData } from "tar";

export const FIRST = "a".repeat(40);
export const NEXT = "b".repeat(40);
export function archiveEntries(entries: (HeaderData & { content?: string | Buffer })[]): Buffer {
  const chunks: Buffer[] = [];
  for (const entry of entries) {
    const content = Buffer.from(entry.content ?? "");
    const header = new Header({ mode: 0o644, type: "File", ...entry, size: content.length });
    header.encode();
    chunks.push(header.block!, content, Buffer.alloc((512 - content.length % 512) % 512));
  }
  return gzipSync(Buffer.concat([...chunks, Buffer.alloc(1024)]));
}
export const skillArchive = (files: Record<string, string> = { "SKILL.md": "original\n", "中文.txt": "资源" }) =>
  archiveEntries(Object.entries(files).map(([path, content]) => ({ path: `repository-${FIRST}/${path}`, content })));
