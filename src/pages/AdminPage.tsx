import {
  Activity,
  BadgeCheck,
  BarChart3,
  Building2,
  CalendarDays,
  ChevronDown,
  ClipboardList,
  Coins,
  Download,
  Eye,
  FileSearch,
  Gift,
  LayoutDashboard,
  Megaphone,
  MousePointerClick,
  Pencil,
  RefreshCw,
  Search,
  ShieldCheck,
  Tag,
  Trophy,
  UserRound,
  UsersRound,
  Wallet,
  X,
} from "lucide-react";
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Link, NavLink, useLocation } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { supabase } from "../lib/supabase";
import {
  buildCsvContent,
  buildDateRange,
  buildReportFileName,
  buildSummaryData,
  buildTargetUrlById,
  formatCtrDisplay,
  selectRowsForScope,
  toCampaignExportRows,
  type AdAnalyticsSummary,
  type AdMetricRow,
  type AdsReportScopeSelector,
  type CampaignExportRow,
  type SummaryExportData,
} from "../lib/adsReportExport";
import {
  AdminEmptyState,
  AdminFilterBar,
  AdminLoadingState,
  AdminMetricCard,
  AdminPageHeader,
  AdminRowActions,
  AdminStatusBadge,
  AdminTable,
  AdminTruncate,
} from "../admin/components/AdminVisual";
import "../styles/v14-admin.css";
import "../styles/v14.5-ad-campaign-management.css";
import "../styles/admin-tokens.css";

type Row = Record<string, any>;
const SECTIONS = [
  ["/admin", "Dashboard", LayoutDashboard],
  ["/admin/users", "Usuarios", UsersRound],
  ["/admin/organizations", "Organizaciones", Building2],
  ["/admin/brands", "Marcas", BadgeCheck],
  ["/admin/campaigns", "Campañas", Tag],
  ["/admin/requests", "Solicitudes", ClipboardList],
  ["/admin/rewards", "Rewards", Coins],
  ["/admin/seasons", "Temporadas", Trophy],
  ["/admin/ads", "Publicidad", Megaphone],
  ["/admin/audit", "Auditoría", FileSearch],
] as const;
const fmt = (v: any) => Number(v ?? 0).toLocaleString("es-CO");
const date = (v: any) =>
  v
    ? new Intl.DateTimeFormat("es-CO", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(v))
    : "—";

function AdminShell({
  children,
  title,
  subtitle,
}: {
  children: ReactNode;
  title: string;
  subtitle: string;
}) {
  const { user, logout } = useAuth();
  return (
    <div className="admin-shell-v14">
      <aside className="admin-sidebar-v14">
        <Link to="/admin" className="admin-brand-v14">
          <span>⚄</span>
          <div>
            <strong>DadoFit Admin</strong>
            <small>SuperAdmin</small>
          </div>
        </Link>
        <nav>
          {SECTIONS.map(([to, label, Icon]) => (
            <NavLink
              key={to}
              end={to === "/admin"}
              to={to}
              className={({ isActive }) => (isActive ? "active" : "")}
            >
              <Icon size={17} />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="admin-sidebar-footer-v14">
          <strong>{user?.name}</strong>
          <small>{user?.email}</small>
          <Link to="/app">Volver a DadoFit</Link>
          <Link to="/contact">Formulario de contacto</Link>
          <button onClick={() => void logout()}>Cerrar sesión</button>
        </div>
      </aside>
      <main className="admin-main-v14">
        <AdminPageHeader title={title} subtitle={subtitle} />
        {children}
      </main>
    </div>
  );
}

function useRpc(name: string, args?: Record<string, unknown>) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    setError("");
    const res = await supabase.rpc(name, args ?? {});
    setLoading(false);
    if (res.error) {
      setError(res.error.message);
      return;
    }
    setData(res.data);
  }, [name, JSON.stringify(args ?? {})]);
  useEffect(() => {
    void load();
  }, [load]);
  return { data, loading, error, load };
}

