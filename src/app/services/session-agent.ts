import type { QuantAgentDependencies } from "../../agent/src/session-contracts.ts";
import { WorkbenchError } from "../workbench/errors.ts";

/** Both research and idle terminal commands reopen the recorded core journal. */
export function restoredSessionRepository(repository: QuantAgentDependencies["sessions"], cwd: string, coreSessionId: string | null): QuantAgentDependencies["sessions"] {
  let opening = true;
  return {
    async create(input) {
      if (opening && coreSessionId) {
        opening = false;
        try {
          const target = (await repository.list({ cwd })).find(item => item.id === coreSessionId);
          if (!target) throw new Error("Missing journal");
          return await repository.open(target);
        } catch { throw new WorkbenchError("CONTEXT_MISSING", "原研究上下文无法读取。请保留记录并新建会话，不会使用空上下文继续。", 409); }
      }
      opening = false; return repository.create(input);
    },
    open: repository.open.bind(repository), list: repository.list.bind(repository),
  };
}

/** Cancelling a queued command releases its wait without cancelling that run. */
export async function waitForResearch(pending: Promise<void> | undefined, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  if (!pending) return;
  await new Promise<void>((resolve, reject) => {
    const abort = () => { cleanup(); reject(signal.reason); };
    const cleanup = () => signal.removeEventListener("abort", abort);
    signal.addEventListener("abort", abort, { once: true });
    pending.then(() => { cleanup(); resolve(); }, error => { cleanup(); reject(error); });
    if (signal.aborted) abort();
  });
}
