export function shellDisplayName(): "PowerShell" | "Bash" {
  const requested = process.env.WHYJ_SHELL?.trim().toLowerCase();
  return process.platform === "win32" && requested !== "bash" && requested !== "git-bash"
    ? "PowerShell"
    : "Bash";
}
