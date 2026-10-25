/** Copy plain text to the OS clipboard (Windows / macOS / Linux). */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (!text) return false;
  try {
    if (process.platform === "win32") {
      const proc = Bun.spawn(["clip"], { stdin: "pipe", stdout: "ignore", stderr: "ignore" });
      proc.stdin.write(text);
      proc.stdin.end();
      return (await proc.exited) === 0;
    }
    if (process.platform === "darwin") {
      const proc = Bun.spawn(["pbcopy"], { stdin: "pipe", stdout: "ignore", stderr: "ignore" });
      proc.stdin.write(text);
      proc.stdin.end();
      return (await proc.exited) === 0;
    }
    const proc = Bun.spawn(["xclip", "-selection", "clipboard"], {
      stdin: "pipe",
      stdout: "ignore",
      stderr: "ignore",
    });
    proc.stdin.write(text);
    proc.stdin.end();
    return (await proc.exited) === 0;
  } catch {
    return false;
  }
}
