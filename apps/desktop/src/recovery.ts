declare global { interface Window { desktopRecovery: { status(): Promise<{ message: string; busy: boolean }>; retry(): Promise<void> } } }
export {};
const message = document.getElementById("message")!, retry = document.getElementById("retry") as HTMLButtonElement;
async function refresh() { const state = await window.desktopRecovery.status(); message.textContent = state.message; retry.disabled = state.busy; }
retry.addEventListener("click", async () => { retry.disabled = true; await window.desktopRecovery.retry(); await refresh(); });
void refresh();
