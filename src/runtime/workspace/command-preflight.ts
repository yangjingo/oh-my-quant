import { AKSHARE_PUBLIC_INDEX_ENDPOINTS } from "../../source/index.ts";
import { toolProbeSchemaResult } from "../data/tool-probe-schema.ts";
import { commandPreflightCore } from "./command-preflight-core.ts";
import type { CommandResult, ParsedCommand } from "../../types/commands.ts";

/** Pure preflight: run before activity changes, configuration reads and command side effects. */
export function commandPreflight(parsed: ParsedCommand): CommandResult | undefined {
  return commandPreflightCore(parsed, ({ command, flags, positional }) => {
    const fail = (message: string): CommandResult => ({ success: false, message: `${message} Use /${command} --help for usage.` });
    if (flags.installed === undefined) return toolProbeSchemaResult(flags, positional);
    if (flags.installed !== true) return fail("--installed is a no-value flag.");
    const { installed: _installed, ...staticFlags } = flags;
    const declaration = toolProbeSchemaResult(staticFlags, positional);
    if (!declaration.success) return declaration;
    const routes = (declaration.data as { routes: Array<{ provider: string; endpoint: string }> }).routes;
    if (routes.some(route => route.provider !== "akshare" || !AKSHARE_PUBLIC_INDEX_ENDPOINTS.includes(route.endpoint as typeof AKSHARE_PUBLIC_INDEX_ENDPOINTS[number])))
      return fail("--installed applies only to AKShare index routes; add --provider akshare and/or --endpoint.");
    return;
  });
}
