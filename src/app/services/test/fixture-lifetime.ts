export function createFixtureLifetime(drainTimeoutMs = 25000) {
  let pending: Promise<void> | undefined;
  return {
    track: (body: () => Promise<void>) => () => {
      if (pending) throw new Error("Previous fixture body is still running");
      const operation = Promise.resolve().then(body);
      pending = operation;
      void operation.then(() => { if (pending === operation) pending = undefined; }, () => { if (pending === operation) pending = undefined; });
      return operation;
    },
    drain: async () => {
      if (!pending) return;
      const watchdog = setTimeout(() => {
        console.error("Timed-out fixture body did not settle; stopping the test process before shared state can be reused");
        process.exit(1);
      }, drainTimeoutMs);
      try { await pending.catch(() => {}); } finally { clearTimeout(watchdog); }
    },
  };
}
