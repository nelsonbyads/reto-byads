import { ArrowLeft, Check, Clock3, Coins, FileVideo2, Image as ImageIcon, RefreshCw, Send, ShieldCheck, Sparkles, Trophy, Upload, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { AppHeader } from '../components/AppHeader';
import { ExerciseMedia } from '../components/ExerciseMedia';
import { useAuth } from '../auth/AuthContext';
import { useWorkspace } from '../context/WorkspaceContext';
import { supabase } from '../lib/supabase';
import { useExercises } from '../hooks/useExercises';
import { EMPTY_FILTERS } from '../lib/filters';
import { formatSponsoredGoal, readSponsoredGoal } from '../lib/sponsoredGoals';

interface ChallengeRow {
  id: string;
  creator_organization_id: string | null;
  sponsor_campaign_id: string | null;
  title: string | null;
  description: string | null;
  exercise_id: string;
  exercise_name: string;
  reps: number;
  expires_at: string | null;
  reward_coins: number;
  reward_xp: number;
  max_participants: number | null;
  created_at: string;
  metadata: Record<string, unknown> | null;
}
interface CampaignRow { id: string; organization_id: string; name: string; description: string | null; status: string; }
interface OrganizationRow { id: string; name: string; logo_url: string | null; verification_status: string | null; }
interface ParticipantRow { id: string; challenge_id: string; user_id: string; status: string; submitted_at: string | null; completed_at: string | null; reward_coins_granted: number; reward_xp_granted: number; reward_block_reason: string | null; }
interface EvidenceRow { id: string; participant_id: string; evidence_kind: 'image' | 'video'; storage_path: string; file_name: string | null; mime_type: string | null; size_bytes: number | null; created_at: string; }
interface EvidenceView extends EvidenceRow { signedUrl: string | null; }

function formatDate(value: string | null) {
  if (!value) return '—';
  try { return new Intl.DateTimeFormat('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(value)); } catch { return value; }
}
function formatBytes(bytes: number | null) {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
function statusLabel(status: string) {
  const labels: Record<string, string> = { accepted: 'En curso', submitted: 'En revisión', approved: 'Aprobado', rejected: 'Nueva evidencia', expired: 'Expirado' };
  return labels[status] ?? status;
}

function ParticipantEvidence({ participant, onChanged }: { participant: ParticipantRow; onChanged: () => Promise<void> }) {
  const { user } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<EvidenceView[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [acting, setActing] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const canUpload = ['accepted', 'rejected'].includes(participant.status);

  const load = useCallback(async () => {
    if (!supabase) return;
    const client = supabase;
    setLoading(true);
    const { data, error: queryError } = await client.from('challenge_evidence').select('id, participant_id, evidence_kind, storage_path, file_name, mime_type, size_bytes, created_at').eq('participant_id', participant.id).order('created_at', { ascending: false });
    if (queryError) { setError(queryError.message); setLoading(false); return; }
    const rows = (data ?? []) as EvidenceRow[];
    const hydrated = await Promise.all(rows.map(async (row): Promise<EvidenceView> => {
      const { data: signed } = await client.storage.from('challenge-evidence').createSignedUrl(row.storage_path, 3600);
      return { ...row, signedUrl: signed?.signedUrl ?? null };
    }));
    setItems(hydrated); setLoading(false);
  }, [participant.id]);

  useEffect(() => { void load(); }, [load]);

  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !user || user.provider !== 'supabase' || !supabase || !canUpload) return;
    if (file.size > 50 * 1024 * 1024) { setError('El archivo supera el límite de 50 MB.'); return; }
    if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) { setError('Sube una imagen o video compatible.'); return; }
    const client = supabase;
    setUploading(true); setError(''); setMessage('');
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '-').slice(-100) || 'evidence';
    const path = `${user.id}/${participant.id}/${crypto.randomUUID()}-${safeName}`;
    const { error: storageError } = await client.storage.from('challenge-evidence').upload(path, file, { contentType: file.type, upsert: false });
    if (storageError) { setUploading(false); setError(storageError.message); return; }
    const { error: rowError } = await client.from('challenge_evidence').insert({ participant_id: participant.id, evidence_kind: file.type.startsWith('image/') ? 'image' : 'video', storage_path: path, file_name: file.name, mime_type: file.type, size_bytes: file.size });
    if (rowError) { await client.storage.from('challenge-evidence').remove([path]); setUploading(false); setError(rowError.message); return; }
    setUploading(false); setMessage('Evidencia cargada. Ya puedes enviarla a la Marca.'); await load();
  };

  const remove = async (item: EvidenceView) => {
    if (!supabase || !canUpload || !window.confirm('¿Eliminar esta evidencia?')) return;
    const client = supabase;
    const { error: dbError } = await client.from('challenge_evidence').delete().eq('id', item.id);
    if (dbError) { setError(dbError.message); return; }
    await client.storage.from('challenge-evidence').remove([item.storage_path]);
    await load();
  };

  const submit = async () => {
    if (!supabase || !canUpload || items.length === 0) return;
    setActing(true); setError(''); setMessage('');
    const { error: rpcError } = await supabase.rpc('submit_sponsored_challenge', { p_participant_id: participant.id });
    setActing(false);
    if (rpcError) { setError(rpcError.message); return; }
    setMessage('Evidencia enviada a la Marca.');
    await onChanged();
  };

  return <div className="sponsored-evidence-v13">
    {error && <div className="auth-error">{error}</div>}{message && <div className="auth-success">{message}</div>}
    {canUpload && <div className="sponsored-evidence-head-v13"><strong>Evidencia obligatoria</strong><button type="button" onClick={() => inputRef.current?.click()} disabled={uploading}><Upload size={15}/>{uploading ? 'Subiendo…' : 'Agregar'}</button><input ref={inputRef} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm" onChange={(event) => { void upload(event); }}/></div>}
    {loading ? <p>Cargando evidencia…</p> : items.length === 0 ? <p className="sponsored-muted-v13">Aún no has adjuntado evidencia.</p> : <div className="sponsored-evidence-list-v13">{items.map((item) => <article key={item.id}><div>{item.signedUrl && item.evidence_kind === 'image' ? <img src={item.signedUrl} alt="Evidencia"/> : item.signedUrl ? <video src={item.signedUrl} controls preload="metadata"/> : item.evidence_kind === 'image' ? <ImageIcon/> : <FileVideo2/>}</div><span><strong>{item.file_name || 'Evidencia'}</strong><small>{formatBytes(item.size_bytes)} · {formatDate(item.created_at)}</small></span>{canUpload && <button type="button" onClick={() => { void remove(item); }}><X size={14}/></button>}</article>)}</div>}
    {canUpload && <button type="button" className="sponsored-submit-v13" disabled={acting || items.length === 0} onClick={() => { void submit(); }}><Send size={15}/>{participant.status === 'rejected' ? 'Volver a enviar' : 'Enviar a la Marca'}</button>}
  </div>;
}

export function SponsoredChallengesPage() {
  const { user } = useAuth();
  const { activeWorkspace } = useWorkspace();
  const [challenges, setChallenges] = useState<ChallengeRow[]>([]);
  const [campaigns, setCampaigns] = useState<Map<string, CampaignRow>>(new Map());
  const [organizations, setOrganizations] = useState<Map<string, OrganizationRow>>(new Map());
  const [participants, setParticipants] = useState<Map<string, ParticipantRow>>(new Map());
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const { exercises } = useExercises(EMPTY_FILTERS);
  const catalogById = useMemo(() => new Map(exercises.map((exercise) => [exercise.id, exercise])), [exercises]);

  const load = useCallback(async () => {
    if (!supabase || !user || user.provider !== 'supabase') { setLoading(false); return; }
    const client = supabase;
    setLoading(true); setError('');
    const now = new Date().toISOString();
    const challengeResult = await client.from('challenges').select('id, creator_organization_id, sponsor_campaign_id, title, description, exercise_id, exercise_name, reps, expires_at, reward_coins, reward_xp, max_participants, created_at, metadata').eq('challenge_type', 'sponsored').eq('status', 'active').gt('expires_at', now).order('created_at', { ascending: false });
    if (challengeResult.error) { setError(challengeResult.error.message); setLoading(false); return; }
    const challengeRows = (challengeResult.data ?? []) as ChallengeRow[];
    setChallenges(challengeRows);
    const campaignIds = [...new Set(challengeRows.map((item) => item.sponsor_campaign_id).filter((value): value is string => Boolean(value)))];
    const orgIds = [...new Set(challengeRows.map((item) => item.creator_organization_id).filter((value): value is string => Boolean(value)))];
    const challengeIds = challengeRows.map((item) => item.id);
    const [campaignResult, orgResult, participantResult] = await Promise.all([
      campaignIds.length ? client.from('sponsor_campaigns').select('id, organization_id, name, description, status').in('id', campaignIds) : Promise.resolve({ data: [] as CampaignRow[], error: null }),
      orgIds.length ? client.from('organizations').select('id, name, logo_url, verification_status').in('id', orgIds) : Promise.resolve({ data: [] as OrganizationRow[], error: null }),
      challengeIds.length ? client.from('challenge_participants').select('id, challenge_id, user_id, status, submitted_at, completed_at, reward_coins_granted, reward_xp_granted, reward_block_reason').eq('user_id', user.id).in('challenge_id', challengeIds) : Promise.resolve({ data: [] as ParticipantRow[], error: null }),
    ]);
    const secondError = campaignResult.error ?? orgResult.error ?? participantResult.error;
    if (secondError) setError(secondError.message);
    setCampaigns(new Map(((campaignResult.data ?? []) as CampaignRow[]).map((item) => [item.id, item])));
    setOrganizations(new Map(((orgResult.data ?? []) as OrganizationRow[]).map((item) => [item.id, item])));
    setParticipants(new Map(((participantResult.data ?? []) as ParticipantRow[]).map((item) => [item.challenge_id, item])));
    setLoading(false);
  }, [user]);

  useEffect(() => { void load(); }, [load]);
  if (activeWorkspace.kind !== 'personal') return <Navigate to="/" replace/>;

  const joinedCount = useMemo(() => [...participants.values()].length, [participants]);

  const join = async (challengeId: string) => {
    if (!supabase) return;
    setActing(challengeId); setError(''); setMessage('');
    const { error: rpcError } = await supabase.rpc('join_sponsored_challenge', { p_challenge_id: challengeId });
    setActing(null);
    if (rpcError) { setError(rpcError.message); return; }
    setMessage('Te uniste al Branded Challenge. Completa el reto y adjunta evidencia.');
    await load();
  };

  return <div className="profile-shell-v9 sponsored-shell-v13"><AppHeader/><main className="profile-page-v9 sponsored-page-v13">
    <div className="brand-topline-v13"><Link className="profile-back-v9" to="/app"><ArrowLeft size={16}/> Volver a entrenar</Link><button type="button" onClick={() => { void load(); }} disabled={loading}><RefreshCw size={15}/> Actualizar</button></div>
    <section className="sponsored-hero-v13"><div><Sparkles size={32}/></div><span><span className="eyebrow">BRANDED CHALLENGES</span><h1>Retos patrocinados</h1><p>Participa en activaciones de Marcas verificadas, demuestra tu reto y gana recompensas dentro de DadoFit.</p></span><div><strong>{joinedCount}</strong><small>retos unidos</small></div></section>
    {error && <div className="auth-error">{error}</div>}{message && <div className="auth-success">{message}</div>}

    {loading ? <section className="profile-card-v9">Cargando retos patrocinados…</section> : challenges.length === 0 ? <section className="profile-card-v9 brand-empty-v13"><Sparkles size={32}/><h3>No hay Branded Challenges activos</h3><p>Las nuevas campañas aparecerán aquí cuando una Marca las publique.</p></section> : <section className="sponsored-grid-v13">{challenges.map((challenge) => {
      const campaign = challenge.sponsor_campaign_id ? campaigns.get(challenge.sponsor_campaign_id) : null;
      const organization = challenge.creator_organization_id ? organizations.get(challenge.creator_organization_id) : null;
      const participant = participants.get(challenge.id);
      const catalogExercise = catalogById.get(challenge.exercise_id);
      return <article key={challenge.id} className="profile-card-v9 sponsored-card-v13"><header><div className="sponsored-brand-mark-v13">{organization?.logo_url ? <img src={organization.logo_url} alt=""/> : <Sparkles size={22}/>}</div><div><span className="eyebrow">{organization?.name || 'MARCA DADOFIT'}</span><h2>{campaign?.name || challenge.title || 'Branded Challenge'}</h2>{organization?.verification_status === 'verified' && <small className="sponsored-verified-v13"><ShieldCheck size={12}/> Marca verificada</small>}</div>{participant && <span className={`brand-status-v13 status-${participant.status}`}>{statusLabel(participant.status)}</span>}</header><div className="sponsored-exercise-v13 sponsored-exercise-v132"><strong>{formatSponsoredGoal(readSponsoredGoal(challenge.metadata, challenge.reps))}</strong><span>{challenge.exercise_name}</span></div>{catalogExercise && <div className="sponsored-catalog-exercise-v131"><ExerciseMedia exercise={catalogExercise}/><div><strong>{catalogExercise.name}</strong><small>Ejercicio oficial del catálogo DadoFit</small>{catalogExercise.instructionStepsEs.length > 0 && <details><summary>Cómo hacerlo</summary><ol>{catalogExercise.instructionStepsEs.slice(0, 6).map((step, index) => <li key={`${catalogExercise.id}-${index}`}>{step}</li>)}</ol></details>}</div></div>}{campaign?.description && <p>{campaign.description}</p>}<div className="sponsored-meta-v13"><span><Clock3 size={14}/> hasta {formatDate(challenge.expires_at)}</span><span><Coins size={14}/> +{challenge.reward_coins} DC</span><span><Trophy size={14}/> +{challenge.reward_xp} XP</span></div>{!participant ? <button type="button" className="sponsored-join-v13" onClick={() => { void join(challenge.id); }} disabled={Boolean(acting)}><Sparkles size={16}/>{acting === challenge.id ? 'Uniéndote…' : 'Unirme al reto'}</button> : <><div className="sponsored-progress-v13"><span>Estado</span><strong>{statusLabel(participant.status)}</strong>{participant.status === 'approved' && <small>{participant.reward_block_reason ? 'Reto válido · recompensa bloqueada por límite anti-farming.' : `Recompensa: +${participant.reward_coins_granted} DC · +${participant.reward_xp_granted} XP`}</small>}</div>{['accepted', 'rejected', 'submitted'].includes(participant.status) && <ParticipantEvidence participant={participant} onChanged={load}/>} {participant.status === 'approved' && <div className="sponsored-approved-v13"><Check size={18}/> Reto aprobado por la Marca</div>}</>}</article>;
    })}</section>}
    <p className="sponsored-policy-v13">Completar un reto no garantiza una recompensa adicional si se activa una regla anti-farming. Máximo 3 recompensas patrocinadas por usuario en una ventana de 24 horas.</p>
  </main></div>;
}
