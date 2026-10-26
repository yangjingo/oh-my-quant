export interface TerminalSize { cols: number; rows: number }
export interface DesktopInfo { version: string; workspace: string }
export interface DesktopBridge {
  start(size: TerminalSize): Promise<DesktopInfo>;
  input(data: string): void;
  resize(size: TerminalSize): void;
  acknowledge(length: number): void;
  copy(text: string): Promise<void>;
  paste(): Promise<string>;
  openWorkspace(): Promise<string>;
  openLink(url: string): Promise<void>;
  onData(callback: (data: string) => void): () => void;
  onExit(callback: (code: number) => void): () => void;
}
declare global { interface Window { desktop: DesktopBridge } }
