import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AppRuntime, createInitialAppState } from "./app-runtime.ts";
import { QuantTui } from "./tui/src/tui.ts";
import { ensureDefaultSkills } from "./skill/index.ts";

export async function startApp(): Promise<void> {
  ensureDefaultSkills();
  const initial = createInitialAppState(getPkgVersion());
  let tui: QuantTui | null = null;

  const runtime = new AppRuntime({
    onMessages: (messages) => tui?.update({ messages }),
    onActivity: (activity) => tui?.update({ activity }),
    onLocalState: (partial) => tui?.update(partial),
    onComposerStatus: (composerStatus) => tui?.update({ composerStatus }),
    onComposerQueue: (composerQueue) => tui?.update({ composerQueue }),
    onConfigRequest: () => tui?.openConfig(),
    onResumeRequest: (meta) => tui?.openResume(meta),
    onPortfolioRequest: () => tui?.openPortfolio(),
    onHelpRequest: () => tui?.openHelp(),
    onSessionRequest: (meta) => tui?.syncCurrentSessionMeta(meta),
    onPanel: (panel, panelLoading = false) => tui?.update({ panel, panelLoading }),
  });

  tui = new QuantTui(initial);
  tui.start();

  try {
    const snapshot = await runtime.bootstrap();
    tui.update({
      model: snapshot.model,
      modelLabel: snapshot.modelLabel,
      panelLoading: false,
      activity: "ready",
    });
  } catch (err) {
    tui.update({
      panelLoading: false,
      activity: "ready",
      messages: [
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
      tui!.stop();
      process.exit(0);
    }
  });

  tui.onPanelRefresh(() => {
    void runtime.refreshOverviewPanel();
  });

  process.once("exit", () => {
    runtime.dispose();
    tui?.stop();
  });
}

function getPkgVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf-8"));
    return pkg.version || "0.1.0";
  } catch {
    return "0.1.0";
  }
}
