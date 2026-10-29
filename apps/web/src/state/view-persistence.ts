export type ViewStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** Only selection and unsent text live here; never execution state or credentials. */
export function browserViewStorage(): ViewStorage | undefined {
  if (typeof window === "undefined") return;
  return {
    getItem: key => window.localStorage.getItem(key),
    setItem: (key, value) => window.localStorage.setItem(key, value),
    removeItem: key => window.localStorage.removeItem(key),
  };
}
export const selectionKey = (workspace: string) => "whyj:view:1:selected:" + JSON.stringify(workspace);
export const draftKey = (workspace: string, session: string) => "whyj:view:1:draft:" + JSON.stringify([workspace, session]);
