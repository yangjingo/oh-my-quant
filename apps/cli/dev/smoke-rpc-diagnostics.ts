/** Keep RPC diagnostics bounded and preserve the original failure, including logger errors. */
export function createSmokeRpcDiagnostics(context: () => { host: string; modelRequests: number }, log = console.error) {
  return async function smokeRpcRequest<T>(phase: string, operation: () => Promise<T>): Promise<T> {
    try { return await operation(); }
    catch (error) {
      try { log(JSON.stringify({ diagnostic: "packaged-rpc", phase, ...context() })); }
      catch { /* Preserve the original transport or body-read error. */ }
      throw error;
    }
  };
}
