import { NodeExecutionEnv } from "../../src/session-runtime/node.ts";

const [mode, root, shellPath] = process.argv.slice(2);
if (!mode || !root) throw new Error("Missing synthetic shell fixture arguments");
process.env.ProgramFiles = root;
process.env["ProgramFiles(x86)"] = root;
if (mode === "bash" || mode === "bash-missing" || mode === "git-bash") process.env.WHYJ_SHELL = mode === "git-bash" ? "git-bash" : "bash";
else delete process.env.WHYJ_SHELL;

const env = new NodeExecutionEnv({ cwd: root, shellPath: mode === "custom" ? shellPath : undefined });
const command = mode === "git-bash" || mode.startsWith("bash") ? "printf 'WHYJ_SYNTHETIC'" : "Write-Output 'WHYJ_SYNTHETIC'";
const result = await env.exec(command, { timeout: 10 });
console.log(JSON.stringify(result.ok
  ? { ok: true, exitCode: result.value.exitCode, stdout: result.value.stdout.trim() }
  : { ok: false, code: result.error.code }));
