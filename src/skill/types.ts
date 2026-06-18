/** Skill entry for TUI suggestions and CLI listing. */
export interface SkillEntry {
  name: string;
  description: string;
  scope: "project" | "user";
}

/** Skill invocation state for conversation rendering. */
export interface SkillState {
  name: string;
  label: string;
  status: "running" | "done" | "error";
  startedAt: number;
}
