import type { WorkbenchClient } from "./contract";

const unavailable = async (): Promise<never> => { throw new Error("Host 未连接。请从已连接的桌面或工作区入口打开。"); };

/** Default application entry: never silently replace an unavailable Host with fixtures. */
export function createDisconnectedClient(): WorkbenchClient {
  return {
    mode: "disconnected",
    identity: unavailable, workspaces: unavailable, transcript: unavailable,
    market: unavailable, output: unavailable, session: unavailable,
    createSession: unavailable, renameSession: unavailable, references: unavailable,
    preferences: unavailable, updatePreferences: unavailable,
    submit: unavailable, cancel: unavailable,
    subscribe: () => () => {},
  };
}
