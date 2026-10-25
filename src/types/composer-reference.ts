export interface ComposerReferenceSuggestion {
  kind: "file" | "evidence" | "session";
  label: string;
  fill: string;
}
