import type { WorkspaceSummary } from "../contract.ts";

interface RailProps {
  readonly workspaces: readonly WorkspaceSummary[];
  readonly activeId: string | null;
  readonly onSelect: (workspaceId: string) => void;
  readonly onNew: () => void;
  readonly onFeedback: () => void;
  readonly onSettings: () => void;
}

interface IconButtonProps {
  readonly label: string;
  readonly onClick?: () => void;
  readonly href?: string;
  readonly children: React.ReactNode;
}

function IconButton({ label, onClick, href, children }: IconButtonProps) {
  const body = (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">
      {children}
    </svg>
  );

  if (href) {
    return (
      <a className="rail__icon" href={href} target="_blank" rel="noreferrer" aria-label={label} title={label}>
        {body}
      </a>
    );
  }

  return (
    <button type="button" className="rail__icon" onClick={onClick} aria-label={label} title={label}>
      {body}
    </button>
  );
}

export function Rail({ workspaces, activeId, onSelect, onNew, onFeedback, onSettings }: RailProps) {
  return (
    <aside className="rail">
      <div className="rail__brand">
        <span className="rail__mark">JQ</span>
        <span className="rail__name">WhyJ Quant</span>
        <span className="rail__version">0.1.0</span>
      </div>

      <button type="button" className="rail__new" onClick={onNew}>
        + 新建研究
      </button>

      <div>
        <div className="label">研究项目 · {workspaces.length}</div>
        <ul className="rail__list">
          {workspaces.map(workspace => (
            <li key={workspace.workspaceId}>
              <button
                type="button"
                className="rail__item"
                data-active={workspace.workspaceId === activeId}
                onClick={() => onSelect(workspace.workspaceId)}
              >
                <span className="rail__item-code">{workspace.code}</span>
                <span>{workspace.name}</span>
                <span className="rail__item-count">{workspace.runCount}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="rail__foot">
        <IconButton label="文档" href="https://github.com/yangjingo/oh-my-quant/tree/main/docs">
          <path d="M6 4h8l4 4v12H6z" />
          <path d="M14 4v4h4" />
        </IconButton>
        <IconButton label="意见反馈" onClick={onFeedback}>
          <path d="M4 6h16v10H9l-5 4z" />
        </IconButton>
        <IconButton label="设置" onClick={onSettings}>
          <path d="M3 8h18M3 16h18" />
          <circle cx="9" cy="8" r="2.4" />
          <circle cx="15" cy="16" r="2.4" />
        </IconButton>
      </div>
    </aside>
  );
}
