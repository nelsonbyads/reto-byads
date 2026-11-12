import { Activity, BadgeCheck, Building2, ClipboardList, Coins, Megaphone, RefreshCw, ShieldCheck, Tag, UsersRound } from "lucide-react";
import { AdminLoadingState, AdminMetricCard } from "../components/AdminVisual";
import { AdminShell, fmt, useRpc } from "./shared";

export function Dashboard() {
  const q = useRpc("admin_dashboard_stats");
  const s = q.data ?? {};
  const cards = [
    ["Usuarios", s.users, UsersRound],
    ["Gyms", s.gyms, Building2],
    ["Marcas", s.brands, BadgeCheck],
    ["Marcas por verificar", s.pending_brands, ShieldCheck],
    ["Campañas", s.campaigns, Tag],
    ["Evidencias pendientes", s.pending_evidence, Activity],
    ["DadoCoins entregados", s.coins_granted, Coins],
    ["Solicitudes nuevas", s.new_requests, ClipboardList],
    ["Pautas activas", s.active_ads, Megaphone],
  ];
  return (
    <AdminShell
      title="Resumen general"
      subtitle="Estado operativo de toda la plataforma."
    >
      <button className="admin-refresh-v14" onClick={() => void q.load()}>
        <RefreshCw size={15} /> Actualizar
      </button>
      {q.error && <div className="auth-error">{q.error}</div>}
      {q.loading ? <AdminLoadingState rows={3}/> : <section className="admin-kpi-grid-v14">
        {cards.map(([label, value, Icon]: any) => <AdminMetricCard key={label} icon={<Icon size={20}/>} label={label} value={fmt(value)}/>)}
      </section>}
      <section className="admin-callouts-v14">
        <article>
          <span className="eyebrow">OPERACIÓN</span>
          <h2>{fmt(s.pending_evidence)} evidencias requieren atención</h2>
          <p>Incluye revisiones iniciales y auditorías pendientes.</p>
        </article>
        <article>
          <span className="eyebrow">COMERCIAL</span>
          <h2>{fmt(s.active_ads)} campañas de pauta activas</h2>
          <p>Inventario configurable en 6 espacios desktop + 1 mobile.</p>
        </article>
      </section>
    </AdminShell>
  );
}
