import { CheckCircle2, Clipboard, Coins, ExternalLink, Gift, History, Package, QrCode, RefreshCw, Search, Store, Ticket, XCircle } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppHeader } from '../components/AppHeader';
import { RewardQrCode } from '../components/RewardQrCode';
import { supabase } from '../lib/supabase';

type Offer = {
  id: string; provider_name: string; provider_type: string; title: string; description: string | null; reward_type: string;
  coin_cost: number; inventory: number | null; max_per_user: number; image_url: string | null; fulfillment_type: string;
  fulfillment_mode: string; terms: string | null; remaining_stock: number | null; user_redemptions: number; availability_status: string; can_redeem: boolean;
};

type Redemption = {
  id: string; title: string; provider_name: string; image_url: string | null; coin_cost: number; status: string;
  redemption_reference: string | null; redemption_code: string | null; redemption_url: string | null;
  fulfillment_type: string | null; fulfillment_mode: string | null; fulfillment_instructions: string | null; terms: string | null;
  validation_token: string | null; fulfillment_notes: string | null; fulfilled_at: string | null;
  created_at: string; issued_at: string | null; redeemed_at: string | null; expires_at: string | null;
};

type RedemptionResult = {
  title: string;
  new_balance: number;
  redemption_reference: string | null;
  redemption_code: string | null;
  redemption_url: string | null;
};

const typeLabels: Record<string, string> = { discount: 'Descuento', product: 'Producto', gym_pass: 'Pase de Gym', subscription: 'Suscripción', experience: 'Experiencia', other: 'Otro' };
const fulfillmentLabels: Record<string, string> = { digital_code: 'Código digital', digital_benefit: 'Beneficio digital', physical_product: 'Producto físico', in_person: 'Canje presencial' };
const fmt = (value: number) => new Intl.NumberFormat('es-CO').format(Number(value || 0));
const date = (value: string | null) => value ? new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium' }).format(new Date(value)) : '—';

