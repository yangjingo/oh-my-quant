export function shellDisplayName(): "PowerShell" | "Bash" {
  return process.platform === "win32" && process.env.WHYJ_SHELL?.toLowerCase() !== "bash"
    ? "PowerShell"
    : "Bash";
}
