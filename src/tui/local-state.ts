import { loadLocalModel } from "./local-snapshot.ts";

export interface LocalUiState {
  model: string;
}

export async function loadLocalUiState(): Promise<LocalUiState> {
  return {
    model: await loadLocalModel(),
  };
}
