import { createHostRuntimeStore } from "../../../src/storage/index.ts";
import { tmpdir } from "node:os";
import { resolve, sep } from "node:path";

// Test-only: hold the real discovery lock until the parent releases stdin.
const root = process.env.OHQUANT_DIR;
if (!root || !resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("An isolated temporary workspace root is required.");
const lock = createHostRuntimeStore(root).acquire("startup");
process.stdout.write("locked\n");
try { for await (const _chunk of process.stdin) break; }
finally { lock.release(); }
