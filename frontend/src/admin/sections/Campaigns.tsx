import { RefreshCw, Tag } from "lucide-react";
import { useState } from "react";
import { AdminEmptyState, AdminFilterBar, AdminStatusBadge, AdminTable } from "../components/AdminVisual";
import { AdminShell, type Row, fmt, useRpc } from "./shared";

export function Campaigns() {
  const q = useRpc("admin_list_campaigns");
  const [statusFilter, setStatusFilter] = useState("");
  const rows = ((q.data ?? []) as Row[]).filter((row) => !statusFilter || row.status === statusFilter);
  return (
    <AdminShell
      title="Campañas patrocinadas"
      subtitle="Histórico global de campañas, participación y recompensas."
    >
      <AdminFilterBar><select aria-label="Filtrar campañas por estado" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="">Todos los estados</option><option value="active">Activas</option><option value="paused">Pausadas</option><option value="completed">Completadas</option></select><button className="admin-filter-spacer-v14" onClick={() => void q.load()}><RefreshCw size={14}/> Actualizar</button></AdminFilterBar>
      {q.error && <div className="auth-error">{q.error}</div>}
      <AdminTable loading={q.loading} empty={!q.error && rows.length === 0 ? <AdminEmptyState icon={<Tag size={22}/>} title="No hay campañas disponibles" description="Cuando una Marca cree una campaña patrocinada aparecerá aquí con sus métricas globales."/> : undefined}>
        <table>
          <thead>
            <tr>
              <th scope="col">Marca / Campaña</th>
              <th scope="col">Estado</th>
              <th scope="col">Retos</th>
              <th scope="col">Participantes</th>
              <th scope="col">Aprobados / Rechazados</th>
              <th scope="col">Rewards</th>
              <th scope="col">Control</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r: Row) => (
              <tr key={r.campaign_id}>
                <td>
                  <strong>{r.organization_name}</strong>
                  <small>{r.campaign_name}</small>
                </td>
                <td>
                  <AdminStatusBadge status={r.status}/>
                </td>
                <td>{r.challenges}</td>
                <td>{r.participants}</td>
                <td>
                  {r.approved} / {r.rejected}
                </td>
                <td>
                  {fmt(r.coins_granted)} DC · {fmt(r.xp_granted)} XP
                </td>
                <td>
                  {r.requires_double_validation ? "Doble validación" : "Simple"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </AdminTable>
    </AdminShell>
  );
}
