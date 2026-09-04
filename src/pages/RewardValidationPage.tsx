import { CheckCircle2, Clock3, Gift, QrCode, RefreshCw, Search, ShieldCheck, UserRound, XCircle } from 'lucide-react';
import { type FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AppHeader } from '../components/AppHeader';
import { useWorkspace } from '../context/WorkspaceContext';
import { supabase } from '../lib/supabase';

type RedemptionRow = {
  id: string;
  reward_id: string;
  title: string;
  user_id: string;
  user_name: string;
  username: string | null;
  coin_cost: number;
  status: string;
  redemption_reference: string | null;
  validation_token: string;
  fulfillment_type: string;
  fulfillment_instructions?: string | null;
  created_at: string;
  issued_at: string | null;
  expires_at: string | null;
  fulfilled_at: string | null;
  fulfillment_notes: string | null;
};

const dateTime = (value: string | null) => value
  ? new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
  : '—';

const fmt = (value: number) => new Intl.NumberFormat('es-CO').format(Number(value || 0));

function normalizeLookup(raw: string) {
  const value = raw.trim();
  if (!value) return '';
  try {
    const url = new URL(value);
    return url.searchParams.get('token') || url.searchParams.get('reference') || value;
  } catch {
    return value;
  }
}

export function RewardValidationPage() {
  const { activeWorkspace } = useWorkspace();
  const [params, setParams] = useSearchParams();
  const manager = activeWorkspace.role === 'owner' || activeWorkspace.role === 'admin';
  const orgId = activeWorkspace.organizationId;
  const tokenFromUrl = params.get('token') ?? '';

  const [lookup, setLookup] = useState(tokenFromUrl);
  const [result, setResult] = useState<RedemptionRow | null>(null);
  const [pending, setPending] = useState<RedemptionRow[]>([]);
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [listLoading, setListLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const loadPending = useCallback(async () => {
    if (!supabase || !orgId || !manager) {
      setListLoading(false);
      return;
    }
    setListLoading(true);
    const { data, error: e } = await supabase.rpc('provider_list_reward_redemptions', {
      p_organization_id: orgId,
      p_status: 'issued',
    });
    if (e) setError(e.message);
    else setPending((data ?? []) as RedemptionRow[]);
    setListLoading(false);
  }, [manager, orgId]);

  const doLookup = useCallback(async (raw: string) => {
    if (!supabase) return;
    const clean = normalizeLookup(raw);
    if (!clean) return;
    setLoading(true);
    setError('');
    setSuccess('');
    const { data, error: e } = await supabase.rpc('provider_lookup_reward_redemption', { p_lookup: clean });
    setLoading(false);
    if (e) {
      setResult(null);
      setError(e.message);
      return;
    }
    setLookup(clean);
    setResult((data ?? null) as RedemptionRow | null);
  }, []);

  useEffect(() => { void loadPending(); }, [loadPending]);
  useEffect(() => {
    if (tokenFromUrl && manager) void doLookup(tokenFromUrl);
  }, [doLookup, manager, tokenFromUrl]);

  const submitLookup = (event: FormEvent) => {
    event.preventDefault();
    const clean = normalizeLookup(lookup);
    if (!clean) return;
    setParams(clean.includes('-') && clean.length > 20 ? { token: clean } : { reference: clean });
    void doLookup(clean);
  };

  const fulfill = async () => {
    if (!supabase || !result || result.status !== 'issued') return;
    if (!window.confirm(`Confirmar que ${result.user_name} recibió “${result.title}”?`)) return;
    setLoading(true);
    setError('');
    const { data, error: e } = await supabase.rpc('provider_fulfill_reward_redemption', {
      p_redemption_id: result.id,
      p_notes: notes || null,
    });
    setLoading(false);
    if (e) {
      setError(e.message);
      return;
    }
    const payload = (data ?? {}) as { fulfilled_at?: string; already_fulfilled?: boolean };
    setSuccess(payload.already_fulfilled ? 'Este canje ya había sido entregado.' : 'Entrega confirmada correctamente.');
    setResult((current) => current ? { ...current, status: 'redeemed', fulfilled_at: payload.fulfilled_at ?? new Date().toISOString(), fulfillment_notes: notes || null } : current);
    setNotes('');
    await loadPending();
  };

  const pendingCount = useMemo(() => pending.length, [pending]);

  if (!manager) {
    return <div className="workout-layout rewards-page-v15"><AppHeader/><main className="rewards-shell-v15"><div className="rewards-empty-v15"><ShieldCheck/><strong>Selecciona un workspace Gym/Marca donde seas Owner/Admin para validar entregas.</strong></div></main></div>;
  }

  return <div className="workout-layout rewards-page-v15"><AppHeader/><main className="rewards-shell-v15 reward-validation-shell-v152">
    <section className="rewards-hero-v15 reward-validation-hero-v152">
      <div><span className="eyebrow">REWARDS FULFILLMENT</span><h1>Validar canjes presenciales.</h1><p>Escanea el QR del Gymbro o ingresa su referencia DadoFit antes de entregar el premio.</p></div>
      <div className="provider-status-v15"><QrCode size={19}/><span>Pendientes</span><strong>{pendingCount}</strong></div>
    </section>

    {error && <div className="auth-error">{error}</div>}
    {success && <div className="rewards-success-v15"><CheckCircle2 size={18}/><strong>{success}</strong></div>}

    <section className="reward-validator-v152">
      <header><div><span className="eyebrow">ESCANEO / BÚSQUEDA</span><h2>Verificar un premio</h2></div><button onClick={() => void loadPending()}><RefreshCw size={15}/> Actualizar</button></header>
      <form onSubmit={submitLookup} className="reward-lookup-v152">
        <label><Search size={17}/><input value={lookup} onChange={(e) => setLookup(e.target.value)} placeholder="Pega el token, URL del QR o referencia DF-…"/></label>
        <button type="submit" disabled={loading}>{loading ? 'Verificando…' : 'Verificar'}</button>
      </form>

      {result && <article className={`reward-validation-card-v152 ${result.status}`}>
        <div className="reward-validation-status-v152">{result.status === 'redeemed' ? <CheckCircle2/> : result.status === 'cancelled' ? <XCircle/> : <Clock3/>}<span>{result.status === 'issued' ? 'PENDIENTE DE ENTREGA' : result.status === 'redeemed' ? 'ENTREGADO' : result.status.toUpperCase()}</span></div>
        <div className="reward-validation-grid-v152">
          <div><small>PREMIO</small><strong>{result.title}</strong><span>{fmt(result.coin_cost)} DC</span></div>
          <div><small>GYMBRO</small><strong><UserRound size={15}/>{result.user_name}</strong><span>{result.username ? `@${result.username}` : 'Usuario DadoFit'}</span></div>
          <div><small>REFERENCIA</small><strong className="mono">{result.redemption_reference || '—'}</strong><span>Emitido {dateTime(result.issued_at || result.created_at)}</span></div>
          <div><small>VIGENCIA</small><strong>{result.expires_at ? dateTime(result.expires_at) : 'Sin vencimiento'}</strong><span>{result.fulfilled_at ? `Entregado ${dateTime(result.fulfilled_at)}` : 'Aún no entregado'}</span></div>
        </div>
        {result.fulfillment_instructions && <p className="reward-validation-instructions-v152">{result.fulfillment_instructions}</p>}
        {result.status === 'issued' && <div className="reward-validation-confirm-v152"><label>Nota de entrega <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Opcional: sede, asesor, observación…"/></label><button onClick={() => void fulfill()} disabled={loading}><ShieldCheck size={17}/> Confirmar entrega</button></div>}
        {result.status === 'redeemed' && <div className="reward-validation-done-v152"><CheckCircle2 size={18}/><div><strong>Este premio ya fue entregado.</strong><span>{dateTime(result.fulfilled_at)}{result.fulfillment_notes ? ` · ${result.fulfillment_notes}` : ''}</span></div></div>}
      </article>}
    </section>

    <section className="reward-pending-v152">
      <header><div><span className="eyebrow">COLA DE ENTREGA</span><h2>Canjes pendientes</h2></div><span>{pendingCount} por entregar</span></header>
      {listLoading ? <div className="rewards-empty-v15">Cargando canjes…</div> : pending.length === 0 ? <div className="rewards-empty-v15"><Gift/><strong>No hay premios pendientes de entrega.</strong></div> : <div className="reward-pending-list-v152">{pending.map((item) => <article key={item.id}>
        <div><span>{item.user_name}{item.username ? ` · @${item.username}` : ''}</span><h3>{item.title}</h3><small>{item.redemption_reference || 'Sin referencia'} · {dateTime(item.created_at)}</small></div>
        <button onClick={() => { setLookup(item.validation_token); setParams({ token: item.validation_token }); void doLookup(item.validation_token); }}><QrCode size={15}/> Validar</button>
      </article>)}</div>}
    </section>
  </main></div>;
}
