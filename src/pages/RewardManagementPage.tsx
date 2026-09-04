import { Coins, Edit3, FileUp, Gift, KeyRound, Link2, Pause, Play, Plus, QrCode, RefreshCw, Save, Store, X } from 'lucide-react';
import { type ChangeEvent, type FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AppHeader } from '../components/AppHeader';
import { useWorkspace } from '../context/WorkspaceContext';
import { supabase } from '../lib/supabase';

type FulfillmentType = 'digital_code' | 'digital_benefit' | 'physical_product' | 'in_person';
type FulfillmentMode = 'generated_code' | 'shared_code' | 'code_pool' | 'redemption_url' | 'instructions_only';

type RewardRow = {
  id: string;
  title: string;
  description: string | null;
  reward_type: string;
  coin_cost: number;
  inventory: number | null;
  max_per_user: number;
  status: string;
  starts_at: string | null;
  ends_at: string | null;
  image_url: string | null;
  fulfillment_type: FulfillmentType;
  fulfillment_mode: FulfillmentMode;
  shared_code: string | null;
  redemption_url: string | null;
  fulfillment_instructions: string | null;
  terms: string | null;
  redemptions: number;
  remaining_stock: number | null;
  code_pool_total: number;
  code_pool_available: number;
  code_pool_assigned: number;
};

type RewardForm = {
  title: string;
  description: string;
  rewardType: string;
  coinCost: string;
  inventory: string;
  maxPerUser: string;
  imageUrl: string;
  fulfillmentType: FulfillmentType;
  fulfillmentMode: FulfillmentMode;
  sharedCode: string;
  redemptionUrl: string;
  couponCodes: string;
  instructions: string;
  terms: string;
  start: string;
  end: string;
};

const empty: RewardForm = {
  title: '',
  description: '',
  rewardType: 'discount',
  coinCost: '250',
  inventory: '50',
  maxPerUser: '1',
  imageUrl: '',
  fulfillmentType: 'digital_code',
  fulfillmentMode: 'shared_code',
  sharedCode: '',
  redemptionUrl: '',
  couponCodes: '',
  instructions: '',
  terms: '',
  start: '',
  end: '',
};

