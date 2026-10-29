import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { createDefaultSessionDependencies } from "../../../../runtime/session-dependencies.ts";
import { createWorkbenchService } from "../../service.ts";
import { startWorkbenchServer } from "../../server.ts";

const root = process.env.OHQUANT_DIR!;
const service = createWorkbenchService({ cwd: root, dependencies: () => {
  const original = createDefaultSessionDependencies({ cwd: root });
  return { ...original, tools: original.tools.map(tool => tool.name !== "calculate_position_scenarios" || !process.env.WHYJ_TEST_HOLD_TOOL ? tool : {
    ...tool, async execute() {
      appendFileSync(join(root, "tool-receipt"), "started\n");
      return new Promise<never>(() => {});
    },
  }) };
} });
const host = startWorkbenchServer({ service, port: 0, assetsRoot: join(root, "assets") });
await service.client.identity();
console.log(JSON.stringify({ url: host.server.url.origin }));
