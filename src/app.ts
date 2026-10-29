import manifest from "../package.json";
import { AppRuntime, createInitialAppState } from "./app-runtime.ts";
import { QuantTui } from "../apps/tui/src/tui.ts";
import { loadSettings } from "./storage/index.ts";
import type { HostConnection } from "./app/bootstrap.ts";

export async function startApp(connection: HostConnection): Promise<void> {
  const initial = createInitialAppState(manifest.version);
  let tui: QuantTui | null = null;

  const runtime = new AppRuntime({
    onMessages: (messages) => tui?.update({ messages }),
    onActivity: (activity) => tui?.update({ activity }),
    onLocalState: (partial) => tui?.update(partial),
    onComposerStatus: (composerStatus) => tui?.update({ composerStatus }),
    onComposerQueue: (composerQueue) => tui?.update({ composerQueue }),
    onRecoverySnapshot: snapshot => tui?.setRecoverySnapshot(snapshot),
    onConfigRequest: () => tui?.openConfig(),
    onDoctorRequest: (doctor) => tui?.openDoctor(doctor),
    onResumeRequest: (meta) => tui?.openResume(meta),
    onResearchRequest: snapshot => tui?.openResearch(snapshot),
    onPortfolioRequest: () => tui?.openPortfolio(),
    onArtifactRequest: () => tui?.openArtifact(),
    onArtifactCwd: cwd => tui?.setArtifactCwd(cwd),
    onHelpRequest: () => tui?.openHelp(),
    onSessionRequest: (meta) => tui?.syncCurrentSessionMeta(meta),
    onPanel: (panel, panelLoading = false) => tui?.update({ panel, panelLoading }),
    onHud: (hud) => tui?.update({ hud }),
    onModel: (model) => tui?.update(model),
    onSkillsChanged: () => { void tui?.refreshSkills(() => runtime.getSkillSuggestions()); },
  }, undefined, undefined, { host: connection });

  tui = new QuantTui(initial, loadSettings().keybindings);
  tui.setArtifactCwd(null);
  tui.setReferenceProvider(input => runtime.getReferenceSuggestions(input));
  tui.onResearchInterrupt(() => { void runtime.interruptResearch(); });
  tui.onRecoveryConfirm(target => runtime.acknowledgeRecovery(target));
  tui.onFailedQuotesRetry(() => { void runtime.retryFailedOverviewQuotes(); });
  tui.onDoctorClose(() => runtime.cancelDoctor());
  tui.onConfigurationChange(() => runtime.refreshConfiguration());
  tui.start();

  try {
    const snapshot = await runtime.bootstrap();
    await tui.refreshSkills(() => runtime.getSkillSuggestions());
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
      await runtime.shutdown();
      tui!.stop();
      process.exit(0);
    }
  });


  tui.onArtifactRestore((reportId) => {
    void runtime.restoreArtifact(reportId);
  });
  tui.onPrivateAnnualExport((request) => {
    void runtime.exportPrivateAnnual(request);
  });

  tui.onPanelRefresh(() => {
    void runtime.refreshOverviewPanel();
  });

  process.once("exit", () => {
    runtime.dispose();
    tui?.stop();
  });
}
