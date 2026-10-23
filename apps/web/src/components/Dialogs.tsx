import { useEffect, useRef, useState } from "react";

export type DialogName = "settings" | "feedback" | null;

interface ModalProps {
  readonly title: string;
  readonly children: React.ReactNode;
  readonly onClose: () => void;
}

function Modal({ title, children, onClose }: ModalProps) {
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    // Move focus into the panel so Escape and Tab do not stay on the rail.
    panel.current?.querySelector<HTMLElement>("input, textarea, select, button")?.focus();
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="scrim" onMouseDown={event => event.target === event.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label={title} ref={panel}>
        <header className="dialog__head">
          <span>{title}</span>
          <button type="button" className="dialog__close" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </header>
        <div className="dialog__body">{children}</div>
      </div>
    </div>
  );
}

export interface ModelConfig {
  readonly provider: string;
  readonly model: string;
  readonly baseUrl: string;
}

const STORAGE_KEY = "whyj.model-config";

function readStored(): ModelConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { provider: "", model: "", baseUrl: "" };
    const parsed = JSON.parse(raw) as Partial<ModelConfig>;
    return {
      provider: parsed.provider ?? "",
      model: parsed.model ?? "",
      baseUrl: parsed.baseUrl ?? "",
    };
  } catch {
    return { provider: "", model: "", baseUrl: "" };
  }
}

interface SettingsDialogProps {
  readonly onClose: () => void;
}

export function SettingsDialog({ onClose }: SettingsDialogProps) {
  const [config, setConfig] = useState<ModelConfig>(readStored);
  const [apiKey, setApiKey] = useState("");
  const [saved, setSaved] = useState(false);

  const save = () => {
    try {
      // The key is deliberately not persisted: this page has no Host to hand it
      // to, and a browser-stored credential outlives the reason it was entered.
      localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    } catch {
      // Private mode and disabled storage are not worth an error banner here.
    }
    setSaved(true);
  };

  return (
    <Modal title="设置" onClose={onClose}>
      <p className="dialog__note">
        Host 尚未接入（#46、#75）。这里保存的配置只会留在本机浏览器，暂时不参与任何请求，提交研究仍由
        fixture 响应。
      </p>

      <label className="field">
        <span className="field__label">提供方</span>
        <select
          className="field__input"
          value={config.provider}
          onChange={event => {
            setConfig({ ...config, provider: event.target.value });
            setSaved(false);
          }}
        >
          <option value="">未配置</option>
          <option value="deepseek">DeepSeek</option>
          <option value="openai-compatible">OpenAI 兼容</option>
        </select>
      </label>

      <label className="field">
        <span className="field__label">模型 ID</span>
        <input
          className="field__input"
          value={config.model}
          placeholder="例如 deepseek-chat"
          onChange={event => {
            setConfig({ ...config, model: event.target.value });
            setSaved(false);
          }}
        />
      </label>

      <label className="field">
        <span className="field__label">Base URL</span>
        <input
          className="field__input"
          value={config.baseUrl}
          placeholder="留空使用提供方默认地址"
          onChange={event => {
            setConfig({ ...config, baseUrl: event.target.value });
            setSaved(false);
          }}
        />
      </label>

      <label className="field">
        <span className="field__label">API Key</span>
        <input
          className="field__input"
          type="password"
          value={apiKey}
          placeholder="不保存，关闭后清空"
          autoComplete="off"
          onChange={event => {
            setApiKey(event.target.value);
            setSaved(false);
          }}
        />
      </label>

      <footer className="dialog__foot">
        <span className="dialog__hint">{saved ? "已保存到本机浏览器（不含 API Key）" : ""}</span>
        <button type="button" className="dialog__primary" onClick={save}>
          保存
        </button>
      </footer>
    </Modal>
  );
}

const CATEGORIES = [
  { value: "bug", label: "缺陷" },
  { value: "idea", label: "建议" },
  { value: "other", label: "其他" },
] as const;

interface FeedbackDialogProps {
  readonly onClose: () => void;
}

export function FeedbackDialog({ onClose }: FeedbackDialogProps) {
  const [category, setCategory] = useState<string>("bug");
  const [text, setText] = useState("");
  const [copied, setCopied] = useState(false);

  const body = `类别：${category}\n\n${text}\n\n---\n版本：v1.4.0 · web workbench 骨架`;

  const issueUrl = `https://github.com/yangjingo/oh-my-quant/issues/new?title=${encodeURIComponent(
    `[feedback] ${text.split("\n")[0]?.slice(0, 60) ?? ""}`,
  )}&body=${encodeURIComponent(body)}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(body);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Modal title="意见反馈" onClose={onClose}>
      <p className="dialog__note">
        这个页面没有后端，不会自动提交。可以复制内容，或直接打开一个预填好的 GitHub issue。
      </p>

      <label className="field">
        <span className="field__label">类别</span>
        <select className="field__input" value={category} onChange={event => setCategory(event.target.value)}>
          {CATEGORIES.map(item => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        <span className="field__label">内容</span>
        <textarea
          className="field__input field__input--area"
          rows={6}
          value={text}
          placeholder="哪一步不对？期望是什么？"
          onChange={event => setText(event.target.value)}
        />
      </label>

      <footer className="dialog__foot">
        <span className="dialog__hint">{copied ? "已复制到剪贴板" : ""}</span>
        <button type="button" className="dialog__secondary" onClick={() => void copy()}>
          复制
        </button>
        {text.trim().length === 0 ? (
          <span className="dialog__primary dialog__primary--off" aria-disabled="true">
            在 GitHub 打开
          </span>
        ) : (
          <a className="dialog__primary" href={issueUrl} target="_blank" rel="noreferrer">
            在 GitHub 打开
          </a>
        )}
      </footer>
    </Modal>
  );
}