const fmt = (v: number) => new Intl.NumberFormat('es-CO').format(Number(v || 0));
const toInput = (v: string | null) => {
  if (!v) return '';
  const d = new Date(v);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

function defaultModeForType(type: FulfillmentType): FulfillmentMode {
  if (type === 'digital_code') return 'shared_code';
  if (type === 'digital_benefit') return 'redemption_url';
  return 'instructions_only';
}

function modesForType(type: FulfillmentType): Array<{ value: FulfillmentMode; label: string }> {
  if (type === 'digital_code') {
    return [
      { value: 'shared_code', label: 'Un código para todos' },
      { value: 'code_pool', label: 'Pool de códigos únicos' },
      { value: 'generated_code', label: 'Código generado por DadoFit' },
    ];
  }
  if (type === 'digital_benefit') {
    return [
      { value: 'redemption_url', label: 'URL / página de redención' },
      { value: 'shared_code', label: 'Código compartido' },
      { value: 'code_pool', label: 'Pool de códigos únicos' },
      { value: 'instructions_only', label: 'Solo instrucciones' },
    ];
  }
  return [{ value: 'instructions_only', label: 'Entrega coordinada / instrucciones' }];
}

const modeLabels: Record<FulfillmentMode, string> = {
  generated_code: 'Código DadoFit',
  shared_code: 'Código compartido',
  code_pool: 'Pool único',
  redemption_url: 'Link de redención',
  instructions_only: 'Instrucciones',
};

export function RewardManagementPage() {
  const { activeWorkspace } = useWorkspace();
  const orgId = activeWorkspace.organizationId;
  const manager = activeWorkspace.role === 'owner' || activeWorkspace.role === 'admin';
  const verified = activeWorkspace.verificationStatus === 'verified';
  const [rows, setRows] = useState<RewardRow[]>([]);
  const [form, setForm] = useState<RewardForm>(empty);
  const [editing, setEditing] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!supabase || !orgId || !manager) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    const { data, error: e } = await supabase.rpc('provider_list_rewards', { p_organization_id: orgId });
    if (e) setError(e.message);
    else setRows((data ?? []) as RewardRow[]);
    setLoading(false);
  }, [manager, orgId]);

  useEffect(() => { void load(); }, [load]);

  const editingRow = useMemo(() => rows.find((row) => row.id === editing) ?? null, [editing, rows]);
  const modeOptions = modesForType(form.fulfillmentType);

  const reset = () => {
    setEditing(null);
    setForm(empty);
  };

  const edit = (r: RewardRow) => {
    setEditing(r.id);
    setForm({
      title: r.title,
      description: r.description ?? '',
      rewardType: r.reward_type,
      coinCost: String(r.coin_cost),
      inventory: r.inventory === null ? '' : String(r.inventory),
      maxPerUser: String(r.max_per_user),
      imageUrl: r.image_url ?? '',
      fulfillmentType: r.fulfillment_type,
      fulfillmentMode: r.fulfillment_mode ?? defaultModeForType(r.fulfillment_type),
      sharedCode: r.shared_code ?? '',
      redemptionUrl: r.redemption_url ?? '',
      couponCodes: '',
      instructions: r.fulfillment_instructions ?? '',
      terms: r.terms ?? '',
      start: toInput(r.starts_at),
      end: toInput(r.ends_at),
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const changeFulfillmentType = (value: FulfillmentType) => {
    setForm((current) => ({
      ...current,
      fulfillmentType: value,
      fulfillmentMode: defaultModeForType(value),
    }));
  };

  const importCodes = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setForm((current) => ({ ...current, couponCodes: text }));
    event.target.value = '';
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!supabase || !orgId) return;
    setError('');

    const args = {
      p_title: form.title,
      p_description: form.description || null,
      p_reward_type: form.rewardType,
      p_coin_cost: Number(form.coinCost),
      p_inventory: form.inventory === '' ? null : Number(form.inventory),
      p_max_per_user: Number(form.maxPerUser),
      p_image_url: form.imageUrl || null,
      p_fulfillment_type: form.fulfillmentType,
      p_fulfillment_instructions: form.instructions || null,
      p_terms: form.terms || null,
      p_starts_at: form.start ? new Date(form.start).toISOString() : null,
      p_ends_at: form.end ? new Date(form.end).toISOString() : null,
      p_fulfillment_mode: form.fulfillmentMode,
      p_shared_code: form.fulfillmentMode === 'shared_code' ? form.sharedCode || null : null,
      p_redemption_url: form.fulfillmentMode === 'redemption_url' ? form.redemptionUrl || null : null,
      p_coupon_codes: form.fulfillmentMode === 'code_pool' ? form.couponCodes || null : null,
    };

    const res = editing
      ? await supabase.rpc('provider_update_reward', { p_reward_id: editing, ...args })
      : await supabase.rpc('provider_create_reward', { p_organization_id: orgId, ...args });

    if (res.error) {
      setError(res.error.message);
      return;
    }
    reset();
    await load();
  };

  const status = async (id: string, next: string) => {
    if (!supabase) return;
    const { error: e } = await supabase.rpc('provider_set_reward_status', { p_reward_id: id, p_status: next });
    if (e) alert(e.message);
    else await load();
  };

  if (!manager) {
    return <div className="workout-layout rewards-page-v15"><AppHeader/><main className="rewards-shell-v15"><div className="rewards-empty-v15"><Gift/><strong>Solo Owner/Admin puede administrar ofertas.</strong></div></main></div>;
  }

  return <div className="workout-layout rewards-page-v15"><AppHeader/><main className="rewards-shell-v15">
    <section className="rewards-hero-v15 provider-hero-v15">
      <div><span className="eyebrow">REWARDS PARTNER</span><h1>Ofertas de {activeWorkspace.label}</h1><p>Crea beneficios para que los Gymbros conviertan sus DadoCoins en valor real.</p></div>
      <div className="provider-hero-actions-v152"><Link to="/rewards/validate" className="provider-validate-link-v152"><QrCode size={17}/> Validar canjes</Link><div className="provider-status-v15"><Store size={19}/><span>Estado</span><strong>{verified ? 'VERIFICADO' : 'SIN VERIFICAR'}</strong></div></div>
    </section>
    {!verified && <div className="reward-warning-v15">Puedes preparar borradores, pero la organización debe estar verificada para publicar premios.</div>}
    {error && <div className="auth-error">{error}</div>}

    <div className="reward-management-grid-v15">
      <form className="reward-editor-v15" onSubmit={(e) => void submit(e)}>
        <div className="reward-editor-head-v15">
          <div><span className="eyebrow">{editing ? 'EDITANDO OFERTA' : 'NUEVA OFERTA'}</span><h2>{editing ? 'Modificar premio' : 'Crear premio'}</h2></div>
          {editing && <button type="button" onClick={reset}><X size={15}/> Cancelar</button>}
        </div>

        <label>Nombre del premio<input required maxLength={160} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Ej. Bono de $50.000"/></label>
        <label>Descripción<textarea rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Explica qué recibe el Gymbro."/></label>

        <div className="reward-form-row-v15">
          <label>Tipo<select value={form.rewardType} onChange={(e) => setForm({ ...form, rewardType: e.target.value })}><option value="discount">Descuento</option><option value="product">Producto</option><option value="gym_pass">Pase de Gym</option><option value="subscription">Suscripción</option><option value="experience">Experiencia</option><option value="other">Otro</option></select></label>
          <label>Costo DC<input type="number" min="1" required value={form.coinCost} onChange={(e) => setForm({ ...form, coinCost: e.target.value })}/></label>
        </div>

        <div className="reward-form-row-v15">
          <label>Stock<input type="number" min="0" value={form.inventory} onChange={(e) => setForm({ ...form, inventory: e.target.value })} placeholder="Vacío = ilimitado"/></label>
          <label>Máx. por usuario<input type="number" min="1" max="1000" required value={form.maxPerUser} onChange={(e) => setForm({ ...form, maxPerUser: e.target.value })}/></label>
        </div>

        <label>Imagen URL<input value={form.imageUrl} onChange={(e) => setForm({ ...form, imageUrl: e.target.value })} placeholder="https://..."/></label>
        <label>Tipo de entrega<select value={form.fulfillmentType} onChange={(e) => changeFulfillmentType(e.target.value as FulfillmentType)}><option value="digital_code">Código digital</option><option value="digital_benefit">Beneficio digital</option><option value="physical_product">Producto físico</option><option value="in_person">Canje presencial</option></select></label>
        <label>Modo del beneficio<select value={form.fulfillmentMode} onChange={(e) => setForm({ ...form, fulfillmentMode: e.target.value as FulfillmentMode })}>{modeOptions.map((mode) => <option key={mode.value} value={mode.value}>{mode.label}</option>)}</select></label>

        {form.fulfillmentMode === 'shared_code' && <div className="fulfillment-box-v151"><KeyRound size={18}/><label>Código promocional compartido<input value={form.sharedCode} onChange={(e) => setForm({ ...form, sharedCode: e.target.value })} placeholder="Ej. DADOFIT20"/><small>Todos los Gymbros que canjeen esta oferta reciben el mismo código.</small></label></div>}

        {form.fulfillmentMode === 'code_pool' && <div className="fulfillment-box-v151 code-pool-box-v151"><KeyRound size={18}/><div className="fulfillment-field-v151"><strong>Pool de códigos únicos</strong>{editingRow && <span className="coupon-stats-v151">{editingRow.code_pool_available} disponibles · {editingRow.code_pool_assigned} asignados · {editingRow.code_pool_total} cargados</span>}<textarea rows={5} value={form.couponCodes} onChange={(e) => setForm({ ...form, couponCodes: e.target.value })} placeholder={'NIKE-A82K\nNIKE-B91F\nNIKE-C74X'}/><div className="coupon-import-row-v151"><small>Uno por línea, coma o punto y coma. Al editar, solo agrega códigos nuevos.</small><label className="coupon-file-v151"><FileUp size={15}/> Importar CSV<input type="file" accept=".csv,.txt,text/csv,text/plain" onChange={(e) => void importCodes(e)}/></label></div></div></div>}

        {form.fulfillmentMode === 'redemption_url' && <div className="fulfillment-box-v151"><Link2 size={18}/><label>URL de redención<input type="url" value={form.redemptionUrl} onChange={(e) => setForm({ ...form, redemptionUrl: e.target.value })} placeholder="https://marca.com/dadofit"/><small>El link solo se revela después de descontar los DadoCoins.</small></label></div>}

        {form.fulfillmentMode === 'generated_code' && <div className="fulfillment-note-v151">DadoFit generará un código interno único. Úsalo para beneficios administrados directamente por DadoFit o para pruebas; para ecommerce real recomendamos código compartido o pool.</div>}

        <label>Instrucciones de canje<textarea rows={2} value={form.instructions} onChange={(e) => setForm({ ...form, instructions: e.target.value })} placeholder="Ej. ingresa el código en el checkout o preséntalo en recepción."/></label>
        <label>Términos<textarea rows={2} value={form.terms} onChange={(e) => setForm({ ...form, terms: e.target.value })} placeholder="Condiciones, restricciones, sedes, etc."/></label>
        <div className="reward-form-row-v15"><label>Inicio<input type="datetime-local" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })}/></label><label>Fin<input type="datetime-local" value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })}/></label></div>
        <button className="reward-save-v15" type="submit">{editing ? <Save size={16}/> : <Plus size={16}/>} {editing ? 'Guardar cambios' : 'Crear en borrador'}</button>
      </form>

      <section className="provider-rewards-v15">
        <header><div><span className="eyebrow">CATÁLOGO DEL PARTNER</span><h2>Control de ofertas</h2></div><button onClick={() => void load()}><RefreshCw size={15}/> Actualizar</button></header>
        {loading ? <div className="rewards-empty-v15">Cargando ofertas…</div> : rows.length === 0 ? <div className="rewards-empty-v15"><Gift/><strong>Aún no has creado premios.</strong></div> : rows.map((r) => <article key={r.id}>
          <div className="provider-reward-image-v15">{r.image_url ? <img src={r.image_url} alt=""/> : <Gift/>}</div>
          <div className="provider-reward-copy-v15">
            <span>{r.status}</span><h3>{r.title}</h3>
            <p><Coins size={14}/>{fmt(r.coin_cost)} DC · {r.redemptions} canjes · {r.remaining_stock === null ? 'stock abierto' : `${r.remaining_stock} disponibles`}</p>
            <div className="provider-fulfillment-v151"><KeyRound size={12}/><span>{modeLabels[r.fulfillment_mode ?? 'generated_code']}</span>{r.fulfillment_mode === 'code_pool' && <b>{r.code_pool_available} libres / {r.code_pool_total} cargados</b>}</div>
          </div>
          <div className="provider-reward-actions-v15"><button onClick={() => edit(r)}><Edit3 size={15}/> Editar</button>{r.status === 'active' ? <button onClick={() => void status(r.id, 'paused')}><Pause size={15}/> Pausar</button> : r.status !== 'ended' ? <button className="primary" onClick={() => void status(r.id, 'active')}><Play size={15}/> Publicar</button> : null}{r.status !== 'ended' && <button onClick={() => void status(r.id, 'ended')}>Finalizar</button>}</div>
        </article>)}
      </section>
    </div>
  </main></div>;
}