function Dashboard() {
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

function Users() {
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const q = useRpc("admin_list_users", { p_search: query || null });
  const change = async (row: Row) => {
    if (!supabase) return;
    const next = row.platform_status === "suspended" ? "active" : "suspended";
    const reason =
      next === "suspended"
        ? window.prompt("Motivo de suspensión:")
        : "Reactivación desde Backoffice";
    if (next === "suspended" && !reason) return;
    const { error } = await supabase.rpc("admin_set_user_status", {
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

function Organizations({ brandsOnly = false }: { brandsOnly?: boolean }) {
  const q = useRpc("admin_list_organizations");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const rows = useMemo(
    () =>
      ((q.data ?? []) as Row[]).filter(
        (r) =>
          (!brandsOnly || ["brand", "sponsor", "company"].includes(r.organization_type)) &&
          (!statusFilter || r.verification_status === statusFilter) &&
          (!search || `${r.name} ${r.owner_name} ${r.owner_email}`.toLowerCase().includes(search.toLowerCase())),
      ),
    [q.data, brandsOnly, search, statusFilter],
  );
  const verify = async (r: Row, status: string) => {
    if (!supabase) return;
    const needsReason = status === "rejected" || status === "suspended";
    const reason = needsReason
      ? window.prompt(
          status === "rejected"
            ? "Motivo del rechazo:"
            : "Motivo de suspensión:",
        )
      : null;
    if (needsReason && !reason) return;
    const { error } = await supabase.rpc(
      "admin_set_organization_verification",
      {
        p_organization_id: r.organization_id,
        p_status: status,
        p_reason: reason,
      },
    );
    if (error) alert(error.message);
    else void q.load();
  };
  return (
    <AdminShell
      title={brandsOnly ? "Marcas" : "Organizaciones"}
      subtitle={
        brandsOnly
          ? "Verificación y control de Brands, Sponsors y empresas."
          : "Aprobación y control de Gyms, Marcas y organizaciones."
      }
    >
      <AdminFilterBar><Search size={16}/><input aria-label="Buscar organizaciones" placeholder="Nombre, owner o email" value={search} onChange={(event) => setSearch(event.target.value)}/><select aria-label="Filtrar por estado" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="">Todos los estados</option><option value="verified">Verificadas</option><option value="pending_verification">Pendientes</option><option value="suspended">Suspendidas</option><option value="rejected">Rechazadas</option></select><button className="admin-filter-spacer-v14" onClick={() => void q.load()}><RefreshCw size={14}/> Actualizar</button></AdminFilterBar>
      {q.error && <div className="auth-error">{q.error}</div>}
      <AdminTable loading={q.loading} empty={!q.error && rows.length === 0 ? <AdminEmptyState icon={<Building2 size={22}/>} title={brandsOnly ? "No hay marcas" : "No hay organizaciones"} description="No hay resultados para los filtros seleccionados."/> : undefined}>
        <table>
          <thead>
            <tr>
              <th scope="col">Organización</th>
              <th scope="col">Tipo</th>
              <th scope="col">Owner</th>
              <th scope="col">Miembros</th>
              <th scope="col">Estado</th>
              <th scope="col">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.organization_id}>
                <td>
                  <strong>{r.name}</strong>
                  <small>{date(r.created_at)}</small>
                </td>
                <td>{r.organization_type}</td>
                <td>
                  {r.owner_name}
                  <small><AdminTruncate value={r.owner_email} /></small>
                </td>
                <td>{r.members}</td>
                <td>
                  <AdminStatusBadge status={r.verification_status}/>
                </td>
                <td><AdminRowActions primary={r.verification_status !== "verified" ? { label: r.organization_type === "gym" ? "Aprobar" : "Verificar", onClick: () => void verify(r, "verified") } : undefined} actions={[
                  ...(r.verification_status !== "pending_verification" ? [{ label: "Marcar pendiente", onClick: () => void verify(r, "pending_verification") }] : []),
                  ...(r.verification_status !== "suspended" ? [{ label: "Suspender", danger: true, onClick: () => void verify(r, "suspended") }] : []),
                  ...(r.verification_status !== "rejected" ? [{ label: "Rechazar", danger: true, onClick: () => void verify(r, "rejected") }] : []),
                ]}/></td>
              </tr>
            ))}
          </tbody>
        </table>
      </AdminTable>
    </AdminShell>
  );
}

function Campaigns() {
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

function Requests() {
  const [filter, setFilter] = useState("");
  const q = useRpc("admin_list_support_requests", { p_status: filter || null });
  const update = async (r: Row, status: string) => {
    if (!supabase) return;
    const notes = window.prompt("Nota administrativa (opcional):") || null;
    const { error } = await supabase.rpc("admin_update_support_request", {
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

function RewardsAnalyticsAdmin() {
  const [days, setDays] = useState(30);
  const q = useRpc("admin_reward_analytics", { p_days: days });
  const bq = useRpc("admin_get_dc_budgets");
  const oq = useRpc("admin_list_organizations");
  const [budgetDc, setBudgetDc] = useState("1000");
  const [budgetOrg, setBudgetOrg] = useState("");
  const [internalBudget, setInternalBudget] = useState(false);
  const [budgetStart, setBudgetStart] = useState("");
  const [budgetEnd, setBudgetEnd] = useState("");
  const [budgetActing, setBudgetActing] = useState("");
  const [budgetError, setBudgetError] = useState("");
  const [budgetMessage, setBudgetMessage] = useState("");
  const summary = q.data?.summary ?? {};
  const providers = (q.data?.providers ?? []) as Row[];
  const topRewards = (q.data?.top_rewards ?? []) as Row[];
  const trend = (q.data?.trend ?? []) as Row[];
  const maxTrend = useMemo(
    () => Math.max(1, ...trend.map((r: Row) => Number(r.redemptions ?? 0))),
    [trend],
  );
  const shortDay = (v: any) =>
    v
      ? new Intl.DateTimeFormat("es-CO", {
          day: "2-digit",
          month: "short",
        }).format(new Date(v))
      : "—";
  const createBudget = async (event: FormEvent) => {
    event.preventDefault();
    if (!supabase || (!internalBudget && !budgetOrg)) return;
    setBudgetActing("create");
    setBudgetError("");
    setBudgetMessage("");
    const { error } = await supabase.rpc("superadmin_create_dc_budget", {
      p_budget_dc: Number(budgetDc),
      p_organization_id: internalBudget ? null : budgetOrg,
      p_sponsor_campaign_id: null,
      p_season_id: null,
      p_is_dadofit_internal: internalBudget,
      p_starts_at: budgetStart ? new Date(budgetStart).toISOString() : null,
      p_ends_at: budgetEnd ? new Date(budgetEnd).toISOString() : null,
    });
    setBudgetActing("");
    if (error) setBudgetError(error.message);
    else {
      setBudgetMessage("Budget creado en borrador. Debe aprobarse para emitir DC.");
      await bq.load();
    }
  };
  const setBudgetStatus = async (id: string, action: "approve" | "pause" | "resume" | "cancel") => {
    if (!supabase) return;
    setBudgetActing(`${action}:${id}`);
    setBudgetError("");
    const rpc = {
      approve: "superadmin_approve_dc_budget",
      pause: "superadmin_pause_dc_budget",
      resume: "superadmin_resume_dc_budget",
      cancel: "superadmin_cancel_dc_budget",
    }[action];
    const { error } = await supabase.rpc(rpc, { p_budget_id: id });
    setBudgetActing("");
    if (error) setBudgetError(error.message);
    else await bq.load();
  };
  return (
    <AdminShell
      title="Rewards Analytics"
      subtitle="Economía de DadoCoins, canjes, partners y salud del inventario de premios."
    >
      <div className="admin-rewards-view-v1582">
        <div className="admin-reward-toolbar-v154">
          <div>
            <button
              className={days === 7 ? "active" : ""}
              onClick={() => setDays(7)}
            >
              7 días
            </button>
            <button
              className={days === 30 ? "active" : ""}
              onClick={() => setDays(30)}
            >
              30 días
            </button>
            <button
              className={days === 90 ? "active" : ""}
              onClick={() => setDays(90)}
            >
              90 días
            </button>
          </div>
          <button className="admin-refresh-v14" onClick={() => void q.load()}>
            <RefreshCw size={15} /> Actualizar
          </button>
        </div>
        {q.error && <div className="auth-error">{q.error}</div>}

        <section className="admin-rewards-section-v1582">
          <header className="admin-rewards-section-head-v1582">
            <span className="eyebrow">RESUMEN ECONÓMICO</span>
            <h2>Economía de DadoCoins</h2>
            <p>
              Emisión, consumo y saldo vivo de DC dentro del ecosistema en el
              periodo seleccionado.
            </p>
          </header>
          <div className="admin-reward-economy-v154">
            <article>
              <div className="admin-reward-economy-head-v1582">
                <Coins size={18} />
                <span>DC emitidos</span>
              </div>
              <strong>{fmt(summary.dc_issued)}</strong>
              <small>Créditos positivos del ledger en el periodo</small>
            </article>
            <article>
              <div className="admin-reward-economy-head-v1582">
                <Gift size={18} />
                <span>DC consumidos en Rewards</span>
              </div>
              <strong>{fmt(summary.dc_consumed)}</strong>
              <small>DadoCoins usados en canjes del periodo</small>
            </article>
            <article>
              <div className="admin-reward-economy-head-v1582">
                <Wallet size={18} />
                <span>DC en circulación</span>
              </div>
              <strong>{fmt(summary.dc_circulation)}</strong>
              <small>Saldo actual agregado de wallets</small>
            </article>
          </div>
          <div className="admin-reward-note-v154">
            “DC en circulación” es la suma de saldos actuales de wallets dentro
            del ecosistema DadoFit; no representa dinero, cash-out ni una
            valoración monetaria.
          </div>
        </section>

        <section className="admin-rewards-section-v1582">
          <header className="admin-rewards-section-head-v1582">
            <span className="eyebrow">OPERACIÓN</span>
            <h2>Operación de rewards</h2>
            <p>
              Canjes, entregas e inventario de partners para el seguimiento
              operativo diario.
            </p>
          </header>
          <div className="admin-kpi-grid-v14 admin-reward-kpis-v154">
            {[
              ["Canjes", summary.redemptions, Gift],
              ["Gymbros únicos", summary.unique_users, UsersRound],
              ["Entregados", summary.redeemed, BadgeCheck],
              ["Pendientes entrega", summary.pending_delivery, Activity],
              ["Ofertas activas", summary.active_rewards, Tag],
              ["Partners con Rewards", summary.providers, Building2],
              ["Stock bajo", summary.low_stock_offers, Activity],
            ].map(([label, value, Icon]: any) => (
              <article key={label}>
                <Icon size={16} />
                <span>{label}</span>
                <strong>{fmt(value)}</strong>
              </article>
            ))}
          </div>
        </section>

        <section className="admin-card-v14 reward-trend-card-v154">
          <header>
            <div>
              <span className="eyebrow">TENDENCIA</span>
              <h2>Canjes diarios</h2>
            </div>
            <small>Últimos {days} días</small>
          </header>
          {trend.every((row: Row) => Number(row.redemptions ?? 0) === 0) ? (
            <div className="reward-analytics-empty-v154">
              Sin canjes en este periodo.
            </div>
          ) : (
            <div className="reward-trend-v154">
              {trend.map((row: Row) => (
                <div
                  key={String(row.day)}
                  className="reward-trend-column-v154"
                  title={`${shortDay(row.day)} · ${fmt(row.redemptions)} canjes · ${fmt(row.dc_consumed)} DC consumidos · ${fmt(row.dc_issued)} DC emitidos`}
                >
                  <div className="reward-trend-bar-wrap-v154">
                    <div
                      className="reward-trend-bar-v154"
                      style={{
                        height: `${Math.max(4, (Number(row.redemptions ?? 0) / maxTrend) * 100)}%`,
                      }}
                    />
                  </div>
                  <span>{shortDay(row.day)}</span>
                </div>
              ))}
            </div>
          )}
        </section>
        <section className="admin-card-v14">
          <div className="admin-rewards-card-head-v1582">
            <span className="eyebrow">PARTNERS</span>
            <h2>Rendimiento por organización</h2>
          </div>
        {providers.length === 0 ? (
          <AdminEmptyState icon={<Coins size={22}/>} title="No hay partners con Rewards." description="Cuando un partner publique ofertas de canje aparecerán aquí."/>
        ) : (
          <div className="admin-table-wrap-v14">
            <table>
              <thead>
                <tr>
                  <th scope="col">Partner</th>
                  <th scope="col">Tipo</th>
                  <th scope="col">Ofertas activas</th>
                  <th scope="col">Canjes</th>
                  <th scope="col">Usuarios</th>
                  <th scope="col">DC consumidos</th>
                  <th scope="col">Stock bajo</th>
                </tr>
              </thead>
              <tbody>
                {providers.map((r: Row) => (
                  <tr key={r.organization_id}>
                    <td>
                      <strong>{r.organization_name}</strong>
                    </td>
                    <td>{r.organization_type}</td>
                    <td>{fmt(r.active_rewards)}</td>
                    <td>{fmt(r.redemptions)}</td>
                    <td>{fmt(r.unique_users)}</td>
                    <td>{fmt(r.dc_consumed)} DC</td>
                    <td>{fmt(r.low_stock)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        </section>
        <section className="admin-card-v14">
          <div className="admin-rewards-card-head-v1582">
            <span className="eyebrow">DC BUDGETS</span>
            <h2>Presupuestos DadoCoins</h2>
          </div>
          <form className="admin-season-form-v157" onSubmit={(event) => void createBudget(event)}>
            <label className="admin-rewards-budget-flag-v1582"><input type="checkbox" checked={internalBudget} onChange={(event) => setInternalBudget(event.target.checked)}/> Budget interno DadoFit</label>
            {!internalBudget && <label>Partner<select required value={budgetOrg} onChange={(event) => setBudgetOrg(event.target.value)}><option value="">Seleccionar organización</option>{(oq.data ?? []).map((org: Row) => <option key={org.id} value={org.id}>{org.name} · {org.organization_type}</option>)}</select></label>}
            <label>Budget total DC<input type="number" required min="1" step="1" value={budgetDc} onChange={(event) => setBudgetDc(event.target.value)}/></label>
            <label>Inicio<input type="datetime-local" value={budgetStart} onChange={(event) => setBudgetStart(event.target.value)}/></label>
            <label>Fin<input type="datetime-local" value={budgetEnd} onChange={(event) => setBudgetEnd(event.target.value)}/></label>
            <button type="submit" disabled={Boolean(budgetActing)}>Crear budget</button>
          </form>
          {budgetError && <div className="auth-error">{budgetError}</div>}
          {budgetMessage && <div className="auth-success">{budgetMessage}</div>}
          {bq.error ? (
            <div className="auth-error">{bq.error}</div>
          ) : (
            <div className="admin-table-wrap-v14">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Partner / Campaña</th>
                    <th scope="col">Budget</th>
                    <th scope="col">Usado</th>
                    <th scope="col">Restante</th>
                    <th scope="col">Uso</th>
                    <th scope="col">Estado</th>
                    <th scope="col">Vigencia</th>
                    <th scope="col">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {(bq.data ?? []).map((r: Row) => (
                    <tr key={r.id}>
                      <td>
                        {r.is_dadofit_internal
                          ? "DadoFit interno"
                          : r.organization_name}
                      </td>
                      <td>{fmt(r.budget_dc)} DC</td>
                      <td>{fmt(r.used_dc)} DC</td>
                      <td>{fmt(r.remaining_dc)} DC</td>
                      <td>{r.utilization_pct}%</td>
                      <td>
                        <AdminStatusBadge status={r.status}/>
                      </td>
                      <td>
                        {date(r.starts_at)} → {date(r.ends_at)}
                      </td>
                      <td><AdminRowActions primary={r.status === "draft" ? { label: "Aprobar", disabled: Boolean(budgetActing), onClick: () => void setBudgetStatus(r.id, "approve") } : r.status === "paused" ? { label: "Reanudar", disabled: Boolean(budgetActing), onClick: () => void setBudgetStatus(r.id, "resume") } : undefined} actions={[
                        ...(r.status === "active" ? [{ label: "Pausar", disabled: Boolean(budgetActing), onClick: () => void setBudgetStatus(r.id, "pause") }] : []),
                        ...(["draft", "active", "paused"].includes(r.status) ? [{ label: "Cancelar", danger: true, disabled: Boolean(budgetActing), onClick: () => void setBudgetStatus(r.id, "cancel") }] : []),
                      ]}/></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="admin-card-v14">
          <div className="admin-rewards-card-head-v1582">
            <span className="eyebrow">TOP REWARDS</span>
            <h2>Premios con más actividad</h2>
          </div>
          {topRewards.length === 0 ? (
            <AdminEmptyState icon={<Gift size={22}/>} title="Sin canjes en este periodo." description="Prueba otro rango de fechas o espera a que haya actividad de canjes."/>
          ) : (
            <div className="admin-table-wrap-v14">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Premio</th>
                    <th scope="col">Partner</th>
                    <th scope="col">Estado</th>
                    <th scope="col">Canjes</th>
                    <th scope="col">Usuarios</th>
                    <th scope="col">DC</th>
                    <th scope="col">Stock actual</th>
                  </tr>
                </thead>
                <tbody>
                  {topRewards.map((r: Row) => (
                    <tr key={r.reward_id}>
                      <td>
                        <strong>{r.title}</strong>
                        <small>{fmt(r.coin_cost)} DC por canje</small>
                      </td>
                      <td>
                        {r.organization_name}
                        <small>{r.organization_type}</small>
                      </td>
                      <td>
                        <AdminStatusBadge status={r.status}/>
                      </td>
                      <td>{fmt(r.redemptions)}</td>
                      <td>{fmt(r.unique_users)}</td>
                      <td>{fmt(r.dc_consumed)}</td>
                      <td>
                        {r.remaining_stock === null
                          ? "Abierto"
                          : fmt(r.remaining_stock)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
        </div>
    </AdminShell>
  );
}

function SeasonsAdmin() {
  const q = useRpc("admin_list_competitive_seasons");
  const [name, setName] = useState("");
  const [type, setType] = useState<"squad" | "gym">("gym");
  const now = new Date();
  const next = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const local = (d: Date) => {
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  const [start, setStart] = useState(local(now));
  const [end, setEnd] = useState(local(next));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [options, setOptions] = useState<Row[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [optionsLoading, setOptionsLoading] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const rows = (q.data ?? []) as Row[];

  const loadOptions = useCallback(
    async (seasonType: "squad" | "gym", keepSelected = false) => {
      if (!supabase) return;
      setOptionsLoading(true);
      const { data, error: rpcError } = await supabase.rpc(
        "admin_competitive_season_options",
        { p_season_type: seasonType },
      );
      setOptionsLoading(false);
      if (rpcError) {
        setError(rpcError.message);
        return;
      }
      const nextOptions = (data ?? []) as Row[];
      setOptions(nextOptions);
      if (!keepSelected) setSelected([]);
    },
    [],
  );

  useEffect(() => {
    void loadOptions(type, Boolean(editingId));
  }, [type, editingId, loadOptions]);

  const resetForm = () => {
    setEditingId(null);
    setName("");
    setStart(local(new Date()));
    setEnd(local(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)));
    setSelected([]);
    setError("");
  };
  const toggle = (id: string) =>
    setSelected((current) =>
      current.includes(id)
        ? current.filter((value) => value !== id)
        : [...current, id],
    );

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!supabase) return;
    if (selected.length === 0) {
      setError(
        `Selecciona al menos un ${type === "gym" ? "Gym" : "Squad"} para la temporada.`,
      );
      return;
    }
    setSaving(true);
    setError("");
    const args = {
      p_name: name.trim(),
      p_starts_at: new Date(start).toISOString(),
      p_ends_at: new Date(end).toISOString(),
      p_entry_ids: selected,
    };
    const result = editingId
      ? await supabase.rpc("admin_update_competitive_season", {
          p_season_id: editingId,
          ...args,
        })
      : await supabase.rpc("admin_create_competitive_season", {
          p_season_type: type,
          ...args,
        });
    setSaving(false);
    if (result.error) {
      setError(result.error.message);
      return;
    }
    resetForm();
    await q.load();
  };

  const edit = (r: Row) => {
    setEditingId(r.id);
    setType(r.season_type as "squad" | "gym");
    setName(r.name ?? "");
    setStart(local(new Date(r.starts_at)));
    setEnd(local(new Date(r.ends_at)));
    setSelected(((r.participants ?? []) as Row[]).map((item) => item.id));
    setError("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const setStatus = async (id: string, status: string) => {
    if (!supabase) return;
    setError("");
    const { error: rpcError } = await supabase.rpc(
      "admin_set_competitive_season_status",
      { p_season_id: id, p_status: status },
    );
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    if (editingId === id) resetForm();
    void q.load();
  };

  return (
    <AdminShell
      title="Temporadas de Competitive Score"
      subtitle="Define ventanas competitivas y selecciona qué Squads o Gyms participan, sin borrar el histórico del ledger."
    >
      {(error || q.error) && (
        <div className="auth-error">{error || q.error}</div>
      )}
      <section className="admin-season-grid-v157">
        <form className="admin-card-v14 admin-season-form-v157" onSubmit={save}>
          <span className="eyebrow">
            {editingId ? "EDITAR TEMPORADA" : "NUEVA TEMPORADA"}
          </span>
          <h2>
            {editingId
              ? "Corregir ventana competitiva"
              : "Crear ventana competitiva"}
          </h2>
          <label>
            Tipo
            <select
              value={type}
              disabled={Boolean(editingId)}
              onChange={(e) => setType(e.target.value as "squad" | "gym")}
            >
              <option value="gym">Gym · Competitive Score</option>
              <option value="squad">Squad · Competitive Score</option>
            </select>
          </label>
          <label>
            Nombre
            <input
              required
              maxLength={120}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={
                type === "gym"
                  ? "Temporada Gym · Octubre"
                  : "Temporada Squad · Octubre"
              }
            />
          </label>
          <div className="admin-form-grid-v14">
            <label>
              Inicio
              <input
                type="datetime-local"
                required
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
            </label>
            <label>
              Fin
              <input
                type="datetime-local"
                required
                value={end}
                onChange={(e) => setEnd(e.target.value)}
              />
            </label>
          </div>
          <fieldset className="admin-season-picker-v1573">
            <legend>
              {type === "gym" ? "Gyms participantes" : "Squads participantes"}{" "}
              <small>{selected.length} seleccionados</small>
            </legend>
            <div className="admin-season-picker-actions-v1573">
              <button
                type="button"
                onClick={() => setSelected(options.map((item) => item.id))}
              >
                Seleccionar todos
              </button>
              <button type="button" onClick={() => setSelected([])}>
                Limpiar
              </button>
            </div>
            {optionsLoading ? (
              <div className="admin-season-picker-empty-v1573">
                Cargando participantes…
              </div>
            ) : options.length === 0 ? (
              <div className="admin-season-picker-empty-v1573">
                No hay {type === "gym" ? "Gyms" : "Squads"} disponibles.
              </div>
            ) : (
              <div className="admin-season-picker-list-v1573">
                {options.map((item) => (
                  <label
                    key={item.id}
                    className={selected.includes(item.id) ? "selected" : ""}
                  >
                    <input
                      type="checkbox"
                      checked={selected.includes(item.id)}
                      onChange={() => toggle(item.id)}
                    />
                    <span>
                      <strong>{item.name}</strong>
                      {type === "gym" && item.verification_status && (
                        <small>{item.verification_status}</small>
                      )}
                    </span>
                  </label>
                ))}
              </div>
            )}
          </fieldset>
          <div className="admin-season-form-actions-v1573">
            <button
              className="admin-season-save-v1573"
              disabled={saving || selected.length === 0}
            >
              {saving
                ? editingId
                  ? "Guardando…"
                  : "Creando…"
                : editingId
                  ? "Guardar cambios"
                  : "Crear temporada"}
            </button>
            {editingId && (
              <button
                className="admin-season-cancel-v1573"
                type="button"
                onClick={resetForm}
              >
                Cancelar edición
              </button>
            )}
          </div>
          <small>
            No se permite solapar dos temporadas activas/próximas del mismo
            tipo. El sistema ahora te dirá cuál temporada entra en conflicto.
          </small>
        </form>
        <section className="admin-card-v14">
          <div className="admin-season-head-v157">
            <div>
              <span className="eyebrow">HISTÓRICO</span>
              <h2>Temporadas configuradas</h2>
            </div>
            <button
              type="button"
              className="admin-refresh-v14"
              onClick={() => void q.load()}
            >
              <RefreshCw size={14} /> Actualizar
            </button>
          </div>
          {q.loading ? (
            <AdminLoadingState rows={4}/>
          ) : rows.length === 0 ? (
            <AdminEmptyState icon={<CalendarDays size={22}/>} title="No hay temporadas." description="Crea una ventana competitiva para empezar a medir Competitive Score."/>
          ) : (
            <div className="admin-season-list-v157">
              {rows.map((r) => (
                <article key={r.id}>
                  <div>
                    <span className="admin-season-icon-v157">
                      {r.season_type === "gym" ? (
                        <Building2 size={17} />
                      ) : (
                        <Trophy size={17} />
                      )}
                    </span>
                    <div>
                      <strong>{r.name}</strong>
                      <small>
                        {r.season_type === "gym" ? "Gym · Competitive Score" : "Squad · Competitive Score"} ·{" "}
                        {date(r.starts_at)} → {date(r.ends_at)} ·{" "}
                        {fmt(r.score_events)} eventos
                      </small>
                      <small className="admin-season-participants-v1573">
                        {((r.participants ?? []) as Row[]).length
                          ? ((r.participants ?? []) as Row[])
                              .map((item) => item.name)
                              .join(" · ")
                          : "Alcance legado: todos los participantes"}
                      </small>
                    </div>
                  </div>
                  <footer>
                    <AdminStatusBadge status={r.status}/>
                    {r.status === "upcoming" && (
                      <small className="admin-season-auto-v157">
                        Se activa automáticamente al iniciar
                      </small>
                    )}
                    {["upcoming", "active"].includes(r.status) && (
                      <button
                        type="button"
                        className="admin-season-edit-v1574"
                        onClick={() => edit(r)}
                      >
                        <Pencil size={12} /> Editar
                      </button>
                    )}
                    {r.status === "active" && (
                      <button
                        type="button"
                        className="admin-season-close-v157"
                        onClick={() => void setStatus(r.id, "completed")}
                      >
                        Cerrar temporada
                      </button>
                    )}
                  </footer>
                </article>
              ))}
            </div>
          )}
        </section>
      </section>
    </AdminShell>
  );
}

type AdsExportScope =
  | { type: "general" }
  | { type: "brand"; brand: string }
  | { type: "campaign"; campaignId: string };

async function buildAdsReportXlsxBlob(
  summary: SummaryExportData,
  campaignRows: CampaignExportRow[],
): Promise<Blob> {
  const { default: writeXlsxFile } = await import("write-excel-file/universal");
  const toXlsxDate = (iso: string) => {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, (m || 1) - 1, d || 1);
  };
  const bold = (value: string) => ({ value, fontWeight: "bold" as const });
  const numCell = (value: number, format?: string) => ({
    value: Number(value) || 0,
    type: Number,
    ...(format ? { format } : {}),
  });
  const dateCell = (iso: string) => ({
    value: toXlsxDate(iso),
    type: Date,
    format: "yyyy-mm-dd",
  });

  const summarySheet = [
    [bold(summary.report_name)],
    [bold("Período desde"), dateCell(summary.period_from)],
    [bold("Período hasta"), dateCell(summary.period_to)],
    [
      bold("Fecha de generación"),
    {
      value: summary.generated_at,
      type: Date,
      format: "yyyy-mm-dd hh:mm",
    },
    ],
    [bold("Impresiones totales"), numCell(summary.impressions, "#,##0")],
    [bold("Clics totales"), numCell(summary.clicks, "#,##0")],
    [bold("CTR global"), numCell(summary.ctr, "0.00%")],
    summary.identified_clickers === null || summary.identified_clickers === undefined
      ? [
          bold("Usuarios identificados"),
          {
            value:
              "No disponible como total por marca (no agregable sin duplicidad de usuarios)",
          },
        ]
      : [bold("Usuarios identificados"), numCell(summary.identified_clickers, "#,##0")],
    [bold("Cantidad de campañas"), numCell(summary.campaign_count)],
  ];

  const headers = [
    "Marca",
    "Campaña",
    "Estado",
    "Pieza / URL destino",
    "Impresiones",
    "Clics",
    "CTR",
    "Usuarios identificados",
    "Período desde",
    "Período hasta",
  ].map((h) => bold(h));

  const campaignsSheet = [
    headers,
    ...campaignRows.map((row) => [
      row.brand_name,
      row.campaign_name,
      row.status,
      row.target_url,
      numCell(row.impressions, "#,##0"),
      numCell(row.clicks, "#,##0"),
      numCell(row.ctr, "0.00%"),
      numCell(row.identified_clickers, "#,##0"),
      dateCell(row.period_from),
      dateCell(row.period_to),
    ]),
  ];

  const blob = await writeXlsxFile(
    [
      {
        data: summarySheet,
        sheet: "Resumen",
        columns: [{ width: 30 }, { width: 26 }],
      },
      {
        data: campaignsSheet,
        sheet: "Campañas",
        stickyRowsCount: 1,
        columns: [
          { width: 22 },
          { width: 30 },
          { width: 12 },
          { width: 28 },
          { width: 14 },
          { width: 10 },
          { width: 10 },
          { width: 18 },
          { width: 14 },
          { width: 14 },
        ],
      },
    ],
  ).toBlob();
  return blob;
}

function AdsExportMenu({
  id,
  label,
  items,
  align = "right",
  triggerAriaLabel,
  disabled = false,
}: {
  id: string;
  label: ReactNode;
  items: Array<{ key: string; label: string; onSelect: () => void; separator?: boolean }>;
  align?: "right" | "left";
  triggerAriaLabel?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const internalTriggerRef = useRef<HTMLButtonElement | null>(null);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });

  const positionMenu = useCallback(() => {
    const trigger = internalTriggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const menuWidth = menuRef.current?.offsetWidth ?? 220;
    const menuHeight = menuRef.current?.offsetHeight ?? 0;
    const left = Math.max(8, Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - 8));
    const fitsBelow = rect.bottom + 6 + menuHeight <= window.innerHeight - 8;
    setMenuPosition({
      left,
      top: fitsBelow || !menuHeight ? rect.bottom + 6 : Math.max(8, rect.top - menuHeight - 6),
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (event: MouseEvent) => {
      if (
        !menuRef.current?.contains(event.target as Node) &&
        !internalTriggerRef.current?.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        internalTriggerRef.current?.focus();
      }
    };
    const onViewportChange = () => positionMenu();
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onViewportChange);
    window.addEventListener("scroll", onViewportChange, true);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onViewportChange);
      window.removeEventListener("scroll", onViewportChange, true);
    };
  }, [open, positionMenu]);

  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => {
        positionMenu();
        menuRef.current
          ?.querySelector<HTMLElement>('[role="menuitem"]')
          ?.focus();
      });
    }
  }, [open, positionMenu]);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  const onMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const nodes = Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [],
    );
    if (!nodes.length) return;
    event.preventDefault();
    const current = nodes.indexOf(document.activeElement as HTMLElement);
    let next = 0;
    if (event.key === "ArrowDown") next = current < 0 || current === nodes.length - 1 ? 0 : current + 1;
    if (event.key === "ArrowUp") next = current <= 0 ? nodes.length - 1 : current - 1;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = nodes.length - 1;
    nodes[next]?.focus();
  };

  return (
    <div className="admin-ad-export-wrap-v144">
      <button
        type="button"
        data-export-trigger={id}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={`${id}-menu`}
        aria-label={triggerAriaLabel}
        ref={internalTriggerRef}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
      >
        {label}
      </button>
      {open && createPortal(
        <div
          id={`${id}-menu`}
          ref={menuRef}
          role="menu"
          aria-label="Formato de exportación"
          className={`admin-ad-export-menu-v144 ${align}`}
          style={menuPosition}
          onKeyDown={onMenuKeyDown}
        >
          {items.map((item) => (
            <Fragment key={item.key}>
              {item.separator && <span className="admin-ad-export-separator-v144" role="separator" />}
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  item.onSelect();
                  internalTriggerRef.current?.focus();
                }}
              >
                {item.label}
              </button>
            </Fragment>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}

function Ads() {
  const [placements, setPlacements] = useState<Row[]>([]);
  const [campaigns, setCampaigns] = useState<Row[]>([]);
  const [links, setLinks] = useState<Row[]>([]);
  const [inventoryLoading, setInventoryLoading] = useState(true);
  const emptyForm = {
    brand: "",
    campaign: "",
    image: "",
    target: "",
    start: "",
    end: "",
    placement: "workout-right-top",
  };
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [analyticsDays, setAnalyticsDays] = useState(30);
  const [exportStatus, setExportStatus] = useState("");
  const [exportError, setExportError] = useState("");
  const [exporting, setExporting] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  const toLocalInput = (value: any) => {
    if (!value) return "";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "";
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const firstPlacement = (campaignId: string) =>
    links.find((link) => link.campaign_id === campaignId)?.placement_key ||
    placements[0]?.placement_key ||
    "workout-right-top";
  const focusForm = () =>
    requestAnimationFrame(() =>
      formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
    );
  const resetForm = () => {
    setEditingId(null);
    setForm({
      ...emptyForm,
      placement: placements[0]?.placement_key || "workout-right-top",
    });
  };
  const editCampaign = (campaign: Row) => {
    setEditingId(campaign.id);
    setForm({
      brand: campaign.brand_name || "",
      campaign: campaign.campaign_name || "",
      image: campaign.image_url || "",
      target: campaign.target_url || "",
      start: toLocalInput(campaign.starts_at),
      end: toLocalInput(campaign.ends_at),
      placement: firstPlacement(campaign.id),
    });
    setError("");
    focusForm();
  };
  const duplicateCampaign = (campaign: Row) => {
    setEditingId(null);
    setForm({
      brand: campaign.brand_name || "",
      campaign: `${campaign.campaign_name || "Campaña"} (copia)`,
      image: campaign.image_url || "",
      target: campaign.target_url || "",
      start: toLocalInput(campaign.starts_at),
      end: toLocalInput(campaign.ends_at),
      placement: firstPlacement(campaign.id),
    });
    setError("");
    focusForm();
  };
  const analyticsSummary = useRpc("admin_ad_analytics_summary", {
    p_days: analyticsDays,
  });
  const campaignMetrics = useRpc("admin_ad_campaign_metrics", {
    p_days: analyticsDays,
  });
  const recentClicks = useRpc("admin_recent_ad_clicks", {
    p_days: analyticsDays,
    p_limit: 100,
  });

  const load = useCallback(async () => {
    if (!supabase) return;
    setInventoryLoading(true);
    setError("");
    const [p, c, l] = await Promise.all([
      supabase.from("ad_placements").select("*").order("placement_key"),
      supabase
        .from("ad_campaigns")
        .select("*")
        .order("created_at", { ascending: false }),
      supabase.from("ad_campaign_placements").select("*"),
    ]);
    if (p.error || c.error || l.error) {
      setInventoryLoading(false);
      setError(
        p.error?.message || c.error?.message || l.error?.message || "Error",
      );
      return;
    }
    setPlacements(p.data ?? []);
    setCampaigns(c.data ?? []);
    setLinks(l.data ?? []);
    setInventoryLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!supabase) return;
    setError("");

    if (editingId) {
      const { error: updateError } = await supabase.rpc(
        "admin_update_ad_campaign",
        {
          p_campaign_id: editingId,
          p_brand_name: form.brand,
          p_campaign_name: form.campaign,
          p_image_url: form.image || null,
          p_target_url: form.target || null,
          p_starts_at: form.start ? new Date(form.start).toISOString() : null,
          p_ends_at: form.end ? new Date(form.end).toISOString() : null,
          p_placement_key: form.placement,
        },
      );
      if (updateError) {
        setError(updateError.message);
        return;
      }
      resetForm();
      void load();
      return;
    }

    const { data: id, error: createError } = await supabase.rpc(
      "admin_create_ad_campaign",
      {
        p_brand_name: form.brand,
        p_campaign_name: form.campaign,
        p_image_url: form.image || null,
        p_target_url: form.target || null,
        p_starts_at: form.start ? new Date(form.start).toISOString() : null,
        p_ends_at: form.end ? new Date(form.end).toISOString() : null,
      },
    );
    if (createError) {
      setError(createError.message);
      return;
    }
    const { error: assignError } = await supabase.rpc(
      "admin_assign_ad_placement",
      {
        p_campaign_id: id,
        p_placement_key: form.placement,
        p_enabled: true,
      },
    );
    if (assignError) {
      setError(assignError.message);
      return;
    }
    resetForm();
    void load();
  };

  const setStatus = async (id: string, status: string) => {
    if (!supabase) return;
    const { error: e } = await supabase.rpc("admin_set_ad_campaign_status", {
      p_campaign_id: id,
      p_status: status,
    });
    if (e) alert(e.message);
    else void load();
  };

  const setRotation = async (placementKey: string, seconds: number) => {
    if (!supabase) return;
    const { error: e } = await supabase.rpc("admin_set_ad_placement_rotation", {
      p_placement_key: placementKey,
      p_rotation_seconds: seconds,
    });
    if (e) {
      alert(e.message);
      return;
    }
    setPlacements((current) =>
      current.map((item) =>
        item.placement_key === placementKey
          ? { ...item, rotation_seconds: seconds }
          : item,
      ),
    );
  };

  const activeForPlacement = (key: string) => {
    const ids = new Set(
      links.filter((l) => l.placement_key === key).map((l) => l.campaign_id),
    );
    return campaigns.filter((c) => ids.has(c.id) && c.status === "active");
  };

  const analytics = analyticsSummary.data ?? {};
  const metricRows = (campaignMetrics.data ?? []) as Row[];
  const clickRows = (recentClicks.data ?? []) as Row[];
  const refreshAnalytics = () => {
    void analyticsSummary.load();
    void campaignMetrics.load();
    void recentClicks.load();
  };

  const analyticsLoading = analyticsSummary.loading || campaignMetrics.loading;
  const analyticsRangeReady = Number(analytics.days) === analyticsDays;
  const analyticsExportError = analyticsSummary.error || campaignMetrics.error;
  const exportDisabled =
    analyticsLoading ||
    !analyticsRangeReady ||
    Boolean(analyticsExportError) ||
    metricRows.length === 0 ||
    exporting;
  const exportDisabledReason = analyticsLoading
    ? "Cargando datos…"
    : !analyticsRangeReady
      ? "Cargando datos…"
      : analyticsExportError
        ? "No se pudieron cargar los datos para exportar"
    : metricRows.length === 0
      ? "No hay datos para exportar"
      : exporting
        ? "Generando archivo…"
        : "";

  const downloadBlob = (blob: Blob, fileName: string) => {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  };

  const runExport = async (scope: AdsExportScope, format: "xlsx" | "csv") => {
    if (exportDisabled) return;
    setExportStatus("");
    setExportError("");
    setExporting(true);
    try {
      const snapshotRows = metricRows.map((row) => ({ ...row })) as AdMetricRow[];
      const snapshotSummary: AdAnalyticsSummary = {
        days: analyticsDays,
        impressions: Number(analytics.impressions) || 0,
        clicks: Number(analytics.clicks) || 0,
        identified_clickers: Number(analytics.identified_clickers) || 0,
        unique_click_sessions: Number(analytics.unique_click_sessions) || 0,
        ctr: Number(analytics.ctr) || 0,
      };
      const snapshotCampaigns = campaigns.map((c) => ({
        id: String(c.id),
        target_url: (c.target_url as string | null) ?? null,
      }));
      const now = new Date();
      const dateRange = buildDateRange(analyticsDays, now);
      const targetUrlById = buildTargetUrlById(snapshotCampaigns);
      const selector: AdsReportScopeSelector =
        scope.type === "brand"
          ? { type: "brand", brand: scope.brand }
          : scope.type === "campaign"
            ? { type: "campaign", campaignId: scope.campaignId }
            : { type: "general" };
      const scopedRows = selectRowsForScope(snapshotRows, selector);
      if (scopedRows.length === 0) {
        setExportError("No hay datos para exportar.");
        return;
      }
      const first = scopedRows[0];
      const fileName = buildReportFileName({
        scope: scope.type,
        brand: first?.brand_name ?? "",
        campaign: first?.campaign_name ?? "",
        date: now,
        format,
      });
      if (format === "csv") {
        const csv = buildCsvContent(scopedRows, { dateRange, targetUrlById });
        downloadBlob(
          new Blob([csv], { type: "text/csv;charset=utf-8" }),
          fileName,
        );
      } else {
        const summary = buildSummaryData({
          selector,
          rows: scopedRows,
          globalSummary: snapshotSummary,
          dateRange,
          generatedAt: now,
        });
        const campaignExportRows = toCampaignExportRows(scopedRows, {
          dateRange,
          targetUrlById,
        });
        const blob = await buildAdsReportXlsxBlob(summary, campaignExportRows);
        downloadBlob(blob, fileName);
      }
      setExportStatus(`Archivo generado: ${fileName}`);
    } catch {
      setExportError("No pudimos generar el archivo. Intenta de nuevo.");
    } finally {
      setExporting(false);
    }
  };

  return (
    <AdminShell
      title="Publicidad"
      subtitle="Inventario comercial rotativo, medición de impresiones y trazabilidad de clics."
    >
      {error && <div className="auth-error">{error}</div>}

      <section className="admin-ad-analytics-v144">
        <header className="admin-ad-analytics-head-v144">
          <div>
            <span className="eyebrow">AD ANALYTICS</span>
            <h2>Rendimiento de pauta</h2>
            <p>
              Medición first-party de impresiones, clics, CTR y usuarios
              identificados.
            </p>
          </div>
          <div>
            <select
              value={analyticsDays}
              onChange={(e) => setAnalyticsDays(Number(e.target.value))}
              aria-label="Periodo de analítica publicitaria"
            >
              <option value={7}>Últimos 7 días</option>
              <option value={30}>Últimos 30 días</option>
              <option value={90}>Últimos 90 días</option>
            </select>
            <AdsExportMenu
              id="ad-export-general"
              disabled={exportDisabled}
              label={
                <>
                  <Download size={14} /> Exportar <ChevronDown size={13} />
                </>
              }
              items={[
                {
                  key: "xlsx",
                  label: "Excel (.xlsx)",
                  onSelect: () => void runExport({ type: "general" }, "xlsx"),
                },
                {
                  key: "csv",
                  label: "CSV (.csv)",
                  onSelect: () => void runExport({ type: "general" }, "csv"),
                },
              ]}
            />
            <button type="button" onClick={refreshAnalytics}>
              <RefreshCw size={14} /> Actualizar
            </button>
          </div>
        </header>
        {exportStatus && (
          <p className="admin-ad-export-status-v144" role="status" aria-live="polite">
            {exportStatus}
          </p>
        )}
        {exportError && (
          <div className="auth-error" role="alert">
            {exportError}
          </div>
        )}
        {exportDisabled && exportDisabledReason && !exportStatus && !exportError && (
          <p className="admin-ad-export-status-v144" aria-live="polite">
            {exportDisabledReason}
          </p>
        )}
        {(analyticsSummary.error ||
          campaignMetrics.error ||
          recentClicks.error) && (
          <div className="auth-error">
            {analyticsSummary.error ||
              campaignMetrics.error ||
              recentClicks.error}
          </div>
        )}
        {analyticsSummary.loading ? <AdminLoadingState rows={2}/> : <div className="admin-ad-kpis-v144">
          <article>
            <Eye size={19} />
            <span>Impresiones</span>
            <strong>{fmt(analytics.impressions)}</strong>
          </article>
          <article>
            <MousePointerClick size={19} />
            <span>Clics</span>
            <strong>{fmt(analytics.clicks)}</strong>
          </article>
          <article>
            <BarChart3 size={19} />
            <span>CTR</span>
            <strong>{formatCtrDisplay(analytics.ctr)}</strong>
          </article>
          <article>
            <UsersRound size={19} />
            <span>Usuarios identificados</span>
            <strong>{fmt(analytics.identified_clickers)}</strong>
          </article>
        </div>}
        <div className="admin-ad-analytics-grid-v144">
          <div className="admin-card-v14 admin-ad-metrics-card-v144">
            <div className="admin-ad-card-title-v144">
              <div>
                <span className="eyebrow">POR CAMPAÑA</span>
                <h3>Desempeño comercial</h3>
              </div>
              <small>{analyticsDays} días</small>
            </div>
            {campaignMetrics.loading ? <AdminLoadingState rows={4}/> : metricRows.length === 0 ? (
              <div className="admin-ad-analytics-empty-v144">
                Aún no hay eventos de pauta registrados.
              </div>
            ) : (
              <div className="admin-ad-metrics-table-v144">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Campaña</th>
                      <th scope="col">Impresiones</th>
                      <th scope="col">Clics</th>
                      <th scope="col">CTR</th>
                      <th scope="col">Usuarios</th>
                      <th scope="col" className="admin-ad-export-actions-th-v144">
                        <span className="admin-ad-export-sr-v144">Exportar</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {metricRows.map((r) => (
                      <tr key={r.campaign_id}>
                        <td>
                          <strong>{r.brand_name}</strong>
                          <small>{r.campaign_name}</small>
                        </td>
                        <td>{fmt(r.impressions)}</td>
                        <td>{fmt(r.clicks)}</td>
                        <td>{formatCtrDisplay(r.ctr)}</td>
                        <td>{fmt(r.identified_clickers)}</td>
                        <td className="admin-ad-export-actions-td-v144">
                          <AdsExportMenu
                            id={`ad-export-row-${r.campaign_id}`}
                            triggerAriaLabel={`Exportar opciones de ${r.brand_name || ""} — ${r.campaign_name || ""}`}
                            disabled={exportDisabled}
                            label={<Download size={14} />}
                            items={[
                              {
                                key: "campaign-xlsx",
                                label: "Campaña — Excel (.xlsx)",
                                onSelect: () =>
                                  void runExport(
                                    { type: "campaign", campaignId: r.campaign_id },
                                    "xlsx",
                                  ),
                              },
                              {
                                key: "campaign-csv",
                                label: "Campaña — CSV (.csv)",
                                onSelect: () =>
                                  void runExport(
                                    { type: "campaign", campaignId: r.campaign_id },
                                    "csv",
                                  ),
                              },
                              {
                                key: "brand-xlsx",
                                label: `Marca ${r.brand_name} — Excel (.xlsx)`,
                                separator: true,
                                onSelect: () =>
                                  void runExport(
                                    { type: "brand", brand: r.brand_name },
                                    "xlsx",
                                  ),
                              },
                              {
                                key: "brand-csv",
                                label: `Marca ${r.brand_name} — CSV (.csv)`,
                                onSelect: () =>
                                  void runExport(
                                    { type: "brand", brand: r.brand_name },
                                    "csv",
                                  ),
                              },
                            ]}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <div className="admin-card-v14 admin-ad-clicks-card-v144">
            <div className="admin-ad-card-title-v144">
              <div>
                <span className="eyebrow">CLICS RECIENTES</span>
                <h3>Quién interactuó</h3>
              </div>
              <small>{clickRows.length} eventos</small>
            </div>
            {recentClicks.loading ? <AdminLoadingState rows={4}/> : clickRows.length === 0 ? (
              <div className="admin-ad-analytics-empty-v144">
                Todavía no hay clics registrados en este periodo.
              </div>
            ) : (
              <div className="admin-ad-click-list-v144">
                {clickRows.map((r) => (
                  <article key={r.event_id}>
                    <div className="admin-ad-click-user-v144">
                      <span>
                        {r.user_id ? (
                          <UserRound size={14} />
                        ) : (
                          <MousePointerClick size={14} />
                        )}
                      </span>
                      <div>
                        <strong>
                          {r.display_name ||
                            r.username ||
                            r.email ||
                            "Visitante no identificado"}
                        </strong>
                        <small>
                          {r.user_id
                            ? r.email || `@${r.username || "usuario"}`
                            : `Sesión ${String(r.session_id || "").slice(0, 8)}`}
                        </small>
                      </div>
                    </div>
                    <div className="admin-ad-click-meta-v144">
                      <strong>
                        {r.brand_name} · {r.campaign_name}
                      </strong>
                      <span>
                        {r.route_path} · {r.device_type} · {r.placement_key}
                      </span>
                      <small>{date(r.occurred_at)}</small>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
        </div>
        <p className="admin-ad-privacy-note-v144">
          <ShieldCheck size={13} /> DadoFit registra el usuario autenticado
          cuando existe, una sesión técnica, la ruta y el tipo de dispositivo.
          No almacena IP ni el user-agent completo en esta analítica.
        </p>
      </section>

      {inventoryLoading ? <AdminLoadingState rows={3}/> : placements.length === 0 ? <AdminEmptyState icon={<Megaphone size={22}/>} title="No hay placements publicitarios" description="El inventario aparecerá aquí cuando esté disponible."/> : <section className="admin-ad-inventory-v14">
        {placements.map((p) => {
          const active = activeForPlacement(p.placement_key);
          const seconds = Number(p.rotation_seconds ?? 12);
          return (
            <article key={p.placement_key}>
              <span className="eyebrow">
                {p.channel} · {p.format}
              </span>
              <h3>{p.label}</h3>
              {active.length > 0 ? (
                <>
                  <p>
                    <strong>
                      {active.length}{" "}
                      {active.length === 1
                        ? "campaña activa"
                        : "campañas en rotación"}
                    </strong>
                  </p>
                  <div className="admin-ad-rotation-list-v143">
                    {active.slice(0, 3).map((c) => (
                      <small key={c.id}>
                        {c.brand_name} · {c.campaign_name}
                      </small>
                    ))}
                  </div>
                </>
              ) : (
                <p>Espacio disponible</p>
              )}
              <div className="admin-ad-rotation-v143">
                <span>
                  {active.length > 1
                    ? `Cambia cada ${seconds}s`
                    : "Tiempo de rotación"}
                </span>
                <select
                  value={seconds}
                  onChange={(e) =>
                    void setRotation(p.placement_key, Number(e.target.value))
                  }
                  aria-label={`Rotación de ${p.label}`}
                >
                  {[5, 8, 10, 12, 15, 20, 30, 45, 60].map((value) => (
                    <option key={value} value={value}>
                      {value}s
                    </option>
                  ))}
                </select>
              </div>
              <small>{p.placement_key}</small>
            </article>
          );
        })}
      </section>}

      <aside className="admin-ad-creative-guide-v142">
        <Megaphone size={18} />
        <div>
          <strong>Vallas digitales DadoFit</strong>
          <span>
            Puedes activar varias campañas en el mismo placement. DadoFit las
            rota automáticamente según el tiempo configurado arriba, manteniendo
            la misma posición y el mismo formato visual. Desktop: 300×600 /
            160×600. Mobile: 320×50.
          </span>
        </div>
      </aside>

      <section className="admin-ad-grid-v14">
        <form
          ref={formRef}
          className={`admin-card-v14 admin-ad-editor-v145 ${editingId ? "is-editing" : ""}`}
          onSubmit={submit}
        >
          <span className="eyebrow">
            {editingId ? "EDITANDO PAUTA" : "NUEVA PAUTA"}
          </span>
          <h2>
            {editingId
              ? "Modificar campaña publicitaria"
              : "Crear campaña publicitaria"}
          </h2>
          {editingId && (
            <div className="admin-ad-editor-note-v145">
              <Pencil size={15} />
              <div>
                <strong>Editando una campaña existente</strong>
                <span>
                  Marca, creatividad, destino, fechas y placement se
                  actualizarán al guardar. Si está activa, el cambio se
                  reflejará inmediatamente.
                </span>
              </div>
            </div>
          )}
          <label>
            Marca
            <input
              value={form.brand}
              onChange={(e) => setForm({ ...form, brand: e.target.value })}
              required
            />
          </label>
          <label>
            Campaña
            <input
              value={form.campaign}
              onChange={(e) => setForm({ ...form, campaign: e.target.value })}
              required
            />
          </label>
          <label>
            Imagen URL
            <input
              value={form.image}
              onChange={(e) => setForm({ ...form, image: e.target.value })}
              placeholder="https://..."
            />
          </label>
          <label>
            Destino URL
            <input
              value={form.target}
              onChange={(e) => setForm({ ...form, target: e.target.value })}
              placeholder="https://..."
            />
          </label>
          <div className="admin-form-grid-v14">
            <label>
              Inicio
              <input
                type="datetime-local"
                value={form.start}
                onChange={(e) => setForm({ ...form, start: e.target.value })}
              />
            </label>
            <label>
              Fin
              <input
                type="datetime-local"
                value={form.end}
                onChange={(e) => setForm({ ...form, end: e.target.value })}
              />
            </label>
          </div>
          <label>
            Placement
            <select
              value={form.placement}
              onChange={(e) => setForm({ ...form, placement: e.target.value })}
            >
              {placements.map((p) => (
                <option key={p.placement_key} value={p.placement_key}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <div className="admin-ad-editor-actions-v145">
            <button>
              {editingId ? "Guardar cambios" : "Crear en borrador"}
            </button>
            {editingId && (
              <button
                type="button"
                className="admin-ad-secondary-v145"
                onClick={resetForm}
              >
                <X size={14} /> Cancelar edición
              </button>
            )}
          </div>
        </form>

        <div className="admin-card-v14">
          <span className="eyebrow">CAMPAÑAS</span>
          <h2>Control de pauta</h2>
          <div className="admin-ad-campaign-list-v14">
            {!inventoryLoading && campaigns.length === 0 && <AdminEmptyState icon={<Megaphone size={22}/>} title="No hay campañas publicitarias" description="Crea una pauta en el formulario para comenzar."/>}
            {campaigns.map((c) => {
              const editable = !["completed", "cancelled"].includes(c.status);
              return (
                <article
                  key={c.id}
                  className={editingId === c.id ? "is-editing" : ""}
                >
                  <div>
                    <strong>{c.brand_name}</strong>
                    <span>{c.campaign_name}</span>
                    <small>
                      <AdminStatusBadge status={c.status}/> {" "}
                      {links
                        .filter((l) => l.campaign_id === c.id)
                        .map((l) => l.placement_key)
                        .join(", ") || "sin placement"}
                    </small>
                  </div>
                  <AdminRowActions primary={c.status !== "active" ? { label: "Activar", onClick: () => void setStatus(c.id, "active") } : { label: "Pausar", onClick: () => void setStatus(c.id, "paused") }} actions={[
                    ...(editable ? [{ label: "Editar", onClick: () => editCampaign(c) }] : []),
                    { label: "Duplicar", onClick: () => duplicateCampaign(c) },
                  ]}/>
                </article>
              );
            })}
          </div>
        </div>
      </section>
    </AdminShell>
  );
}
function Audit() {
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

export function AdminPage() {
  const path = useLocation().pathname;
  if (path === "/admin/users") return <Users />;
  if (path === "/admin/organizations") return <Organizations />;
  if (path === "/admin/brands") return <Organizations brandsOnly />;
  if (path === "/admin/campaigns") return <Campaigns />;
  if (path === "/admin/requests") return <Requests />;
  if (path === "/admin/rewards") return <RewardsAnalyticsAdmin />;
  if (path === "/admin/seasons") return <SeasonsAdmin />;
  if (path === "/admin/ads") return <Ads />;
  if (path === "/admin/audit") return <Audit />;
  return <Dashboard />;
}
