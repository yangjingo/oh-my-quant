import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { dirname, normalize, resolve } from "node:path";
import { resolveOhquantDir } from "../../storage/index.ts";

export function revealInFileManager(targetPath: string): boolean {
  const absPath = normalize(resolve(targetPath));
  const base = normalize(resolve(resolveOhquantDir()));
  const sep = process.platform === "win32" ? "\\" : "/";
  if (absPath !== base && !absPath.startsWith(base + sep)) {
    throw new Error("只能打开工作台受控目录下的文件或文件夹。");
  }
  if (!existsSync(absPath)) {
    throw new Error("目标文件或路径不存在。");
  }

  const isDir = statSync(absPath).isDirectory();
  if (process.platform === "win32") {
    const args = isDir ? [absPath] : [`/select,${absPath}`];
    const proc = spawn("explorer.exe", args, { detached: true, stdio: "ignore" });
    proc.unref();
    return true;
  }
  if (process.platform === "darwin") {
    const args = isDir ? [absPath] : ["-R", absPath];
    const proc = spawn("open", args, { detached: true, stdio: "ignore" });
    proc.unref();
    return true;
  }
  const dir = isDir ? absPath : dirname(absPath);
  const proc = spawn("xdg-open", [dir], { detached: true, stdio: "ignore" });
  proc.unref();
  return true;
}
