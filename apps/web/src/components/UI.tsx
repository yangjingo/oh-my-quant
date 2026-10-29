import { useEffect, useRef } from "react";
import type { ReactNode } from "react";

export function Icon({ name }: { name: string }) {
  return <svg className="ui-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><use href={"assets/lucide.svg#" + name} /></svg>;
}
export function IconButton({ name, label, onClick }: { name: string; label: string; onClick(): void }) {
  return <button type="button" className="icon-button" aria-label={label} title={label} onClick={onClick}><Icon name={name} /></button>;
}
export function Dialog({ title, onClose, children, className = "" }: { title: string; onClose(): void; children: ReactNode; className?: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const trigger = document.activeElement;
    const element = dialog.current!;
    element.showModal();
    return () => { element.close(); if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus(); };
  }, []);
  return <dialog id="modal" ref={dialog} className={"app-dialog " + className} aria-labelledby="modalTitle" onCancel={event => { event.preventDefault(); onClose(); }}>
    <header className="modal-header"><h2 id="modalTitle">{title}</h2><IconButton name="x" label="关闭窗口" onClick={onClose} /></header>{children}
  </dialog>;
}
