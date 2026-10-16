import { MoreHorizontal } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

export function AdminPageHeader({ title, subtitle, actions }: { title: string; subtitle: string; actions?: ReactNode }) {
  return (
    <header className="admin-top-v14">
      <div>
        <span className="eyebrow">BACKOFFICE DADOFIT</span>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      {actions && <div className="admin-top-actions-v14">{actions}</div>}
    </header>
  );
}

export function AdminFilterBar({ children }: { children: ReactNode }) {
  return <div className="admin-filter-bar-v14" role="search">{children}</div>;
}

export function AdminTable({ children, loading = false, empty }: { children: ReactNode; loading?: boolean; empty?: ReactNode }) {
  if (loading) return <AdminLoadingState />;
  if (empty) return <>{empty}</>;
  return <div className="admin-table-wrap-v14">{children}</div>;
}

export function AdminStatusBadge({ status }: { status: string }) {
  return <span className={`admin-status-v14 ${status}`}>{status.replaceAll("_", " ")}</span>;
}

export function AdminMetricCard({ icon, label, value, helper }: { icon: ReactNode; label: string; value: ReactNode; helper?: string }) {
  return (
    <article className="admin-metric-card-v14">
      {icon}
      <span>{label}</span>
      <strong>{value}</strong>
      {helper && <small>{helper}</small>}
    </article>
  );
}

export function AdminEmptyState({ icon, title, description, action }: { icon?: ReactNode; title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="admin-empty-v142 admin-empty-state-v14" role="status">
      {icon}
      <strong>{title}</strong>
      {description && <span>{description}</span>}
      {action}
    </div>
  );
}

export function AdminLoadingState({ rows = 4 }: { rows?: number }) {
  return (
    <div className="admin-loading-v14" aria-busy="true" aria-label="Cargando contenido">
      {Array.from({ length: rows }, (_, index) => (
        <span key={index} />
      ))}
    </div>
  );
}

export interface AdminRowAction {
  label: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}

export function AdminRowActions({ primary, actions, label = "Acciones de fila" }: { primary?: AdminRowAction; actions: AdminRowAction[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, []);
  return (
    <div className="admin-row-actions-v14" ref={root}>
      {primary && (
        <button type="button" className="admin-primary-v14" disabled={primary.disabled} onClick={primary.onClick}>
          {primary.label}
        </button>
      )}
      {actions.length > 0 && (
        <>
          <button
            ref={trigger}
            type="button"
            aria-label={label}
            aria-expanded={open}
            aria-haspopup="menu"
            onClick={() => setOpen((value) => !value)}
          >
            <MoreHorizontal size={16} aria-hidden="true" />
          </button>
          {open && (
            <div className="admin-row-menu-v14" role="menu">
              {actions.map((action) => (
                <button
                  key={action.label}
                  type="button"
                  role="menuitem"
                  className={action.danger ? "danger" : ""}
                  disabled={action.disabled}
                  onClick={() => {
                    setOpen(false);
                    action.onClick();
                  }}
                >
                  {action.label}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function AdminTruncate({ value, max = 42 }: { value: string; max?: number }) {
  const text = value ?? "—";
  if (text.length <= max) return <span title={text}>{text}</span>;
  return (
    <span className="admin-cell-truncate-v14" title={text}>
      {text}
    </span>
  );
}
