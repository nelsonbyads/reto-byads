import { RefreshCw, Search, UsersRound } from "lucide-react";
import { useState } from "react";
import { backend } from "../../lib/backend";
import { AdminEmptyState, AdminFilterBar, AdminRowActions, AdminStatusBadge, AdminTable, AdminTruncate } from "../components/AdminVisual";
import { AdminShell, type Row, date, fmt, useRpc } from "./shared";

export function Users() {
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const q = useRpc("admin_list_users", { p_search: query || null });
  const change = async (row: Row) => {
    if (!backend) return;
    const next = row.platform_status === "suspended" ? "active" : "suspended";
    const reason =
      next === "suspended"
        ? window.prompt("Motivo de suspensión:")
        : "Reactivación desde Backoffice";
    if (next === "suspended" && !reason) return;
    const { error } = await backend.rpc("admin_set_user_status", {
      p_user_id: row.user_id,
      p_status: next,
      p_reason: reason,
    });
    if (error) alert(error.message);
    else void q.load();
  };
  return (
    <AdminShell
      title="Usuarios"
      subtitle="Consulta identidad, progreso, DadoCoins y estado de acceso."
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setQuery(search);
        }}
      >
        <AdminFilterBar><Search size={16} />
        <input aria-label="Buscar usuarios"
          placeholder="Email, username, nombre o UUID"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button className="admin-primary-v14">Buscar</button>
        <button type="button" className="admin-filter-spacer-v14" onClick={() => void q.load()}><RefreshCw size={14}/> Actualizar</button></AdminFilterBar>
      </form>
      {q.error && <div className="auth-error">{q.error}</div>}
      <AdminTable loading={q.loading} empty={!q.error && (q.data ?? []).length === 0 ? <AdminEmptyState icon={<UsersRound size={22}/>} title="No hay usuarios" description="Ajusta la búsqueda o vuelve a actualizar el listado."/> : undefined}>
        <table>
          <thead>
            <tr>
              <th scope="col">Usuario</th>
              <th scope="col">Estado</th>
              <th scope="col">XP / Nivel</th>
              <th scope="col">DadoCoins</th>
              <th scope="col">Ecosistema</th>
              <th scope="col">Registro</th>
              <th scope="col"><span className="sr-only">Acciones</span></th>
            </tr>
          </thead>
          <tbody>
            {(q.data ?? []).map((r: Row) => (
              <tr key={r.user_id}>
                <td>
                  <strong>{r.display_name || r.username || "Gymbro"}</strong>
                  <small>
                    <AdminTruncate value={r.email} />
                    <br />@{r.username || "—"}
                  </small>
                </td>
                <td>
                  <AdminStatusBadge status={r.platform_status}/>
                </td>
                <td>
                  {fmt(r.xp)} XP · N{r.level}
                </td>
                <td>{fmt(r.dadocoins)} DC</td>
                <td>
                  {r.organizations} org · {r.squads} squads
                </td>
                <td>{date(r.created_at)}</td>
                <td>
                  <AdminRowActions actions={[{ label: r.platform_status === "suspended" ? "Reactivar" : "Suspender", danger: r.platform_status !== "suspended", onClick: () => void change(r) }]}/>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </AdminTable>
    </AdminShell>
  );
}
