import { afterEach, beforeEach, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { acquireResourceLeaseSet, acquireResourceLeases, resourceLeaseMetadataPath } from "../src/resource-leases.ts";
import { createHostRuntimeStore } from "../src/host-runtime.ts";

let previousLeaseRoot: string | undefined;
beforeEach(() => { previousLeaseRoot = process.env.WHYJ_RESOURCE_LEASE_ROOT; });
afterEach(() => { if (previousLeaseRoot === undefined) delete process.env.WHYJ_RESOURCE_LEASE_ROOT; else process.env.WHYJ_RESOURCE_LEASE_ROOT = previousLeaseRoot; });
function fixture() { const root = mkdtempSync(join(tmpdir(), "whyj-resource-leases-")); process.env.WHYJ_RESOURCE_LEASE_ROOT = join(root, "registry"); return root; }
function cleanup(root: string) {
  if (!resolve(root).startsWith(resolve(tmpdir()) + sep + "whyj-resource-leases-")) throw new Error("Unexpected fixture path");
  rmSync(root, { recursive: true, force: true });
}

test("multiple readers coexist; writers exclude readers and other writers until released", async () => {
  const root = fixture();
  try {
    const first = await acquireResourceLeases([root], "read"), second = await acquireResourceLeases([root], "read");
    try {
      await expect(acquireResourceLeases([root], "write")).rejects.toMatchObject({ code: "RESOURCES_IN_USE" });
      await first();
      await expect(acquireResourceLeases([root], "write")).rejects.toMatchObject({ code: "RESOURCES_IN_USE" });
    } finally { await first(); await second(); }
    const writer = await acquireResourceLeases([root], "write");
    try {
      await expect(acquireResourceLeases([root], "read")).rejects.toMatchObject({ code: "RESOURCES_IN_USE" });
      await expect(acquireResourceLeases([root], "write")).rejects.toMatchObject({ code: "RESOURCES_IN_USE" });
    } finally { await writer(); }
    await (await acquireResourceLeases([root], "read"))();
  } finally { cleanup(root); }
});

test("independent processes share readers and exclude a writer until the child releases", async () => {
  const root = fixture(), modulePath = resolve(import.meta.dir, "../src/resource-leases.ts");
  const code = 'const {acquireResourceLeases}=await import(process.argv[1]); const release=await acquireResourceLeases([process.argv[2]],"read"); console.log("ready"); await new Promise(resolve=>process.stdin.once("data",resolve)); await release();';
  const child = Bun.spawn([process.execPath, "-e", code, modulePath, root], { stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  const reader = child.stdout.getReader();
  try {
    const first = await Promise.race([reader.read(), Bun.sleep(5000).then(() => { throw new Error("Child did not acquire its lease"); })]);
    expect(new TextDecoder().decode(first.value)).toContain("ready");
    const other = await acquireResourceLeases([root], "read");
    try { await expect(acquireResourceLeases([root], "write")).rejects.toMatchObject({ code: "RESOURCES_IN_USE" }); }
    finally { await other(); }
    child.stdin.write("release\n"); child.stdin.end();
    expect(await child.exited).toBe(0);
    await (await acquireResourceLeases([root], "write"))();
  } finally {
    reader.releaseLock();
    if (child.exitCode === null) { child.kill(); await child.exited; }
    cleanup(root);
  }
}, 15000);

test("concurrent writers have one winner even when the directory is named twice", async () => {
  const root = fixture();
  try {
    const attempts = await Promise.allSettled(Array.from({ length: 8 }, () => acquireResourceLeases([root, join(root, ".")], "write")));
    const winners = attempts.filter((item): item is PromiseFulfilledResult<() => Promise<void>> => item.status === "fulfilled");
    expect(winners).toHaveLength(1);
    expect(attempts.filter(item => item.status === "rejected")).toHaveLength(7);
    await winners[0]!.value();
    await (await acquireResourceLeases([root], "write"))();
  } finally { cleanup(root); }
});

test("a directory alias shares the same lease and a linked metadata directory is refused", async () => {
  const root = fixture(), resource = join(root, "resource"), alias = join(root, "alias"), target = join(root, "other"), hostile = join(root, "hostile");
  mkdirSync(resource); mkdirSync(target); mkdirSync(hostile);
  try {
    symlinkSync(resource, alias, process.platform === "win32" ? "junction" : "dir");
    const read = await acquireResourceLeases([resource], "read");
    try { await expect(acquireResourceLeases([alias], "write")).rejects.toMatchObject({ code: "RESOURCES_IN_USE" }); }
    finally { await read(); }
    const metadata = resourceLeaseMetadataPath(hostile); mkdirSync(dirname(metadata), { recursive: true });
    symlinkSync(target, metadata, process.platform === "win32" ? "junction" : "dir");
    await expect(acquireResourceLeases([hostile], "write")).rejects.toMatchObject({ code: "RESOURCE_LEASE_INVALID" });
  } finally { cleanup(root); }
});

test("a failed multi-resource acquisition releases only its own earlier leases", async () => {
  const root = fixture(), first = join(root, "a"), second = join(root, "b"); mkdirSync(first); mkdirSync(second);
  try {
    const owner = await acquireResourceLeases([second], "read");
    try {
      await expect(acquireResourceLeases([second, first, first], "write")).rejects.toMatchObject({ code: "RESOURCES_IN_USE" });
      await (await acquireResourceLeases([first], "write"))();
      await expect(acquireResourceLeases([second], "write")).rejects.toMatchObject({ code: "RESOURCES_IN_USE" });
    } finally { await owner(); }
  } finally { cleanup(root); }
});

test("mixed resource modes allow shared reads, exclude writers and promote duplicate aliases", async () => {
  const root = fixture(), global = join(root, "global"), local = join(root, "project"); mkdirSync(global); mkdirSync(local);
  try {
    const globalReader = await acquireResourceLeases([global], "read");
    const mixed = await acquireResourceLeaseSet([{ directory: global, mode: "read" }, { directory: local, mode: "write" }]);
    try {
      await expect(acquireResourceLeases([global], "write")).rejects.toMatchObject({ code: "RESOURCES_IN_USE" });
      await expect(acquireResourceLeases([local], "read")).rejects.toMatchObject({ code: "RESOURCES_IN_USE" });
    } finally { await mixed(); await globalReader(); }
    const alias = join(root, "global-alias"); symlinkSync(global, alias, process.platform === "win32" ? "junction" : "dir");
    const exclusive = await acquireResourceLeaseSet([{ directory: global, mode: "read" }, { directory: alias, mode: "write" }]);
    try { await expect(acquireResourceLeases([global], "read")).rejects.toMatchObject({ code: "RESOURCES_IN_USE" }); }
    finally { await exclusive(); }
    await (await acquireResourceLeases([global, local], "write"))();
  } finally { cleanup(root); }
});

test("a failed mixed acquisition releases its partial scopes without disturbing the conflicting writer", async () => {
  const root = fixture(), global = join(root, "global"), local = join(root, "project"); mkdirSync(global); mkdirSync(local);
  try {
    const writer = await acquireResourceLeases([global], "write");
    try {
      await expect(acquireResourceLeaseSet([{ directory: global, mode: "read" }, { directory: local, mode: "write" }]))
        .rejects.toMatchObject({ code: "RESOURCES_IN_USE" });
      await (await acquireResourceLeases([local], "write"))();
      await expect(acquireResourceLeases([global], "read")).rejects.toMatchObject({ code: "RESOURCES_IN_USE" });
    } finally { await writer(); }
  } finally { cleanup(root); }
});

test("a missing resource is not created and keeps the same identity after creation", async () => {
  const root = fixture(), resource = join(root, "missing", ".pi");
  try {
    const read = await acquireResourceLeases([resource], "read");
    try {
      expect(existsSync(resource)).toBe(false);
      mkdirSync(resource, { recursive: true });
      await expect(acquireResourceLeases([resource], "write")).rejects.toMatchObject({ code: "RESOURCES_IN_USE" });
    } finally { await read(); }
    await (await acquireResourceLeases([resource], "write"))();
  } finally { cleanup(root); }
});

test("relative namespace overrides fail rather than split coordination by cwd", async () => {
  const root = fixture();
  try {
    process.env.WHYJ_RESOURCE_LEASE_ROOT = "relative-leases";
    await expect(acquireResourceLeases([root], "read")).rejects.toMatchObject({ code: "RESOURCE_LEASE_INVALID" });
  } finally { cleanup(root); }
});

test("the default namespace belongs to the operating system account", () => {
  const root = fixture();
  try {
    delete process.env.WHYJ_RESOURCE_LEASE_ROOT;
    expect(dirname(resourceLeaseMetadataPath(root))).toBe(join(userInfo().homedir, ".whyj-quant", "resource-leases"));
  } finally { cleanup(root); }
});

test("concurrent release is idempotent across all acquired paths", async () => {
  const root = fixture(), first = join(root, "a"), second = join(root, "b");
  try {
    const release = await acquireResourceLeases([first, second], "read");
    await Promise.all([release(), release(), release()]);
    await (await acquireResourceLeases([first, second], "write"))();
  } finally { cleanup(root); }
});

test("malformed registry remains unchanged and cancellation does not publish a holder", async () => {
  const root = fixture(), meta = resourceLeaseMetadataPath(root), path = join(meta, "holders.json"); mkdirSync(meta, { recursive: true });
  try {
    writeFileSync(path, "not-json");
    await expect(acquireResourceLeases([root], "write")).rejects.toMatchObject({ code: "RESOURCE_LEASE_INVALID" });
    expect(readFileSync(path, "utf8")).toBe("not-json");
    writeFileSync(path, JSON.stringify({ version: 1, holders: [] }));
    const before = readFileSync(path), controller = new AbortController(); controller.abort();
    await expect(acquireResourceLeases([root], "read", controller.signal)).rejects.toThrow();
    expect(readFileSync(path)).toEqual(before);
  } finally { cleanup(root); }
});

test("a live registry gate is not stolen and a cancelled waiter leaves the owner untouched", async () => {
  const root = fixture(), meta = resourceLeaseMetadataPath(root); mkdirSync(meta, { recursive: true });
  const store = createHostRuntimeStore(meta), gate = store.acquire("owner"), controller = new AbortController();
  try {
    const waiting = acquireResourceLeases([root], "read", controller.signal);
    await Bun.sleep(150); controller.abort();
    await expect(waiting).rejects.toThrow();
    expect(store.readOwner("owner")?.instanceId).toBe(gate.instanceId);
    gate.release(); await (await acquireResourceLeases([root], "write"))();
  } finally { gate.release(); cleanup(root); }
});

test("a gate left by a confirmed dead process can be reclaimed", async () => {
  const root = fixture(), meta = resourceLeaseMetadataPath(root); mkdirSync(meta, { recursive: true });
  const modulePath = resolve(import.meta.dir, "../src/host-runtime.ts");
  try {
    const code = 'const {createHostRuntimeStore}=await import(process.argv[1]); createHostRuntimeStore(process.argv[2]).acquire("owner");';
    const child = Bun.spawn([process.execPath, "-e", code, modulePath, meta], { stdout: "ignore", stderr: "ignore" });
    expect(await child.exited).toBe(0);
    const store = createHostRuntimeStore(meta); expect(store.readOwner("owner")?.pid).toBe(child.pid);
    await (await acquireResourceLeases([root], "read"))();
    expect(store.readOwner("owner")).toBeUndefined();
  } finally { cleanup(root); }
});

test.skipIf(process.platform !== "win32")("a readable resource directory does not need permission to create metadata inside it", async () => {
  const root = fixture(), resource = join(root, "read-only"); mkdirSync(resource);
  writeFileSync(join(resource, "SKILL.md"), "readable fixture");
  const shell = Bun.which("pwsh") ?? Bun.which("powershell");
  if (!shell) throw new Error("PowerShell is required for the isolated Windows ACL test");
  const run = (script: string, extra: Record<string, string> = {}) => Bun.spawnSync([shell, "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], {
    env: { ...process.env, WHYJ_ACL_TEST_DIRECTORY: resource, ...extra }, stdout: "pipe", stderr: "pipe" });
  // Compare actual access rules independently of raw SDDL formatting and ordering.
  const fingerprint = 'function Fingerprint($acl) { $rules=@($acl.GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier]) | ForEach-Object { "{0}|{1}|{2}|{3}|{4}|{5}" -f $_.IdentityReference.Value,[int]$_.FileSystemRights,$_.AccessControlType,$_.InheritanceFlags,$_.PropagationFlags,$_.IsInherited } | Sort-Object); [ordered]@{Owner=$acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value; Group=$acl.GetGroup([System.Security.Principal.SecurityIdentifier]).Value; Protected=$acl.AreAccessRulesProtected; Rules=$rules} | ConvertTo-Json -Compress }';
  const saved = run(`${fingerprint}; Fingerprint (Get-Acl -LiteralPath $env:WHYJ_ACL_TEST_DIRECTORY)`);
  if (saved.exitCode !== 0) throw new Error("Could not inspect isolated fixture ACL");
  const original = saved.stdout.toString().trim();
  let restored = false;
  try {
    const deny = run('$ErrorActionPreference="Stop"; $acl=Get-Acl -LiteralPath $env:WHYJ_ACL_TEST_DIRECTORY; $sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User; $r=[System.Security.AccessControl.FileSystemRights]::CreateFiles -bor [System.Security.AccessControl.FileSystemRights]::CreateDirectories; $rule=[System.Security.AccessControl.FileSystemAccessRule]::new($sid,$r,[System.Security.AccessControl.InheritanceFlags]::None,[System.Security.AccessControl.PropagationFlags]::None,[System.Security.AccessControl.AccessControlType]::Deny); $acl.AddAccessRule($rule); Set-Acl -LiteralPath $env:WHYJ_ACL_TEST_DIRECTORY -AclObject $acl');
    if (deny.exitCode !== 0) throw new Error(`Could not restrict isolated fixture ACL: ${deny.stderr.toString().trim()}`);
    expect(readFileSync(join(resource, "SKILL.md"), "utf8")).toBe("readable fixture");
    expect(() => writeFileSync(join(resource, "must-not-write"), "fixture")).toThrow();
    await (await acquireResourceLeases([resource], "read"))();
    expect(existsSync(join(resource, ".whyj-resource-leases"))).toBe(false);
  } finally {
    const restore = run(`${fingerprint}; $ErrorActionPreference="Stop"; $acl=Get-Acl -LiteralPath $env:WHYJ_ACL_TEST_DIRECTORY; $sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User; $r=[System.Security.AccessControl.FileSystemRights]::CreateFiles -bor [System.Security.AccessControl.FileSystemRights]::CreateDirectories; $rule=[System.Security.AccessControl.FileSystemAccessRule]::new($sid,$r,[System.Security.AccessControl.InheritanceFlags]::None,[System.Security.AccessControl.PropagationFlags]::None,[System.Security.AccessControl.AccessControlType]::Deny); $acl.RemoveAccessRuleSpecific($rule); Set-Acl -LiteralPath $env:WHYJ_ACL_TEST_DIRECTORY -AclObject $acl; $actual=Fingerprint (Get-Acl -LiteralPath $env:WHYJ_ACL_TEST_DIRECTORY); if ($actual -ne $env:WHYJ_ACL_TEST_ORIGINAL) { throw "Restored ACL rules differ. Expected: $env:WHYJ_ACL_TEST_ORIGINAL; actual: $actual" }`, { WHYJ_ACL_TEST_ORIGINAL: original });
    restored = restore.exitCode === 0;
    if (restored) cleanup(root);
    if (!restored) throw new Error(`Could not restore isolated fixture ACL: ${root}: ${restore.stderr.toString().trim()}`);
  }
}, 15000);

test("confirmed dead holders are reclaimed, but a live process is never assumed stale", async () => {
  const root = fixture(), meta = resourceLeaseMetadataPath(root), path = join(meta, "holders.json"); mkdirSync(meta, { recursive: true });
  try {
    const child = Bun.spawn([process.execPath, "-e", ""], { stdout: "ignore", stderr: "ignore" }); await child.exited;
    writeFileSync(path, JSON.stringify({ version: 1, holders: [{ id: randomUUID(), pid: child.pid, mode: "write" }] }));
    await (await acquireResourceLeases([root], "read"))();
    const live = { id: randomUUID(), pid: process.pid, mode: "read" }; writeFileSync(path, JSON.stringify({ version: 1, holders: [live] }));
    await expect(acquireResourceLeases([root], "write")).rejects.toMatchObject({ code: "RESOURCES_IN_USE" });
    expect(JSON.parse(readFileSync(path, "utf8")).holders).toEqual([live]);
  } finally { cleanup(root); }
});
