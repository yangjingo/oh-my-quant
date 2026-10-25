export function Icon({ name }: { name: string }) {
  return <svg className="ui-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><use href={"assets/lucide.svg#" + name} /></svg>;
}
export function IconButton({ name, label, onClick }: { name: string; label: string; onClick(): void }) {
  return <button type="button" className="icon-button" aria-label={label} title={label} onClick={onClick}><Icon name={name} /></button>;
}
