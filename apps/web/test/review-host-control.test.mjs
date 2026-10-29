import { expect, test } from 'bun:test';
import { advanceFixture } from '../dev/review-host-control.mjs';

test('browser control waits for a delayed tool gate instead of acknowledging an empty advance', async () => {
  let ready = false, posts = 0, premature = 0;
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request) {
    if (new URL(request.url).pathname === '/state') return Response.json({ stage: 'executing', canAdvance: ready });
    posts++;
    if (!ready) { premature++; return Response.json({ advanced: false }, { status: 409 }); }
    ready = false;
    return Response.json({ advanced: true });
  } });
  const timer = setTimeout(() => { ready = true; }, 250);
  try {
    const delayed = await advanceFixture(server.url.origin);
    expect(delayed).toBeGreaterThan(0);
    expect(posts).toBe(1);
    expect(premature).toBe(0);
  } finally {
    clearTimeout(timer);
    await server.stop(true);
  }
});
