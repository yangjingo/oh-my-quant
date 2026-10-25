import { version } from "../data/brand.js";
import { iconButton, setIconButton } from "./ui.js";

export function renderComposer() {
  return `<form autocomplete="off" class="composer" data-component="Composer" id="composer">
<div class="input-box" data-region="input-prompt">
<div class="input-tools"><span aria-hidden="true" class="prompt">›</span></div>
<div class="editor-wrap" data-region="editor"><div aria-hidden="true" class="input-mirror" id="inputMirror"></div><textarea aria-autocomplete="list" aria-controls="suggestionList" aria-describedby="inputHelp" aria-expanded="false" aria-haspopup="listbox" aria-label="研究问题" id="input" placeholder="继续提问 · / 命令 · @ 引用" role="combobox" rows="1" spellcheck="false" title="Enter 发送 · Shift + Enter 换行"></textarea></div>
<div class="composer-actions" data-region="actions">${iconButton({ id: "send", name: "arrow-up", label: "发送问题", type: "submit", className: "send-button" })}</div></div>
<section aria-label="输入候选" class="suggestion-panel" data-component="SuggestionPanel" hidden="" id="cmdMenu">
<div class="suggestion-header"><span class="symbol" id="suggestionSymbol">/</span><strong id="suggestionTitle">命令</strong><small id="suggestionScope">oh-my-quant · v${version}</small></div>
<div aria-label="引用类别" class="suggestion-tabs" hidden="" id="suggestionTabs"><button aria-pressed="true" data-category="all" type="button">全部</button><button aria-pressed="false" data-category="files" type="button">文件</button><button aria-pressed="false" data-category="sessions" type="button">历史研究</button></div>
<div aria-label="候选项" class="suggestion-list" id="suggestionList" role="listbox"></div>
<div class="suggestion-footer"><span><kbd>↑ ↓</kbd> 选择　<kbd>↵ / Tab</kbd> 确认　<kbd>Esc</kbd> 收起</span><span class="secondary-hint" id="suggestionAction">补全后 Enter 执行</span></div></section>
<div class="composer-feedback" hidden="" id="composerFeedback" role="status"></div><span class="sr-only" id="inputHelp">斜杠搜索命令，@ 引用上下文。方向键选择，Enter 或 Tab 确认，Escape 收起。Shift 加 Enter 换行。</span><span aria-live="polite" class="sr-only" id="composerLive" role="status"></span>
</form>`;
}

export function setSendState(running) {
  const button = document.querySelector("#send");
  setIconButton(button, {
    name: running ? "square" : "arrow-up",
    label: running ? "停止生成" : "发送问题",
  });
  button.title = running ? "停止生成" : "发送问题 · Enter";
  button.dataset.state = running ? "running" : "idle";
}