export function RewardsMarketplacePage() {
  const [offers, setOffers] = useState<Offer[]>([]);
  const [history, setHistory] = useState<Redemption[]>([]);
  const [balance, setBalance] = useState(0);
  const [tab, setTab] = useState<'catalog' | 'history'>('catalog');
  const [search, setSearch] = useState('');
  const [type, setType] = useState('all');
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState<RedemptionResult | null>(null);
  const [copied, setCopied] = useState('');
  const [qrOpen, setQrOpen] = useState('');

  const load = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    setError('');
    const [market, redemptions] = await Promise.all([
      supabase.rpc('get_reward_marketplace'),
      supabase.rpc('get_my_reward_redemptions'),
    ]);
    if (market.error || redemptions.error) {
      setError(market.error?.message || redemptions.error?.message || 'No fue posible cargar los premios.');
      setLoading(false);
      return;
    }
    const payload = (market.data ?? {}) as { balance?: number; offers?: Offer[] };
    setBalance(Number(payload.balance ?? 0));
    setOffers((payload.offers ?? []) as Offer[]);
    setHistory((redemptions.data ?? []) as Redemption[]);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const visible = useMemo(() => offers.filter((o) => {
    const q = search.trim().toLowerCase();
    return (type === 'all' || o.reward_type === type) && (!q || `${o.title} ${o.provider_name} ${o.description ?? ''}`.toLowerCase().includes(q));
  }), [offers, search, type]);

  const copyText = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(value);
      window.setTimeout(() => setCopied(''), 1600);
    } catch {
      setCopied('');
    }
  };

  const redeem = async (offer: Offer) => {
    if (!supabase || !offer.can_redeem) return;
    if (!window.confirm(`Canjear “${offer.title}” por ${fmt(offer.coin_cost)} DadoCoins?`)) return;
    setActing(offer.id);
    setError('');
    const { data, error: e } = await supabase.rpc('redeem_reward', { p_reward_id: offer.id });
    setActing('');
    if (e) {
      setError(e.message);
      return;
    }
    setSuccess((data ?? null) as RedemptionResult | null);
    await load();
    setTab('history');
  };

  const buttonLabel = (o: Offer) => {
    if (o.availability_status === 'sold_out') return 'Agotado';
    if (o.availability_status === 'limit_reached') return 'Límite alcanzado';
    if (o.availability_status === 'insufficient_balance') return `Te faltan ${fmt(Math.max(0, o.coin_cost - balance))} DC`;
    return acting === o.id ? 'Canjeando…' : `Canjear · ${fmt(o.coin_cost)} DC`;
  };

  return <div className="rewards-page-v15"><AppHeader/><main className="rewards-shell-v15">
    <section className="rewards-hero-v15"><div><span className="eyebrow">DADOFIT REWARDS</span><h1>Convierte tu esfuerzo en premios.</h1><p>Canjea tus DadoCoins por beneficios creados por Gyms y marcas verificadas.</p></div><div className="rewards-balance-v15"><Coins size={20}/><span>Tu saldo</span><strong>{fmt(balance)} DC</strong></div></section>
    <div className="rewards-tabs-v15"><button className={tab === 'catalog' ? 'active' : ''} onClick={() => setTab('catalog')}><Gift size={16}/> Premios</button><button className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}><History size={16}/> Mis canjes <span>{history.length}</span></button><button className="rewards-refresh-v15" onClick={() => void load()}><RefreshCw size={15}/> Actualizar</button></div>
    {error && <div className="auth-error">{error}</div>}
    {success && <div className="rewards-success-v15 reward-success-detail-v151"><CheckCircle2 size={18}/><div><strong>Canje confirmado: {success.title}</strong><span>Referencia DadoFit {success.redemption_reference ?? '—'} · Nuevo saldo {fmt(success.new_balance)} DC</span>{success.redemption_code && <span className="reward-delivery-line-v151">Código promocional: <b>{success.redemption_code}</b> <button type="button" onClick={() => void copyText(success.redemption_code!)}><Clipboard size={13}/>{copied === success.redemption_code ? 'Copiado' : 'Copiar'}</button></span>}{success.redemption_url && <a className="reward-open-link-v151" href={success.redemption_url} target="_blank" rel="noreferrer"><ExternalLink size={14}/> Abrir página de redención</a>}</div><button className="reward-success-close-v151" onClick={() => setSuccess(null)}>×</button></div>}

    {tab === 'catalog' ? <>
      <section className="rewards-toolbar-v15"><label><Search size={16}/><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar premio o marca…"/></label><select value={type} onChange={(e) => setType(e.target.value)}><option value="all">Todos los premios</option>{Object.entries(typeLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></section>
      {loading ? <div className="rewards-empty-v15">Cargando catálogo…</div> : visible.length === 0 ? <div className="rewards-empty-v15"><Gift size={28}/><strong>No encontramos premios con estos filtros.</strong></div> : <section className="rewards-grid-v15">{visible.map((o) => <article className="reward-card-v15" key={o.id}>
        <div className="reward-image-v15">{o.image_url ? <img src={o.image_url} alt=""/> : <Gift size={38}/>}<span>{typeLabels[o.reward_type] ?? 'Premio'}</span></div>
        <div className="reward-body-v15"><div className="reward-provider-v15"><Store size={14}/><span>{o.provider_name}</span><i>{o.provider_type === 'gym' ? 'GYM' : 'PARTNER'}</i></div><h2>{o.title}</h2><p>{o.description || 'Beneficio exclusivo dentro del ecosistema DadoFit.'}</p>
          <div className="reward-meta-v15"><span><Ticket size={14}/>{fulfillmentLabels[o.fulfillment_type] ?? 'Canje'}</span><span><Package size={14}/>{o.remaining_stock === null ? 'Stock abierto' : `${o.remaining_stock} disponibles`}</span></div>
          <div className="reward-footer-v15"><strong><Coins size={17}/>{fmt(o.coin_cost)} DC</strong><button disabled={!o.can_redeem || acting === o.id} onClick={() => void redeem(o)}>{buttonLabel(o)}</button></div>
          <small>Máximo {o.max_per_user} {o.max_per_user === 1 ? 'canje' : 'canjes'} por Gymbro.</small>
        </div>
      </article>)}</section>}
    </> : <section className="redemptions-list-v15">{history.length === 0 ? <div className="rewards-empty-v15"><History size={28}/><strong>Aún no has canjeado premios.</strong><button onClick={() => setTab('catalog')}>Explorar premios</button></div> : history.map((r) => <article key={r.id}>
      <div className="redemption-icon-v15">{r.status === 'cancelled' ? <XCircle/> : <CheckCircle2/>}</div>
      <div className="redemption-main-v15"><span>{r.provider_name}</span><h3>{r.title}</h3><small>{date(r.created_at)} · {fmt(r.coin_cost)} DC · {fulfillmentLabels[r.fulfillment_type ?? ''] ?? 'Canje'}</small>{r.fulfillment_instructions && <p>{r.fulfillment_instructions}</p>}{r.redemption_code && <div className="redemption-benefit-v151"><span>Código promocional</span><strong>{r.redemption_code}</strong><button type="button" onClick={() => void copyText(r.redemption_code!)}><Clipboard size={13}/>{copied === r.redemption_code ? 'Copiado' : 'Copiar'}</button></div>}{r.redemption_url && <a className="reward-open-link-v151" href={r.redemption_url} target="_blank" rel="noreferrer"><ExternalLink size={14}/> Abrir beneficio</a>}
        {(r.fulfillment_type === 'in_person' || r.fulfillment_type === 'physical_product') && r.validation_token && r.status === 'issued' && <div className="reward-presential-v152"><button type="button" className="reward-show-qr-v152" onClick={() => setQrOpen(qrOpen === r.id ? '' : r.id)}><QrCode size={15}/>{qrOpen === r.id ? 'Ocultar QR' : 'Mostrar QR de entrega'}</button>{qrOpen === r.id && <div className="reward-qr-panel-v152"><RewardQrCode value={`${window.location.origin}/rewards/validate?token=${r.validation_token}`} size={190}/><div><strong>Preséntalo al partner</strong><span>El Owner/Admin debe escanear este QR antes de entregar el premio.</span><small>Referencia manual: {r.redemption_reference || '—'}</small></div></div>}</div>}
        {(r.fulfillment_type === 'in_person' || r.fulfillment_type === 'physical_product') && r.status === 'redeemed' && <div className="reward-delivered-v152"><CheckCircle2 size={15}/><span>Entregado {r.fulfilled_at ? date(r.fulfilled_at) : ''}</span>{r.fulfillment_notes && <small>{r.fulfillment_notes}</small>}</div>}
      </div>
      <div className="redemption-code-v15"><span>{r.status}</span><small>Referencia</small><strong>{r.redemption_reference || '—'}</strong>{r.expires_at && <small>Vence {date(r.expires_at)}</small>}</div>
    </article>)}</section>}
  </main></div>;
}
