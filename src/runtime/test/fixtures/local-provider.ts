/** A stopped socket can still have an async handler reading its request body.
 * Drain those handlers before their fixture's state or workspace is replaced. */
export function localProvider(reply: (request: Request) => Promise<Response>) {
  const pending = new Set<Promise<Response>>();
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
    const response = reply(request);
    pending.add(response);
    const settled = () => { pending.delete(response); };
    void response.then(settled, settled);
    return response;
  } });
  return { url: server.url, async close() {
    await server.stop(true);
    await Promise.allSettled([...pending]);
  } };
}
