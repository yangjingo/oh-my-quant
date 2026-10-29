import { expect, test } from "bun:test";
import { runWebCommand, openWorkbench } from "../src/web.ts";
import type { HostConnection } from "../../../src/app/bootstrap.ts";
import { HOST_SERVICE_CONTRACT_VERSION } from "../../../src/app/host/protocol.ts";

const connection: HostConnection = { instanceId: "instance", workspaceId: "workspace", url: "http://127.0.0.1:12345/",
  protocolVersion: 1, serviceContractVersion: HOST_SERVICE_CONTRACT_VERSION, applicationVersion: "1.4.0", started: false,
  token: "PRIVATE_CAPABILITY", controlToken: "PRIVATE_CONTROL_CAPABILITY" };

test("web opens only after authenticated readiness and never prints capabilities", async () => {
  const calls: string[] = [];
  const result = await runWebCommand([], { connect: async () => { calls.push("ready"); return connection; },
    open: async url => { expect(url).toBe(connection.url); calls.push("open"); } });
  expect(calls).toEqual(["ready", "open"]);
  expect(result).toMatchObject({ started: false, browserOpened: true, instanceId: "instance" });
  expect(JSON.stringify(result)).not.toContain("CAPABILITY");
});

test("missing browser handler preserves a useful connection and manual-open URL", async () => {
  const result = await runWebCommand([], { connect: async () => connection, open: async () => { throw new Error("ENOENT"); } });
  expect(result.browserOpened).toBe(false);
  expect(result.warning).toContain("manually");
  expect(result.url).toBe(connection.url);
});

test("web validates arguments before connecting; startup failure never opens a browser", async () => {
  const unexpected = async (): Promise<never> => { throw new Error("Unexpected call"); };
  for (const args of [["--port", "0"], ["--no-open", "--no-open"], ["anything"]]) {
    await expect(runWebCommand(args, { connect: unexpected, open: unexpected })).rejects.toThrow("Use whyj");
  }
  await expect(runWebCommand([], { connect: async () => { throw new Error("HOST_IDENTITY_CONFLICT"); }, open: unexpected })).rejects.toThrow("HOST_IDENTITY_CONFLICT");
  expect(await runWebCommand(["--no-open"], { connect: async () => connection, open: unexpected })).toMatchObject({ browserOpened: false });
});

test.each(["https://example.com", "file:///C:/private", "http://127.0.0.1:12345/?token=secret", "http://user:secret@127.0.0.1:12345/", "http://127.0.0.1:12345/#secret"])("browser opener rejects non-endpoint URLs: %s", async url => {
  await expect(openWorkbench(url)).rejects.toThrow("Invalid local Host URL");
});
