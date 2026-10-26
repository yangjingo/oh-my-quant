export type SkillFetch = (url: string, init: RequestInit) => Promise<Response>;

const API = "https://api.github.com";
const MAX_ARCHIVE_BYTES = 32 * 1024 * 1024;
export const isRevision = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{40}$/.test(value);

async function bytes(response: Response, limit: number, signal: AbortSignal): Promise<Buffer> {
  if (!response.body) throw new Error("GitHub returned an empty response.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      size += value.length;
      if (size > limit) throw new Error("GitHub download exceeded its size limit.");
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  } finally { signal.removeEventListener("abort", cancel); await reader.cancel().catch(() => {}); }
}

/** Credentials go only to GitHub's API, never to the archive redirect or receipts. */
export function skillGithub(request: SkillFetch, signal?: AbortSignal) {
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  const headers: Record<string, string> = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
  if (token) headers.Authorization = `Bearer ${token}`;
  async function get(path: string, archive = false): Promise<Buffer> {
    const timeoutMs = archive ? 180_000 : 60_000;
    const timeout = AbortSignal.timeout(timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    combined.throwIfAborted();
    try {
      let response = await request(`${API}${path}`, { headers, signal: combined, redirect: "manual" });
      if (archive && response.status === 302) {
        const location = new URL(response.headers.get("location") || "", API);
        await response.body?.cancel();
        if (location.protocol !== "https:" || location.hostname !== "codeload.github.com" || location.port || location.username || location.password) throw new Error("Unexpected GitHub archive redirect.");
        response = await request(location.href, { signal: combined, redirect: "error" });
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`GitHub request failed (HTTP ${response.status}). Check access/rate limits; private repositories require GH_TOKEN or GITHUB_TOKEN with Contents read access.`);
      }
      return await bytes(response, archive ? MAX_ARCHIVE_BYTES : 4 * 1024 * 1024, combined);
    } catch (error) {
      if (signal?.aborted) throw new Error("Skill installation cancelled.");
      if (timeout.aborted) throw new Error(`GitHub download timed out after ${timeoutMs} ms.`);
      // Fetch errors may contain signed redirect URLs. Return only our own diagnostics.
      if (error instanceof Error && /^(GitHub (request failed \(HTTP|download exceeded|returned)|Unexpected GitHub archive redirect)/.test(error.message)) throw error;
      throw new Error("GitHub download failed. Check network access and retry.");
    }
  }
  async function metadata(path: string): Promise<Record<string, unknown>> {
    const data = await get(path);
    try { return JSON.parse(data.toString()) as Record<string, unknown>; }
    catch { throw new Error("GitHub returned invalid repository metadata."); }
  }
  return {
    async revision(repo: string): Promise<string> {
      const result = await metadata(`/repos/${repo}/commits/HEAD`);
      if (!isRevision(result?.sha)) throw new Error("GitHub returned an invalid commit revision.");
      return result.sha;
    },
    async forward(repo: string, from: string, to: string): Promise<void> {
      const result = await metadata(`/repos/${repo}/compare/${from}...${to}?per_page=1`);
      if (result?.status !== "ahead") throw new Error("Requested revision is not a fast-forward; existing installation preserved.");
    },
    archive: (repo: string, revision: string) => get(`/repos/${repo}/tarball/${revision}`, true),
  };
}
