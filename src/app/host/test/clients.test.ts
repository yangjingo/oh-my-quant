import { expect, test } from "bun:test";
import { createHostClients } from "../clients.ts";

test("client expiry removes presence, validates the instance and permits explicit reattachment", () => {
  let now = 0;
  const clients = createHostClients("instance", () => now);
  const attached = clients.update({ instanceId: "instance", action: "attach", kind: "tui" });
  expect(clients.count()).toBe(1);
  now = 60_000; clients.update({ instanceId: "instance", action: "renew", clientId: attached.clientId });
  now = 100_000; expect(clients.count()).toBe(1);
  expect(() => clients.update({ instanceId: "old-instance", action: "detach", clientId: attached.clientId })).toThrow("实例已变化");
  now = 151_000; expect(clients.count()).toBe(0);
  expect(() => clients.update({ instanceId: "instance", action: "renew", clientId: attached.clientId })).toThrow("已失效");
  expect(() => clients.update({ instanceId: "instance", action: "attach", kind: "desktop", path: "private" })).toThrow("参数无效");
  const next = clients.update({ instanceId: "instance", action: "attach", kind: "desktop" });
  clients.update({ instanceId: "instance", action: "detach", clientId: next.clientId });
  clients.update({ instanceId: "instance", action: "detach", clientId: next.clientId });
  expect(clients.count()).toBe(0);
});
