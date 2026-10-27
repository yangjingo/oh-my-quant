import { mkdirSync, rmdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createHostRuntimeStore } from "../../../../storage/index.ts";

const root = process.env.OHQUANT_DIR!, store = createHostRuntimeStore(root);
if (process.argv[2] === "race") {
  const deadline = Date.now() + 10_000;
  for (;;) {
    let lease: ReturnType<typeof store.acquire>;
    try { lease = store.acquire("owner"); }
    catch (error) {
      if (!["HOST_LOCKED", "HOST_METADATA_INVALID"].includes((error as { code?: string }).code ?? "") || Date.now() > deadline) throw error;
      await delay(5); continue;
    }
    try {
      // Independent witness: this mkdir fails if two children enter together.
      mkdirSync(join(root, "critical-section"));
      await delay(30);
      rmdirSync(join(root, "critical-section"));
      console.log("exclusive");
    } finally { lease.release(); }
    break;
  }
} else {
  const lease = store.acquire(process.argv[2] === "startup" ? "startup" : "owner");
  writeFileSync(join(root, "child-ready.json"), JSON.stringify({ pid: process.pid, instanceId: lease.instanceId }));
  setInterval(() => {}, 1000);
}
