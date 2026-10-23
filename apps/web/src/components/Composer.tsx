import { useRef, useState } from "react";

interface ComposerProps {
  readonly running: boolean;
  readonly status: string;
  readonly onSubmit: (text: string) => void;
  readonly onCancel: () => void;
}

const MAX_HEIGHT = 120;

export function Composer({ running, status, onSubmit, onCancel }: ComposerProps) {
  const [value, setValue] = useState("");
  const input = useRef<HTMLTextAreaElement>(null);

  const resize = (element: HTMLTextAreaElement) => {
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, MAX_HEIGHT)}px`;
  };

  const submit = () => {
    const text = value.trim();
    if (text.length === 0) return;
    onSubmit(text);
    setValue("");
    if (input.current) {
      input.current.style.height = "auto";
      input.current.focus();
    }
  };

  return (
    <div className="composer">
      <div className="composer__box">
        <div className="composer__row">
          <span className="composer__prompt" aria-hidden="true">
            ›
          </span>
          <textarea
            ref={input}
            className="composer__input"
            value={value}
            rows={1}
            placeholder="输入研究问题 · /config 配置 · /artifact 报告"
            onChange={event => {
              setValue(event.target.value);
              resize(event.target);
            }}
            onKeyDown={event => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                submit();
              }
            }}
          />
        </div>

        <div className="composer__strip">
          <span className="composer__keys">
            <kbd>Enter</kbd> 发送 · <kbd>Shift</kbd>+<kbd>Enter</kbd> 换行
          </span>
          <span className="composer__status">{status}</span>
          {running ? (
            <button type="button" className="composer__send" onClick={onCancel} aria-label="停止">
              ■
            </button>
          ) : (
            <button
              type="button"
              className="composer__send"
              disabled={value.trim().length === 0}
              onClick={submit}
              aria-label="发送"
            >
              ↑
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
