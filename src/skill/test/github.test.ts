import { expect, it, spyOn } from "bun:test";
import { skillGithub } from "../github.ts";
import { FIRST } from "./fixtures/archive.ts";

it("sends credentials only to the API, never the trusted archive redirect", async () => {
  const original = process.env.GH_TOKEN;
  process.env.GH_TOKEN = "private-test-token";
  try {
    let calls = 0;
    const github = skillGithub(async (url, init) => {
      calls++;
      if (calls === 1) {
        expect(url).toBe(`https://api.github.com/repos/owner/repo/tarball/${FIRST}`);
        expect(new Headers(init.headers).get("Authorization")).toBe("Bearer private-test-token");
        expect(init.redirect).toBe("manual");
        return new Response(null, { status: 302, headers: { location: `https://codeload.github.com/owner/repo/tar.gz/${FIRST}?token=archive-token` } });
      }
      expect(new Headers(init.headers).has("Authorization")).toBe(false);
      expect(init.redirect).toBe("error");
      return new Response("archive");
    });
    expect((await github.archive("owner/repo", FIRST)).toString()).toBe("archive");
    expect(calls).toBe(2);
  } finally { if (original === undefined) delete process.env.GH_TOKEN; else process.env.GH_TOKEN = original; }
});

for (const location of ["https://evil.example/archive", "http://codeload.github.com/archive", "https://user@codeload.github.com/archive", "https://codeload.github.com:8443/archive"]) {
  it(`rejects an unexpected redirect: ${location}`, async () => {
    let calls = 0;
    const github = skillGithub(async () => { calls++; return new Response(null, { status: 302, headers: { location } }); });
    await expect(github.archive("owner/repo", FIRST)).rejects.toThrow("Unexpected GitHub archive redirect");
    expect(calls).toBe(1);
  });
}

it("cancels a stalled response body promptly", async () => {
  const controller = new AbortController();
  let cancelled = false;
  const github = skillGithub(async () => new Response(new ReadableStream({
    start() { setTimeout(() => controller.abort(), 10); },
    cancel() { cancelled = true; },
  })), controller.signal);
  await expect(github.archive("owner/repo", FIRST)).rejects.toThrow("cancelled");
  expect(cancelled).toBe(true);
});

it("bounds metadata and archive timeouts with actionable errors", async () => {
  const durations: number[] = [];
  const spy = spyOn(AbortSignal, "timeout").mockImplementation(ms => {
    durations.push(ms);
    const controller = new AbortController();
    setTimeout(() => controller.abort(new DOMException("Timed out", "TimeoutError")), 10);
    return controller.signal;
  });
  try {
    const github = skillGithub(async () => new Response(new ReadableStream()));
    await expect(github.revision("owner/repo")).rejects.toThrow("timed out after 60000 ms");
    await expect(github.archive("owner/repo", FIRST)).rejects.toThrow("timed out after 180000 ms");
    expect(durations).toEqual([60000, 180000]);
  } finally { spy.mockRestore(); }
});

it("reports partial archive progress on timeout without exposing the redirect URL", async () => {
  const timeout = spyOn(AbortSignal, "timeout").mockImplementation(() => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new DOMException("Timed out", "TimeoutError")), 30);
    return controller.signal;
  });
  let cancelled = false, calls = 0;
  try {
    const github = skillGithub(async () => {
      if (++calls === 1) return new Response(null, { status: 302, headers: { location: "https://codeload.github.com/owner/repo/tar.gz/revision?token=private-fixture" } });
      return new Response(new ReadableStream({
        start(controller) { controller.enqueue(new Uint8Array([1, 2, 3, 4, 5])); },
        cancel() { cancelled = true; },
      }));
    });
    let message = "";
    try { await github.archive("owner/repo", FIRST); } catch (error) { message = (error as Error).message; }
    expect(message).toContain("timed out after 180000 ms");
    expect(message).toContain("receiving archive");
    expect(message).toContain("received 5 bytes");
    expect(message).not.toContain("private-fixture");
    expect(message).not.toContain("codeload.github.com");
    expect(cancelled).toBe(true);
  } finally { timeout.mockRestore(); }
});

it("identifies a timeout before archive response headers", async () => {
  const timeout = spyOn(AbortSignal, "timeout").mockImplementation(() => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new DOMException("Timed out", "TimeoutError")), 10);
    return controller.signal;
  });
  try {
    const github = skillGithub((_url, init) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(new Error("network detail")), { once: true });
    }));
    await expect(github.archive("owner/repo", FIRST)).rejects.toThrow("requesting archive; received 0 bytes");
  } finally { timeout.mockRestore(); }
});

it("bounds downloaded bytes and cancels the stream", async () => {
  let cancelled = false;
  const github = skillGithub(async () => new Response(new ReadableStream({
    pull(controller) { controller.enqueue(new Uint8Array(1024 * 1024)); },
    cancel() { cancelled = true; },
  })));
  await expect(github.archive("owner/repo", FIRST)).rejects.toThrow("size limit");
  expect(cancelled).toBe(true);
});

it("redacts signed URLs from network exceptions", async () => {
  const github = skillGithub(async () => { throw new Error("failed https://codeload.github.com/x?token=secret"); });
  await expect(github.archive("owner/repo", FIRST)).rejects.toThrow("GitHub download failed. Check network access and retry.");
});

it("reports access failures and rejects invalid metadata", async () => {
  await expect(skillGithub(async () => new Response(null, { status: 403 })).revision("owner/repo")).rejects.toThrow("HTTP 403");
  await expect(skillGithub(async () => new Response("invalid")).revision("owner/repo")).rejects.toThrow("invalid repository metadata");
  await expect(skillGithub(async () => Response.json({ sha: "main" })).revision("owner/repo")).rejects.toThrow("invalid commit revision");
});
