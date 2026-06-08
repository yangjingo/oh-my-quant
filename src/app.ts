import { AppRuntime, createInitialAppState } from "./app-runtime.ts";
import { QuantTui } from "./tui/src/tui.ts";

export async function startApp(): Promise<void> {
  const initial = createInitialAppState(getPkgVersion());
  const tui = new QuantTui(initial);
  tui.start();

  const runtime = new AppRuntime({
    onMessages: (messages) => tui.update({ messages }),
    onActivity: (activity) => tui.update({ activity }),
    onComposerStatus: (composerStatus) => tui.update({ composerStatus }),
    onConfigRequest: () => tui.openConfig(),
  });

  try {
    const snapshot = await runtime.init();
    tui.update({
      model: snapshot.model,
      modelLabel: snapshot.modelLabel,
      panelLoading: false,
    });
  } catch (err) {
    tui.update({
      panelLoading: false,
      activity: "ready",
      messages: [
        ...tui.state.messages,
        {
          role: "error",
          text: err instanceof Error ? err.message : String(err),
        },
      ],
    });
  }

  tui.onSubmit(async (input: string) => {
    const result = await runtime.submit(input);
    if (result === "exit") {
      runtime.dispose();
      tui.stop();
      process.exit(0);
    }
  });

  process.once("exit", () => {
    runtime.dispose();
    tui.stop();
  });
}

function getPkgVersion(): string {
  try {
    const { readFileSync } = require("node:fs");
    const pkg = JSON.parse(readFileSync(require("node:path").join(process.cwd(), "package.json"), "utf-8"));
    return pkg.version || "2.0.5";
  } catch {
    return "2.0.5";
  }
}
