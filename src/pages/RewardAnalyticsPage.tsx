import { AlertTriangle, BarChart3, CheckCircle2, Clock3, Coins, Gift, RefreshCw, Store, UsersRound } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AppHeader } from '../components/AppHeader';
import { useWorkspace } from '../context/WorkspaceContext';
import { supabase } from '../lib/supabase';

type Summary = {
  offers_total: number;
  active_offers: number;
  redemptions: number;
  redeemed: number;
  pending_delivery: number;
  unique_users: number;
  dc_consumed: number;
  gp_consumed: number;
  sp_consumed: number;
  low_stock_offers: number;
};

type OfferMetric = {
  reward_id: string;
  title: string;
  status: string;
  coin_cost: number;
  native_currency: 'gp' | 'sp' | null;
  native_cost: number | null;
  inventory: number | null;
  remaining_stock: number | null;
  redemptions: number;
  redeemed: number;
  unique_users: number;
  dc_consumed: number;
  gp_consumed: number;
  sp_consumed: number;
  low_stock: boolean;
};

type TrendPoint = {
  day: string;
  redemptions: number;
  dc_consumed: number;
  gp_consumed: number;
  sp_consumed: number;
  unique_users: number;
};

type RecentRedemption = {
  redemption_id: string;
  reward_id: string;
  reward_title: string;
  user_id: string;
  user_name: string;
  coin_cost: number;
  payment_currency: 'dc' | 'gp' | 'sp';
  payment_amount: number;
  status: string;
  created_at: string;
  redeemed_at: string | null;
};

type AnalyticsPayload = {
  period_days: number;
  from: string;
  summary: Summary;
  offers: OfferMetric[];
  trend: TrendPoint[];
  recent_redemptions: RecentRedemption[];
};

const fmt = (value: number) => new Intl.NumberFormat('es-CO').format(Number(value || 0));
const shortDate = (value: string) => new Intl.DateTimeFormat('es-CO', { day: '2-digit', month: 'short' }).format(new Date(value));
const fullDate = (value: string) => new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));

