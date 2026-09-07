import { Building2, CalendarDays, CheckCircle2, Pencil, RefreshCw, Save, Send, Sparkles, Trophy, UsersRound, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { AppHeader } from '../components/AppHeader';
import { useWorkspace } from '../context/WorkspaceContext';
import { canManageBrandRole } from '../lib/sponsoredRules';
import { supabase } from '../lib/supabase';

type Gym = { id: string; name: string; verification_status: string };
type Entry = { organization_id: string; organization_name: string; status: string; points: number };
type Competition = { id: string; name: string; description: string | null; status: string; starts_at: string; ends_at: string; entries: Entry[] };

const date = (value: string) => new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium' }).format(new Date(value));
const fmt = (value: number) => new Intl.NumberFormat('es-CO').format(Number(value || 0));
const inputValue = (dateValue: Date) => {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${dateValue.getFullYear()}-${pad(dateValue.getMonth() + 1)}-${pad(dateValue.getDate())}T${pad(dateValue.getHours())}:${pad(dateValue.getMinutes())}`;
};

function initialDates() {
  const start = new Date();
  start.setMinutes(0, 0, 0);
  start.setHours(start.getHours() + 1);
  const end = new Date(start);
  end.setDate(end.getDate() + 14);
  return { start: inputValue(start), end: inputValue(end) };
}

export function BrandCompetitionsPage() {
  const { activeWorkspace } = useWorkspace();
  const orgId = activeWorkspace.organizationId;
  const canManage = canManageBrandRole(activeWorkspace.role);
  const [gyms, setGyms] = useState<Gym[]>([]);
  const [competitions, setCompetitions] = useState<Competition[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [{ start, end }, setDates] = useState(initialDates);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    if (!supabase || !orgId) return;
    setLoading(true); setError('');
    const [gymResult, competitionResult] = await Promise.all([
      supabase.from('organizations').select('id,name,verification_status').eq('organization_type', 'gym').eq('verification_status', 'verified').order('name'),
      supabase.rpc('brand_list_sponsored_gym_competitions', { p_organization_id: orgId }),
    ]);
    if (gymResult.error || competitionResult.error) setError(gymResult.error?.message || competitionResult.error?.message || 'No fue posible cargar las competencias.');
    else {
      setGyms((gymResult.data ?? []) as Gym[]);
      setCompetitions((competitionResult.data ?? []) as Competition[]);
    }
    setLoading(false);
  }, [orgId]);

  useEffect(() => { void load(); }, [load]);

  const toggle = (id: string) => setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);

  const resetForm = () => {
    setEditingId(null);
    setName('');
    setDescription('');
    setSelected([]);
    setDates(initialDates());
    setError('');
  };

  const editCompetition = (item: Competition) => {
    if (!['upcoming', 'active'].includes(item.status)) return;
    setEditingId(item.id);
    setName(item.name);
    setDescription(item.description ?? '');
    setSelected(item.entries.filter((entry) => entry.status !== 'removed').map((entry) => entry.organization_id));
    setDates({ start: inputValue(new Date(item.starts_at)), end: inputValue(new Date(item.ends_at)) });
    setError('');
    setMessage('');
    requestAnimationFrame(() => document.querySelector('.brand-competition-form-v157')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!supabase || !orgId || !canManage) return;
    if (selected.length < 2) { setError('Selecciona al menos dos Gyms verificados.'); return; }
    setSaving(true); setError(''); setMessage('');
    const payload = {
      p_organization_id: orgId,
      p_name: name.trim(),
      p_description: description.trim() || null,
      p_starts_at: new Date(start).toISOString(),
      p_ends_at: new Date(end).toISOString(),
      p_gym_ids: selected,
    };
    const { error: rpcError } = editingId
      ? await supabase.rpc('brand_update_sponsored_gym_competition', { ...payload, p_season_id: editingId })
      : await supabase.rpc('brand_create_sponsored_gym_competition', payload);
    setSaving(false);
    if (rpcError) { setError(rpcError.message); return; }
    setMessage(editingId
      ? 'Competencia actualizada. Los cambios quedaron guardados antes de su inicio.'
      : 'Competencia creada. Los Owner/Admin de los Gyms seleccionados recibieron una invitación.');
    resetForm();
    await load();
  };

  const activeCount = useMemo(() => competitions.filter((item) => item.status === 'active').length, [competitions]);
  const editingCompetition = useMemo(() => competitions.find((item) => item.id === editingId) ?? null, [competitions, editingId]);
  const editingActive = editingCompetition?.status === 'active';
  const gymRequirementMessage = gyms.length < 2
    ? `Necesitas al menos 2 Gyms verificados para crear una competencia. Ahora hay ${gyms.length} disponible${gyms.length === 1 ? '' : 's'}.`
    : selected.length < 2
      ? `Selecciona al menos 2 Gyms para habilitar la creación. Llevas ${selected.length} seleccionado${selected.length === 1 ? '' : 's'}.`
      : '';

  return <div className="profile-shell-v9 brand-competition-shell-v157"><AppHeader/><main className="profile-page-v9 brand-competition-page-v157">
    <section className="brand-competition-hero-v157"><div><span className="eyebrow">SPONSORED GYM COMPETITIONS</span><h1>Competencias patrocinadas</h1><p>Invita Gyms verificados a competir por GP durante una ventana definida. Los puntos se calculan desde el ledger real de DadoFit.</p></div><div><span>Activas</span><strong>{activeCount}</strong></div></section>
    {error && <div className="auth-error">{error}</div>}{message && <div className="auth-success">{message}</div>}

    <section className="brand-competition-grid-v157">
      <form className="profile-card-v9 brand-competition-form-v157" onSubmit={save}><span className="eyebrow">{editingId ? 'EDITAR ACTIVACIÓN' : 'NUEVA ACTIVACIÓN'}</span><h2>{editingId ? 'Editar competencia Gym' : 'Crear competencia Gym'}</h2>{editingId && <div className="brand-competition-edit-note-v157">{editingActive ? 'La competencia ya está en curso: puedes corregir nombre y descripción. Fechas y Gyms quedan bloqueados para proteger el ranking GP.' : 'Puedes corregir nombre, fechas y Gyms antes de que la competencia inicie.'}</div>}<label>Nombre<input required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} placeholder="Ej. Adidas Gym League · Septiembre"/></label><label>Descripción<textarea rows={3} maxLength={1000} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Objetivo, dinámica o premio comercial de la activación."/></label><div className="brand-competition-dates-v157"><label>Inicio<input type="datetime-local" required disabled={editingActive} value={start} onChange={(event) => setDates((current) => ({ ...current, start: event.target.value }))}/></label><label>Fin<input type="datetime-local" required disabled={editingActive} value={end} onChange={(event) => setDates((current) => ({ ...current, end: event.target.value }))}/></label></div><fieldset><legend>Gyms invitados <small>{selected.length} seleccionados</small></legend>{gyms.length === 0 ? <p>No hay Gyms verificados disponibles.</p> : <div className="brand-gym-picker-v157">{gyms.map((gym) => <label key={gym.id} className={selected.includes(gym.id) ? 'selected' : ''}><input type="checkbox" checked={selected.includes(gym.id)} disabled={editingActive} onChange={() => toggle(gym.id)}/><Building2 size={16}/><span>{gym.name}</span>{selected.includes(gym.id) && <CheckCircle2 size={15}/>}</label>)}</div>}</fieldset>{gymRequirementMessage && <div className="brand-competition-requirement-v157" role="status">{gymRequirementMessage}</div>}<div className="brand-competition-form-actions-v157"><button type="submit" disabled={!canManage || saving || selected.length < 2} title={gymRequirementMessage || undefined}>{editingId ? <Save size={15}/> : <Send size={15}/>} {saving ? (editingId ? 'Guardando…' : 'Creando…') : (editingId ? 'Guardar cambios' : 'Crear e invitar Gyms')}</button>{editingId && <button type="button" className="secondary" onClick={resetForm} disabled={saving}><X size={15}/> Cancelar edición</button>}</div>{!canManage && <small>Solo Owner/Admin puede crear o editar competencias patrocinadas.</small>}</form>

      <section className="profile-card-v9 brand-competition-list-v157"><header><div><span className="eyebrow">HISTÓRICO</span><h2>Competencias de {activeWorkspace.label}</h2></div><button type="button" onClick={() => void load()} disabled={loading}><RefreshCw size={15}/></button></header>{loading ? <div className="season-empty-v157">Cargando competencias…</div> : competitions.length === 0 ? <div className="season-empty-v157"><Sparkles size={24}/><strong>Aún no has creado competencias.</strong></div> : <div>{competitions.map((item) => { const visibleEntries = item.entries.filter((entry) => entry.status !== 'removed'); return <article key={item.id}><header><div><strong>{item.name}</strong><span>{date(item.starts_at)} → {date(item.ends_at)}</span></div><div className="brand-competition-card-actions-v157"><span className={`season-status-v157 ${item.status}`}>{item.status}</span>{canManage && ['upcoming', 'active'].includes(item.status) && <button type="button" onClick={() => editCompetition(item)}><Pencil size={13}/> Editar</button>}</div></header>{item.description && <p>{item.description}</p>}<div className="brand-competition-meta-v157"><span><CalendarDays size={14}/>{visibleEntries.length} Gyms invitados</span><span><UsersRound size={14}/>{visibleEntries.filter((entry) => entry.status === 'active').length} aceptaron</span></div><div className="brand-competition-entries-v157">{visibleEntries.map((entry) => <div key={entry.organization_id}><span><Building2 size={14}/><strong>{entry.organization_name}</strong><small>{entry.status}</small></span><b>{fmt(entry.points)} GP</b></div>)}</div></article>; })}</div>}</section>
    </section>
  </main></div>;
}
