import { expect, it, spyOn } from "bun:test";
import { skillGithub } from "../github.ts";
import { FIRST } from "./fixtures/archive.ts";

function clock() {
  let now = 0, next = 0;
  const tasks = new Map<number, { at: number; fire: () => void }>();
  return {
    schedule(ms: number, fire: () => void) {
      const id = ++next;
      tasks.set(id, { at: now + ms, fire });
      return () => { tasks.delete(id); };
    },
    advance(ms: number) {
      now += ms;
      for (;;) {
        const due = [...tasks].filter(([, task]) => task.at <= now).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) return;
        tasks.delete(due[0]);
        due[1].fire();
      }
    },
    pending: () => tasks.size,
  };
}
const settle = () => new Promise<void>(resolve => setImmediate(resolve));

it("continues a progressing archive past three minutes and clears its timers", async () => {
  const timer = clock();
  // Also drive the previous implementation's AbortSignal deadline when this
  // regression is checked against the old transport.
  const oldTimeout = spyOn(AbortSignal, "timeout").mockImplementation(ms => {
    const controller = new AbortController();
    timer.schedule(ms, () => controller.abort());
    return controller.signal;
  });
  let body!: ReadableStreamDefaultController<Uint8Array>;
  let cancelled = false;
  try {
    const github = skillGithub(async () => new Response(new ReadableStream({ start(c) { body = c; }, cancel() { cancelled = true; } })), undefined, timer.schedule);
    const download = github.archive("owner/repo", FIRST).then(value => [...value], error => (error as Error).message);
    await settle();
    for (let i = 0; i < 4; i++) {
      timer.advance(59_000);
      await settle();
      if (cancelled) break;
      body.enqueue(new Uint8Array([i + 1]));
      await settle();
    }
    if (!cancelled) body.close();
    expect(await download).toEqual([1, 2, 3, 4]);
    expect(timer.pending()).toBe(0);
  } finally { oldTimeout.mockRestore(); }
});

it("stops an archive with no progress after one minute", async () => {
  const timer = clock();
  let cancelled = false;
  const github = skillGithub(async () => new Response(new ReadableStream({ cancel() { cancelled = true; } })), undefined, timer.schedule);
  const download = github.archive("owner/repo", FIRST);
  await settle();
  timer.advance(60_000);
  await expect(download).rejects.toThrow("stalled for 60000 ms");
  expect(cancelled).toBe(true);
  expect(timer.pending()).toBe(0);
});

it("does not treat an empty chunk as download progress", async () => {
  const timer = clock();
  let body!: ReadableStreamDefaultController<Uint8Array>;
  const github = skillGithub(async () => new Response(new ReadableStream({ start(c) { body = c; } })), undefined, timer.schedule);
  const download = github.archive("owner/repo", FIRST);
  await settle();
  timer.advance(59_000);
  body.enqueue(new Uint8Array());
  await settle();
  timer.advance(1_000);
  await expect(download).rejects.toThrow("stalled for 60000 ms");
  expect(timer.pending()).toBe(0);
});

it("clears both archive deadlines on explicit cancellation", async () => {
  const timer = clock(), controller = new AbortController();
  let cancelled = false;
  const github = skillGithub(async () => new Response(new ReadableStream({ cancel() { cancelled = true; } })), controller.signal, timer.schedule);
  const download = github.archive("owner/repo", FIRST);
  await settle();
  controller.abort();
  await expect(download).rejects.toThrow("Skill installation cancelled");
  expect(cancelled).toBe(true);
  expect(timer.pending()).toBe(0);
});

it("stops even a continuously progressing archive at the absolute ten-minute cap", async () => {
  const timer = clock();
  let body!: ReadableStreamDefaultController<Uint8Array>;
  const github = skillGithub(async () => new Response(new ReadableStream({ start(c) { body = c; } })), undefined, timer.schedule);
  const download = github.archive("owner/repo", FIRST);
  await settle();
  for (let i = 0; i < 10; i++) {
    timer.advance(59_000);
    body.enqueue(new Uint8Array([1]));
    await settle();
  }
  timer.advance(10_000);
  await expect(download).rejects.toThrow("timed out after 600000 ms");
  expect(timer.pending()).toBe(0);
});

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

it("retains the 60-second metadata deadline", async () => {
  const timer = clock();
  const github = skillGithub(async () => new Response(new ReadableStream()), undefined, timer.schedule);
  const request = github.revision("owner/repo");
  await settle();
  timer.advance(60_000);
  await expect(request).rejects.toThrow("timed out after 60000 ms");
  expect(timer.pending()).toBe(0);
});

it("reports partial archive progress on timeout without exposing the redirect URL", async () => {
  const timer = clock();
  let cancelled = false, calls = 0;
  const github = skillGithub(async () => {
    if (++calls === 1) return new Response(null, { status: 302, headers: { location: "https://codeload.github.com/owner/repo/tar.gz/revision?token=private-fixture" } });
    return new Response(new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array([1, 2, 3, 4, 5])); },
      cancel() { cancelled = true; },
    }));
  }, undefined, timer.schedule);
  const download = github.archive("owner/repo", FIRST);
  await settle();
  timer.advance(60_000);
  let message = "";
  try { await download; } catch (error) { message = (error as Error).message; }
  expect(message).toContain("stalled for 60000 ms");
  expect(message).toContain("receiving archive");
  expect(message).toContain("received 5 bytes");
  expect(message).not.toContain("private-fixture");
  expect(message).not.toContain("codeload.github.com");
  expect(cancelled).toBe(true);
  expect(timer.pending()).toBe(0);
});

it("identifies a timeout before archive response headers", async () => {
  const timer = clock();
  const github = skillGithub((_url, init) => new Promise((_resolve, reject) => {
    init.signal?.addEventListener("abort", () => reject(new Error("network detail")), { once: true });
  }), undefined, timer.schedule);
  const download = github.archive("owner/repo", FIRST);
  await settle();
  timer.advance(60_000);
  await expect(download).rejects.toThrow("requesting archive; received 0 bytes");
  expect(timer.pending()).toBe(0);
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