export function RewardAnalyticsPage() {
  const { activeWorkspace } = useWorkspace();
  const orgId = activeWorkspace.organizationId;
  const manager = activeWorkspace.role === 'owner' || activeWorkspace.role === 'admin';
  const nativeCurrency = activeWorkspace.kind === 'gym' ? 'GP' : 'SP';
  const [days, setDays] = useState(30);
  const [data, setData] = useState<AnalyticsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!supabase || !orgId || !manager) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    const { data: payload, error: rpcError } = await supabase.rpc('provider_reward_analytics', {
      p_organization_id: orgId,
      p_days: days,
    });
    if (rpcError) setError(rpcError.message);
    else setData((payload ?? null) as AnalyticsPayload | null);
    setLoading(false);
  }, [days, manager, orgId]);

  useEffect(() => { void load(); }, [load]);

  const maxTrend = useMemo(() => Math.max(1, ...(data?.trend ?? []).map((point) => Number(point.redemptions || 0))), [data]);
  const lowStock = useMemo(() => (data?.offers ?? []).filter((offer) => offer.low_stock), [data]);
  const topOffers = useMemo(() => [...(data?.offers ?? [])].sort((a, b) => b.redemptions - a.redemptions).slice(0, 10), [data]);

  if (!manager) {
    return <div className="workout-layout rewards-page-v15"><AppHeader/><main className="rewards-shell-v15"><div className="rewards-empty-v15"><BarChart3/><strong>Solo Owner/Admin puede consultar analytics de Rewards.</strong></div></main></div>;
  }

  const summary = data?.summary;

  return <div className="workout-layout rewards-page-v15"><AppHeader/><main className="rewards-shell-v15 reward-analytics-v154">
    <section className="rewards-hero-v15 provider-hero-v15">
      <div><span className="eyebrow">REWARDS ANALYTICS</span><h1>Rendimiento de {activeWorkspace.label}</h1><p>Canjes por DC y {nativeCurrency}, usuarios y salud de inventario.</p></div>
      <div className="reward-analytics-hero-actions-v154"><Link to="/rewards/manage"><Gift size={16}/> Gestionar ofertas</Link><button onClick={() => void load()} disabled={loading}><RefreshCw size={16}/> Actualizar</button></div>
    </section>

    <div className="reward-analytics-toolbar-v154">
      <div><strong>Periodo</strong><span>Las métricas de canje usan esta ventana. El stock es actual.</span></div>
      <div>{[7,30,90].map((value) => <button key={value} className={days===value?'active':''} onClick={() => setDays(value)}>{value} días</button>)}</div>
    </div>

    {error && <div className="auth-error">{error}</div>}
    {loading && <div className="rewards-empty-v15">Cargando analytics…</div>}

    {!loading && data && <>
      <section className="reward-analytics-kpis-v154">
        <article><Gift/><span>Canjes</span><strong>{fmt(summary?.redemptions ?? 0)}</strong><small>{fmt(summary?.redeemed ?? 0)} entregados</small></article>
        <article><Coins/><span>DC consumidos</span><strong>{fmt(summary?.dc_consumed ?? 0)}</strong><small>Pagos realizados en DC</small></article>
        <article><Coins/><span>{nativeCurrency} consumidos</span><strong>{fmt(activeWorkspace.kind === 'gym' ? (summary?.gp_consumed ?? 0) : (summary?.sp_consumed ?? 0))}</strong><small>Pagos nativos del partner</small></article>
        <article><UsersRound/><span>Gymbros únicos</span><strong>{fmt(summary?.unique_users ?? 0)}</strong><small>Usuarios que canjearon</small></article>
        <article><Clock3/><span>Pendientes de entrega</span><strong>{fmt(summary?.pending_delivery ?? 0)}</strong><small>Emitidos aún no confirmados</small></article>
        <article><Store/><span>Ofertas activas</span><strong>{fmt(summary?.active_offers ?? 0)}</strong><small>{fmt(summary?.offers_total ?? 0)} ofertas totales</small></article>
        <article className={(summary?.low_stock_offers ?? 0)>0?'warning':''}><AlertTriangle/><span>Stock bajo</span><strong>{fmt(summary?.low_stock_offers ?? 0)}</strong><small>≤20% o ≤3 unidades</small></article>
      </section>

      <section className="reward-analytics-grid-v154">
        <article className="reward-analytics-card-v154 reward-trend-card-v154">
          <header><div><span className="eyebrow">TENDENCIA</span><h2>Canjes diarios</h2></div><small>Últimos {data.period_days} días</small></header>
          {(data.trend ?? []).every((point) => Number(point.redemptions)===0) ? <div className="reward-analytics-empty-v154">Aún no hay canjes en este periodo.</div> : <div className="reward-trend-v154">{data.trend.map((point) => <div key={point.day} className="reward-trend-column-v154" title={`${shortDate(point.day)} · ${point.redemptions} canjes`}><div className="reward-trend-bar-wrap-v154"><div className="reward-trend-bar-v154" style={{ height: `${Math.max(4,(Number(point.redemptions)/maxTrend)*100)}%` }}/></div><span>{shortDate(point.day)}</span></div>)}</div>}
        </article>

        <article className="reward-analytics-card-v154">
          <header><div><span className="eyebrow">INVENTARIO</span><h2>Alertas de stock</h2></div><AlertTriangle size={18}/></header>
          {lowStock.length===0 ? <div className="reward-analytics-ok-v154"><CheckCircle2 size={18}/><span>No hay ofertas con stock bajo.</span></div> : <div className="reward-stock-list-v154">{lowStock.map((offer) => <div key={offer.reward_id}><div><strong>{offer.title}</strong><small>{offer.status} · {fmt(offer.coin_cost)} DC{offer.native_cost ? ` / ${fmt(offer.native_cost)} ${offer.native_currency?.toUpperCase()}` : ''}</small></div><b>{offer.remaining_stock ?? '∞'} disponibles</b></div>)}</div>}
        </article>
      </section>

      <section className="reward-analytics-card-v154">
        <header><div><span className="eyebrow">OFERTAS</span><h2>Rendimiento por premio</h2></div><small>Ordenado por canjes</small></header>
        {topOffers.length===0 ? <div className="reward-analytics-empty-v154">Aún no existen ofertas.</div> : <div className="reward-analytics-table-wrap-v154"><table><thead><tr><th>Oferta</th><th>Estado</th><th>Canjes</th><th>Usuarios</th><th>DC</th><th>{nativeCurrency}</th><th>Entregados</th><th>Stock actual</th></tr></thead><tbody>{topOffers.map((offer) => <tr key={offer.reward_id}><td><strong>{offer.title}</strong><small>{fmt(offer.coin_cost)} DC{offer.native_cost ? ` o ${fmt(offer.native_cost)} ${offer.native_currency?.toUpperCase()}` : ''}</small></td><td><span className={`reward-analytics-status-v154 ${offer.status}`}>{offer.status}</span></td><td>{fmt(offer.redemptions)}</td><td>{fmt(offer.unique_users)}</td><td>{fmt(offer.dc_consumed)}</td><td>{fmt(activeWorkspace.kind === 'gym' ? offer.gp_consumed : offer.sp_consumed)}</td><td>{fmt(offer.redeemed)}</td><td className={offer.low_stock?'stock-warning':''}>{offer.remaining_stock===null?'Abierto':fmt(offer.remaining_stock)}</td></tr>)}</tbody></table></div>}
      </section>

      <section className="reward-analytics-card-v154">
        <header><div><span className="eyebrow">ACTIVIDAD</span><h2>Canjes recientes</h2></div><small>Últimos 20</small></header>
        {(data.recent_redemptions ?? []).length===0 ? <div className="reward-analytics-empty-v154">Aún no hay canjes.</div> : <div className="reward-recent-list-v154">{data.recent_redemptions.map((row) => <div key={row.redemption_id}><div><strong>{row.user_name}</strong><span>{row.reward_title}</span><small>{fullDate(row.created_at)}</small></div><div><b>{fmt(row.payment_amount ?? row.coin_cost)} {(row.payment_currency ?? 'dc').toUpperCase()}</b><span className={`reward-analytics-status-v154 ${row.status}`}>{row.status}</span></div></div>)}</div>}
      </section>
    </>}
  </main></div>;
}
