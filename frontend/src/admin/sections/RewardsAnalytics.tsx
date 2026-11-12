import { Activity, BadgeCheck, Building2, Coins, Gift, RefreshCw, Tag, UsersRound, Wallet } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { backend } from "../../lib/backend";
import type { RpcName } from "../../types/database";
import { AdminDadoFitMarketplace } from "../AdminDadoFitMarketplace";
import { AdminEmptyState, AdminRowActions, AdminStatusBadge } from "../components/AdminVisual";
import { AdminShell, type Row, date, fmt, useRpc } from "./shared";

export function RewardsAnalyticsAdmin() {
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
    if (!backend || (!internalBudget && !budgetOrg)) return;
    setBudgetActing("create");
    setBudgetError("");
    setBudgetMessage("");
    const { error } = await backend.rpc("superadmin_create_dc_budget", {
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
    if (!backend) return;
    setBudgetActing(`${action}:${id}`);
    setBudgetError("");
    const rpc = ({
      approve: "superadmin_approve_dc_budget",
      pause: "superadmin_pause_dc_budget",
      resume: "superadmin_resume_dc_budget",
      cancel: "superadmin_cancel_dc_budget",
    } as const satisfies Record<typeof action, RpcName>)[action];
    const { error } = await backend.rpc(rpc, { p_budget_id: id });
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

        <AdminDadoFitMarketplace onChanged={() => void q.load()} />

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
