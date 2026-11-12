import { Activity, FileSearch, RefreshCw, Search } from "lucide-react";
import { useState } from "react";
import { AdminEmptyState, AdminFilterBar, AdminLoadingState } from "../components/AdminVisual";
import { AdminShell, type Row, date, useRpc } from "./shared";

export function Audit() {
  const platform = useRpc("admin_list_audit", { p_limit: 200 });
  const reviews = useRpc("admin_list_challenge_reviews", { p_limit: 150 });
  const [search, setSearch] = useState("");
  const matches = (row: Row) => !search || JSON.stringify(row).toLowerCase().includes(search.toLowerCase());
  const platformRows = ((platform.data ?? []) as Row[]).filter(matches);
  const reviewRows = ((reviews.data ?? []) as Row[]).filter(matches);
  return (
    <AdminShell
      title="Auditoría global"
      subtitle="Trazabilidad de decisiones administrativas y revisiones de evidencias."
    >
      <AdminFilterBar><Search size={16}/><input aria-label="Buscar en auditoría" placeholder="Evento, entidad, usuario o referencia" value={search} onChange={(event) => setSearch(event.target.value)}/><button className="admin-filter-spacer-v14" onClick={() => { void platform.load(); void reviews.load(); }}><RefreshCw size={14}/> Actualizar</button></AdminFilterBar>
      {(platform.error || reviews.error) && <div className="auth-error">{platform.error || reviews.error}</div>}
      <section className="admin-audit-grid-v14">
        <div className="admin-card-v14">
          <span className="eyebrow">ADMINISTRACIÓN</span>
          <h2>Acciones SuperAdmin</h2>
          {platform.loading ? <AdminLoadingState rows={5}/> : platformRows.length === 0 ? <AdminEmptyState icon={<FileSearch size={22}/>} title="Sin acciones administrativas" description="No hay eventos que coincidan con la búsqueda."/> : <div className="admin-timeline-v14">
            {platformRows.map((r: Row) => (
              <article key={r.id}>
                <span>{date(r.created_at)}</span>
                <strong>{r.action}</strong>
                <p>
                  {r.entity_type} · {r.entity_id || "—"}
                </p>
              </article>
            ))}
          </div>}
        </div>
        <div className="admin-card-v14">
          <span className="eyebrow">EVIDENCIAS</span>
          <h2>Revisiones globales</h2>
          {reviews.loading ? <AdminLoadingState rows={5}/> : reviewRows.length === 0 ? <AdminEmptyState icon={<Activity size={22}/>} title="Sin revisiones de evidencia" description="No hay revisiones que coincidan con la búsqueda."/> : <div className="admin-timeline-v14">
            {reviewRows.map((r: Row) => (
              <article key={r.review_id}>
                <span>{date(r.created_at)}</span>
                <strong>
                  {r.participant_name} · {r.decision}
                </strong>
                <p>
                  {r.review_stage} · {r.reviewer_name} · {r.exercise_name}
                  {r.organization_name ? ` · ${r.organization_name}` : ""}
                </p>
              </article>
            ))}
          </div>}
        </div>
      </section>
    </AdminShell>
  );
}
