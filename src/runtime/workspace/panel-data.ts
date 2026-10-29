import { editPortfolio, type PortfolioEdit } from "../research/portfolio.ts";
import {
  hasWhyjEnvValue,
  artifactReference,
  listStoredSessions,
  loadPanelPortfolio,
  loadSettings,
  saveSettings,
  stripTerminalControlCodes,
  type ArtifactMeta,
  type PanelPortfolioFile,
  type StoredSessionContextUsage,
  type StoredSessionSummary,
  type WhyjEnvAliasKey,
} from "../../storage/index.ts";
import { listRestorableArtifactReports } from "../research/artifact-reports.ts";
import type { OhQuantSettings } from "../../types/config.ts";

export type { PanelPortfolioFile, PortfolioEdit };
export { artifactReference };

export type {
  ArtifactMeta,
  StoredSessionContextUsage,
  StoredSessionSummary,
  WhyjEnvAliasKey,
};

export type PanelSessionScope = "cwd" | "all";
export type PanelSessionSort = "updated" | "created";

export interface PanelDataService {
  cwd(): string;
  loadSettings(): OhQuantSettings;
  saveSettings(settings: OhQuantSettings): void;
  listStoredSessions(options: {
    cwd: string;
    limit: number;
    scope: PanelSessionScope;
    sort: PanelSessionSort;
  }): StoredSessionSummary[];
  listArtifacts(cwd?: string): ArtifactMeta[];
  loadPanelPortfolio(): PanelPortfolioFile;
  editPortfolio(edit: PortfolioEdit): PanelPortfolioFile;
  hasWhyjEnvValue(env: Record<string, string | undefined>, key: WhyjEnvAliasKey): boolean;
  stripTerminalControlCodes(value: string): string;
}

export function createStoragePanelDataService(): PanelDataService {
  return {
    cwd: () => process.cwd(),
    loadSettings,
    saveSettings,
    listStoredSessions,
    listArtifacts: listRestorableArtifactReports,
    loadPanelPortfolio,
    editPortfolio,
    hasWhyjEnvValue,
    stripTerminalControlCodes,
  };
}
