import { renameSync } from "node:fs";
import { createRequire } from "node:module";
import { toNamespacedPath } from "node:path";

const nodeRequire = createRequire(import.meta.url);
type NativeFunction = (...args: string[]) => number;
type NativeLibrary = { func: (convention: string, name: string, result: string, args: string[]) => NativeFunction };
type NativeModule = { load: (name: string) => NativeLibrary };
let windowsMove: { library: NativeLibrary; move: NativeFunction; lastError: NativeFunction } | undefined;

/** Atomically publish a populated candidate without replacing Windows metadata. */
export function publishHostLock(source: string, destination: string): void {
  if (process.platform !== "win32") {
    renameSync(source, destination);
    return;
  }
  if (!windowsMove) {
    // Bundled x64 Desktop entries embed or include this Node-API addon. The
    // npm CLI resolves the same file from its required installed package.
    const ffi: NativeModule = process.arch === "x64"
      ? require("koffi/build/koffi/win32_x64/koffi.node")
      : nodeRequire("koffi");
    const library = ffi.load("kernel32.dll");
    windowsMove = {
      library,
      move: library.func("__stdcall", "MoveFileW", "int", ["str16", "str16"]),
      lastError: library.func("__stdcall", "GetLastError", "uint32", []),
    };
  }
  if (windowsMove.move(toNamespacedPath(source), toNamespacedPath(destination))) return;
  const win32Code = windowsMove.lastError();
  const code = win32Code === 80 || win32Code === 183 ? "EEXIST"
    : win32Code === 5 ? "EPERM"
    : win32Code === 2 || win32Code === 3 ? "ENOENT"
    : win32Code === 32 || win32Code === 33 ? "EBUSY"
    : "EIO";
  throw Object.assign(new Error(`Host ownership publication failed (Windows error ${win32Code}).`), { code, win32Code });
}
