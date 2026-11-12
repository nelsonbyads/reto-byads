import { ClipboardList, RefreshCw } from "lucide-react";
import { useState } from "react";
import { backend } from "../../lib/backend";
import { AdminEmptyState, AdminFilterBar, AdminLoadingState, AdminRowActions, AdminStatusBadge } from "../components/AdminVisual";
import { AdminShell, type Row, date, useRpc } from "./shared";

export function Requests() {
  const [filter, setFilter] = useState("");
  const q = useRpc("admin_list_support_requests", { p_status: filter || null });
  const update = async (r: Row, status: string) => {
    if (!backend) return;
    const notes = window.prompt("Nota administrativa (opcional):") || null;
    const { error } = await backend.rpc("admin_update_support_request", {
      p_request_id: r.id,
      p_status: status,
      p_admin_notes: notes,
    });
    if (error) alert(error.message);
    else void q.load();
  };
  return (
    <AdminShell
      title="Solicitudes"
      subtitle="Soporte, pauta, alianzas y requerimientos recibidos desde Contáctanos."
    >
      <AdminFilterBar>
        <select aria-label="Filtrar solicitudes por estado" value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="">Todos</option>
          <option value="new">Nuevos</option>
          <option value="reviewing">En revisión</option>
          <option value="in_progress">En proceso</option>
          <option value="responded">Respondidos</option>
          <option value="closed">Cerrados</option>
        </select>
        <button className="admin-filter-spacer-v14" onClick={() => void q.load()}><RefreshCw size={14}/> Actualizar</button>
      </AdminFilterBar>
      {q.error && <div className="auth-error">{q.error}</div>}
      {q.loading && <AdminLoadingState rows={3}/>}
      {!q.loading && !q.error && (q.data ?? []).length === 0 && (
        <AdminEmptyState icon={<ClipboardList size={22}/>} title="No hay solicitudes en este estado" description="Los mensajes enviados desde Contáctanos, pauta, soporte y alianzas aparecerán aquí."/>
      )}
      <section className="admin-request-list-v14">
        {(q.data ?? []).map((r: Row) => (
          <article key={r.id}>
            <header>
              <div>
                <span className="eyebrow">{r.request_type}</span>
                <h3>{r.subject}</h3>
                <p>
                  {r.name} · {r.email}
                  {r.company ? ` · ${r.company}` : ""}
                </p>
              </div>
              <AdminStatusBadge status={r.status}/>
            </header>
            <p>{r.message}</p>
            {r.admin_notes && <blockquote>{r.admin_notes}</blockquote>}
            <footer>
              <small>{date(r.created_at)}</small>
              <AdminRowActions primary={r.status === "new" ? { label: "Revisar", onClick: () => void update(r, "reviewing") } : undefined} actions={[{ label: "En proceso", onClick: () => void update(r, "in_progress") }, { label: "Respondido", onClick: () => void update(r, "responded") }, { label: "Cerrar", danger: true, onClick: () => void update(r, "closed") }]}/>
            </footer>
          </article>
        ))}
      </section>
    </AdminShell>
  );
}
