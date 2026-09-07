import { ArrowLeft, Check, CheckCircle2, Clock3, Coins, FileVideo2, Image as ImageIcon, Megaphone, Pause, Pencil, Play, RefreshCw, Save, Send, ShieldCheck, Sparkles, Trophy, Upload, UsersRound, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { AppHeader } from '../components/AppHeader';
import { ExerciseCatalogPicker } from '../components/ExerciseCatalogPicker';
import { useWorkspace } from '../context/WorkspaceContext';
import { canEditSponsorCampaign, canManageBrandRole, sponsoredChallengeEditMode, SPONSORED_LIMITS } from '../lib/sponsoredRules';
import { defaultGoalUnit, formatSponsoredGoal, readSponsoredGoal, SPONSORED_GOAL_OPTIONS, SPONSORED_GOAL_UNITS, type SponsoredGoalType } from '../lib/sponsoredGoals';
import { supabase } from '../lib/supabase';
import type { AppExercise } from '../types/exercise';

interface CampaignRow {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  status: 'draft' | 'active' | 'paused' | 'completed' | 'cancelled';
  starts_at: string | null;
  ends_at: string | null;
  default_reward_coins: number;
  default_reward_xp: number;
  default_reward_sp: number;
  max_participants: number | null;
  created_at: string;
}

interface ChallengeRow {
  id: string;
  sponsor_campaign_id: string | null;
  status: string;
  exercise_id: string;
  exercise_name: string;
  reps: number;
  expires_at: string | null;
  reward_coins: number;
  reward_xp: number;
  sponsor_reward_points: number;
  max_participants: number | null;
  created_at: string;
  metadata: Record<string, unknown> | null;
}

interface ParticipantRow {
  id: string;
  challenge_id: string;
  user_id: string;
  status: string;
  submitted_at: string | null;
  completed_at: string | null;
  rewarded_at: string | null;
  reward_coins_granted: number;
  reward_xp_granted: number;
  sponsor_reward_points_granted: number;
  reward_block_reason: string | null;
}

interface ProfileRow { id: string; display_name: string; username: string | null; }
interface EvidenceRow { id: string; participant_id: string; evidence_kind: 'image' | 'video'; storage_path: string; file_name: string | null; mime_type: string | null; size_bytes: number | null; created_at: string; }
interface EvidenceView extends EvidenceRow { signedUrl: string | null; }
interface BrandSummary { members: number; campaigns: number; active_campaigns: number; sponsored_challenges: number; active_challenges: number; participants: number; pending_review: number; approved: number; coins_granted: number; xp_granted: number; sp_granted: number; }

const EMPTY_SUMMARY: BrandSummary = { members: 0, campaigns: 0, active_campaigns: 0, sponsored_challenges: 0, active_challenges: 0, participants: 0, pending_review: 0, approved: 0, coins_granted: 0, xp_granted: 0, sp_granted: 0 };

function formatDate(value: string | null) {
  if (!value) return '—';
  try { return new Intl.DateTimeFormat('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(value)); } catch { return value; }
}

function formatBytes(bytes: number | null) {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function toDatetimeLocal(value: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 16);
}

function campaignStatusLabel(status: CampaignRow['status']) {
  const labels: Record<CampaignRow['status'], string> = { draft: 'Borrador', active: 'Activa', paused: 'Pausada', completed: 'Finalizada', cancelled: 'Cancelada' };
  return labels[status];
}

function ReviewEvidence({ participant, onChanged }: { participant: ParticipantRow; onChanged: () => Promise<void> }) {
  const [items, setItems] = useState<EvidenceView[]>([]);
  const [loading, setLoading] = useState(false);
  const [acting, setActing] = useState(false);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

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
    setItems(hydrated);
    setLoading(false);
  }, [participant.id]);

  useEffect(() => { void load(); }, [load]);

  const review = async (decision: 'approved' | 'rejected') => {
    if (!supabase || participant.status !== 'submitted') return;
    setActing(true); setError(''); setMessage('');
    const { data, error: rpcError } = await supabase.rpc('review_sponsored_challenge', { p_participant_id: participant.id, p_decision: decision, p_notes: notes.trim() || null });
    setActing(false);
    if (rpcError) { setError(rpcError.message); return; }
    const result = (data ?? {}) as Record<string, unknown>;
    if (decision === 'rejected') setMessage('Evidencia rechazada. El participante puede volver a enviarla.');
    else if (result.status === 'pending_audit' || result.requires_second_validation) setMessage('Primera validación aprobada. Queda pendiente de auditoría; la recompensa todavía no se ha entregado.');
    else if (result.reward_blocked) setMessage('Aprobado sin recompensa adicional por política anti-farming.');
    else setMessage(`Aprobado: +${Number(result.coins_granted ?? 0)} DC · +${Number(result.xp_granted ?? 0)} XP · +${Number(result.sp_granted ?? 0)} SP.`);
    await onChanged();
  };

  return <div className="brand-review-evidence-v13">
    {error && <div className="auth-error">{error}</div>}{message && <div className="auth-success">{message}</div>}
    {loading ? <p>Cargando evidencia…</p> : items.length === 0 ? <p>No hay evidencia disponible.</p> : <div className="brand-review-media-v13">{items.map((item) => <article key={item.id}><div>{item.signedUrl && item.evidence_kind === 'image' ? <img src={item.signedUrl} alt="Evidencia"/> : item.signedUrl ? <video src={item.signedUrl} controls preload="metadata"/> : item.evidence_kind === 'image' ? <ImageIcon/> : <FileVideo2/>}</div><span><strong>{item.file_name || 'Evidencia'}</strong><small>{formatBytes(item.size_bytes)} · {formatDate(item.created_at)}</small></span></article>)}</div>}
    {participant.status === 'submitted' && <div className="brand-review-actions-v13"><label>Comentario opcional<textarea rows={2} maxLength={500} value={notes} onChange={(event) => setNotes(event.target.value)}/></label><div><button type="button" className="reject" onClick={() => { void review('rejected'); }} disabled={acting}><X size={15}/> Pedir otra evidencia</button><button type="button" onClick={() => { void review('approved'); }} disabled={acting}><Check size={15}/> Aprobar</button></div></div>}
  </div>;
}

export function BrandCampaignsPage() {
  const { activeWorkspace } = useWorkspace();
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
  const [challenges, setChallenges] = useState<ChallengeRow[]>([]);
  const [participants, setParticipants] = useState<ParticipantRow[]>([]);
  const [profiles, setProfiles] = useState<Map<string, ProfileRow>>(new Map());
  const [summary, setSummary] = useState<BrandSummary>(EMPTY_SUMMARY);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const [campaignName, setCampaignName] = useState('');
  const [campaignDescription, setCampaignDescription] = useState('');
  const [rewardCoins, setRewardCoins] = useState(25);
  const [rewardXp, setRewardXp] = useState(50);
  const [rewardSp, setRewardSp] = useState(50);
  const [campaignMax, setCampaignMax] = useState(500);
  const [editingCampaignId, setEditingCampaignId] = useState<string | null>(null);

  const [publishCampaignId, setPublishCampaignId] = useState('');
  const [exerciseName, setExerciseName] = useState('');
  const [selectedExercise, setSelectedExercise] = useState<AppExercise | null>(null);
  const [customActivity, setCustomActivity] = useState(false);
  const [goalType, setGoalType] = useState<SponsoredGoalType>('repetitions');
  const [goalValue, setGoalValue] = useState(20);
  const [goalUnit, setGoalUnit] = useState(defaultGoalUnit('repetitions'));
  const [durationHours, setDurationHours] = useState(72);
  const [challengeMax, setChallengeMax] = useState(100);
  const [editingChallengeId, setEditingChallengeId] = useState<string | null>(null);
  const [challengeEnd, setChallengeEnd] = useState('');

  const orgId = activeWorkspace.organizationId;
  const canManage = canManageBrandRole(activeWorkspace.role);
  const verified = activeWorkspace.verificationStatus === 'verified';

  const load = useCallback(async () => {
    if (!supabase || !orgId) { setLoading(false); return; }
    const client = supabase;
    setLoading(true); setError('');
    const [campaignResult, challengeResult, summaryResult] = await Promise.all([
      client.from('sponsor_campaigns').select('id, organization_id, name, description, status, starts_at, ends_at, default_reward_coins, default_reward_xp, default_reward_sp, max_participants, created_at').eq('organization_id', orgId).order('created_at', { ascending: false }),
      client.from('challenges').select('id, sponsor_campaign_id, status, exercise_id, exercise_name, reps, expires_at, reward_coins, reward_xp, sponsor_reward_points, max_participants, created_at, metadata').eq('creator_organization_id', orgId).eq('challenge_type', 'sponsored').order('created_at', { ascending: false }),
      client.rpc('get_brand_dashboard_summary', { p_organization_id: orgId }),
    ]);
    const firstError = campaignResult.error ?? challengeResult.error ?? summaryResult.error;
    if (firstError) { setError(firstError.message); setLoading(false); return; }
    const campaignRows = (campaignResult.data ?? []) as CampaignRow[];
    const challengeRows = (challengeResult.data ?? []) as ChallengeRow[];
    setCampaigns(campaignRows); setChallenges(challengeRows);
    setSummary({ ...EMPTY_SUMMARY, ...((summaryResult.data ?? {}) as Partial<BrandSummary>) });
    setPublishCampaignId((current) => current || campaignRows.find((item) => item.status === 'active')?.id || campaignRows[0]?.id || '');

    const challengeIds = challengeRows.map((item) => item.id);
    if (!canManage || challengeIds.length === 0) { setParticipants([]); setProfiles(new Map()); setLoading(false); return; }
    const participantResult = await client.from('challenge_participants').select('id, challenge_id, user_id, status, submitted_at, completed_at, rewarded_at, reward_coins_granted, reward_xp_granted, sponsor_reward_points_granted, reward_block_reason').in('challenge_id', challengeIds).order('submitted_at', { ascending: false });
    if (participantResult.error) { setError(participantResult.error.message); setLoading(false); return; }
    const participantRows = (participantResult.data ?? []) as ParticipantRow[];
    setParticipants(participantRows);
    const userIds = [...new Set(participantRows.map((item) => item.user_id))];
    if (userIds.length) {
      const profileResult = await client.from('profiles').select('id, display_name, username').in('id', userIds);
      if (profileResult.error) setError(profileResult.error.message);
      else setProfiles(new Map(((profileResult.data ?? []) as ProfileRow[]).map((item) => [item.id, item])));
    } else setProfiles(new Map());
    setLoading(false);
  }, [canManage, orgId]);

  useEffect(() => { void load(); }, [load]);
  if (activeWorkspace.kind !== 'brand' || !orgId) return <Navigate to="/" replace/>;

  const submitted = useMemo(() => participants.filter((item) => item.status === 'submitted'), [participants]);

  const resetCampaignForm = () => {
    setEditingCampaignId(null);
    setCampaignName('');
    setCampaignDescription('');
    setRewardCoins(25);
    setRewardXp(50);
    setRewardSp(50);
    setCampaignMax(500);
  };

  const startCampaignEdit = (campaign: CampaignRow) => {
    setEditingCampaignId(campaign.id);
    setCampaignName(campaign.name);
    setCampaignDescription(campaign.description ?? '');
    setRewardCoins(campaign.default_reward_coins);
    setRewardXp(campaign.default_reward_xp);
    setRewardSp(campaign.default_reward_sp);
    setCampaignMax(campaign.max_participants ?? 500);
    setError(''); setMessage('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const createCampaign = async (event: FormEvent) => {
    event.preventDefault();
    if (!supabase || !canManage || !orgId) return;
    const editing = Boolean(editingCampaignId);
    setActing(editing ? `edit-campaign:${editingCampaignId}` : 'create'); setError(''); setMessage('');
    const request = editing && editingCampaignId
      ? await supabase.rpc('update_sponsor_campaign', {
          p_campaign_id: editingCampaignId,
          p_name: campaignName.trim(),
          p_description: campaignDescription.trim() || null,
          p_default_reward_coins: rewardCoins,
          p_default_reward_xp: rewardXp,
          p_default_reward_sp: rewardSp,
          p_max_participants: campaignMax,
        })
      : await supabase.rpc('create_sponsor_campaign', {
          p_organization_id: orgId,
          p_name: campaignName.trim(),
          p_description: campaignDescription.trim() || null,
          p_default_reward_coins: rewardCoins,
          p_default_reward_xp: rewardXp,
          p_default_reward_sp: rewardSp,
          p_max_participants: campaignMax,
        });
    setActing(null);
    if (request.error) { setError(request.error.message); return; }
    if (editing) {
      setMessage('Campaña actualizada. Los cambios de recompensas aplican solo a Branded Challenges publicados desde ahora.');
      resetCampaignForm();
    } else {
      const createdId = String(request.data ?? '');
      resetCampaignForm();
      setMessage('Campaña creada en borrador.');
      setPublishCampaignId(createdId);
    }
    await load();
  };

  const setCampaignStatus = async (campaignId: string, status: CampaignRow['status']) => {
    if (!supabase || !canManage) return;
    setActing(`status:${campaignId}`); setError(''); setMessage('');
    const { error: rpcError } = await supabase.rpc('set_sponsor_campaign_status', { p_campaign_id: campaignId, p_status: status });
    setActing(null);
    if (rpcError) setError(rpcError.message); else { setMessage(`Campaña actualizada: ${campaignStatusLabel(status)}.`); await load(); }
  };

  const resetChallengeForm = () => {
    setEditingChallengeId(null);
    setExerciseName('');
    setSelectedExercise(null);
    setCustomActivity(false);
    setGoalType('repetitions');
    setGoalValue(20);
    setGoalUnit(defaultGoalUnit('repetitions'));
    setDurationHours(72);
    setChallengeMax(100);
    setChallengeEnd('');
  };

  const startChallengeEdit = (challenge: ChallengeRow) => {
    const goal = readSponsoredGoal(challenge.metadata, challenge.reps);
    setEditingChallengeId(challenge.id);
    setPublishCampaignId(challenge.sponsor_campaign_id ?? '');
    setExerciseName(challenge.exercise_name);
    setSelectedExercise(null);
    setCustomActivity(true);
    setGoalType(goal.type);
    setGoalValue(goal.value);
    setGoalUnit(goal.unit);
    setChallengeMax(challenge.max_participants ?? 100);
    setChallengeEnd(toDatetimeLocal(challenge.expires_at));
    setError(''); setMessage('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const publishChallenge = async (event: FormEvent) => {
    event.preventDefault();
    if (!supabase || !canManage || !publishCampaignId) return;

    if (editingChallengeId) {
      const challenge = challenges.find((item) => item.id === editingChallengeId);
      if (!challenge) { setError('No se encontró el Branded Challenge que intentas editar.'); return; }
      const participantCount = participants.filter((item) => item.challenge_id === challenge.id).length;
      const mode = sponsoredChallengeEditMode(challenge.status, participantCount);
      if (mode === 'none') { setError('Este Branded Challenge ya no se puede editar.'); return; }
      if (!challengeEnd) { setError('Define la fecha y hora de finalización.'); return; }
      const endDate = new Date(challengeEnd);
      if (Number.isNaN(endDate.getTime()) || endDate <= new Date()) { setError('La fecha de finalización debe estar en el futuro.'); return; }
      const finalExerciseName = mode === 'limited' ? challenge.exercise_name : (selectedExercise?.name ?? exerciseName.trim());
      if (!finalExerciseName) { setError('Selecciona un ejercicio o crea una actividad personalizada.'); return; }
      setActing(`edit-challenge:${challenge.id}`); setError(''); setMessage('');
      const { error: rpcError } = await supabase.rpc('update_sponsored_challenge', {
        p_challenge_id: challenge.id,
        p_exercise_name: finalExerciseName,
        p_exercise_id: selectedExercise?.id ?? challenge.exercise_id ?? null,
        p_goal_type: mode === 'limited' ? readSponsoredGoal(challenge.metadata, challenge.reps).type : goalType,
        p_goal_value: mode === 'limited' ? readSponsoredGoal(challenge.metadata, challenge.reps).value : goalValue,
        p_goal_unit: mode === 'limited' ? readSponsoredGoal(challenge.metadata, challenge.reps).unit : goalUnit,
        p_expires_at: endDate.toISOString(),
        p_max_participants: challengeMax,
      });
      setActing(null);
      if (rpcError) { setError(rpcError.message); return; }
      setMessage(mode === 'limited'
        ? 'Branded Challenge actualizado. Como ya tenía participantes, el objetivo y la actividad se conservaron.'
        : 'Branded Challenge actualizado.');
      resetChallengeForm();
      await load();
      return;
    }

    const finalExerciseName = selectedExercise?.name ?? exerciseName.trim();
    if (!finalExerciseName) { setError('Selecciona un ejercicio o crea una actividad personalizada.'); return; }
    setActing('publish'); setError(''); setMessage('');
    const { error: rpcError } = await supabase.rpc('publish_sponsored_challenge', {
      p_campaign_id: publishCampaignId,
      p_exercise_name: finalExerciseName,
      p_exercise_id: selectedExercise?.id ?? null,
      p_goal_type: goalType,
      p_goal_value: goalValue,
      p_goal_unit: goalUnit,
      p_duration_hours: durationHours,
      p_max_participants: challengeMax,
    });
    setActing(null);
    if (rpcError) { setError(rpcError.message); return; }
    resetChallengeForm();
    setMessage('Branded Challenge publicado para la comunidad DadoFit.');
    await load();
  };

  const closeChallenge = async (challengeId: string) => {
    if (!supabase || !canManage || !window.confirm('¿Cerrar este Branded Challenge? Los participantes que aún no enviaron evidencia quedarán expirados.')) return;
    setActing(`close:${challengeId}`); setError('');
    const { error: rpcError } = await supabase.rpc('close_sponsored_challenge', { p_challenge_id: challengeId });
    setActing(null);
    if (rpcError) setError(rpcError.message); else await load();
  };

  return <div className="profile-shell-v9 brand-campaigns-shell-v13"><AppHeader/><main className="profile-page-v9 brand-campaigns-page-v13">
    <div className="brand-topline-v13"><Link className="profile-back-v9" to="/workspace"><ArrowLeft size={16}/> Dashboard Marca</Link><button type="button" onClick={() => { void load(); }} disabled={loading}><RefreshCw size={15}/> Actualizar</button></div>
    <section className="brand-hero-v13"><div><Megaphone size={32}/></div><span><span className="eyebrow">BRANDS & SPONSORS</span><h1>{activeWorkspace.label}</h1><p>Campañas, retos patrocinados, evidencia y recompensas en un solo workspace.</p></span><ShieldCheck size={24}/></section>
    {!verified && <section className="brand-verification-v13"><ShieldCheck size={20}/><div><strong>Workspace pendiente de verificación</strong><p>Puedes crear borradores, pero activar campañas y publicar retos requiere una Marca verificada.</p></div></section>}
    {error && <div className="auth-error">{error}</div>}{message && <div className="auth-success">{message}</div>}

    <section className="brand-summary-v13 brand-summary-eco1"><article><Megaphone/><span>Campañas</span><strong>{summary.campaigns}</strong></article><article><Play/><span>Activas</span><strong>{summary.active_campaigns}</strong></article><article><Sparkles/><span>Branded Challenges</span><strong>{summary.sponsored_challenges}</strong></article><article><UsersRound/><span>Participantes</span><strong>{summary.participants}</strong></article><article><CheckCircle2/><span>Aprobados</span><strong>{summary.approved}</strong></article><article><Coins/><span>DC entregados</span><strong>{summary.coins_granted.toLocaleString()}</strong></article><article><Sparkles/><span>SP entregados</span><strong>{summary.sp_granted.toLocaleString()}</strong></article></section>
    {canManage && <Link className="brand-governance-shortcut-v133" to="/brand-audit"><ShieldCheck size={19}/><span><strong>Control & Auditoría</strong><small>Configura doble validación, revisa la cola de auditoría y consulta el histórico.</small></span><span>Administrar →</span></Link>}

    {canManage && <section className="brand-builder-grid-v13">
      <form className={`profile-card-v9 brand-form-v13 ${editingCampaignId ? 'is-editing-v15712' : ''}`} onSubmit={createCampaign}><span className="eyebrow">{editingCampaignId ? 'EDITAR CAMPAÑA' : 'NUEVA CAMPAÑA'}</span><h2>{editingCampaignId ? 'Actualizar campaña' : 'Crear campaña'}</h2>{editingCampaignId && <div className="brand-edit-notice-v15712"><Pencil size={16}/><span><strong>Editando campaña</strong><small>Los nuevos valores de DC, XP y SP aplican a futuros Branded Challenges. Los retos ya publicados conservan la recompensa prometida.</small></span></div>}<label>Nombre<input value={campaignName} onChange={(event) => setCampaignName(event.target.value)} minLength={3} maxLength={100} placeholder="Ej: Reto Energía Agosto" required/></label><label>Descripción<textarea rows={3} maxLength={700} value={campaignDescription} onChange={(event) => setCampaignDescription(event.target.value)} placeholder="Qué busca activar la Marca"/></label><div className="brand-reward-grid-eco1"><label>DadoCoins por aprobación<input type="number" min={0} max={SPONSORED_LIMITS.maxCoinsPerApproval} value={rewardCoins} onChange={(event) => setRewardCoins(Number(event.target.value))}/><small>Universales · sujetos al presupuesto del plan.</small></label><label>Sponsor Points por aprobación<input type="number" min={0} max={SPONSORED_LIMITS.maxSpPerApproval} value={rewardSp} onChange={(event) => setRewardSp(Number(event.target.value))}/><small>Solo sirven para premios de {activeWorkspace.label}.</small></label><label>XP por aprobación<input type="number" min={0} max={SPONSORED_LIMITS.maxXpPerApproval} value={rewardXp} onChange={(event) => setRewardXp(Number(event.target.value))}/><small>Progreso personal; no es moneda canjeable.</small></label></div><label>Audiencia máxima<input type="number" min={1} max={5000} value={campaignMax} onChange={(event) => setCampaignMax(Number(event.target.value))}/></label><div className="brand-edit-actions-v15712"><button type="submit" disabled={Boolean(acting)}>{editingCampaignId ? <Save size={16}/> : <Megaphone size={16}/>} {acting?.startsWith('edit-campaign:') ? 'Guardando…' : acting === 'create' ? 'Creando…' : editingCampaignId ? 'Guardar cambios' : 'Crear borrador'}</button>{editingCampaignId && <button type="button" className="secondary" onClick={resetCampaignForm} disabled={Boolean(acting)}><X size={15}/> Cancelar</button>}</div></form>

      <form className={`profile-card-v9 brand-form-v13 ${editingChallengeId ? 'is-editing-v15712' : ''}`} onSubmit={publishChallenge}><span className="eyebrow">BRANDED CHALLENGE</span><h2>{editingChallengeId ? 'Editar reto' : 'Publicar reto'}</h2>{editingChallengeId && (() => { const challenge = challenges.find((item) => item.id === editingChallengeId); const joined = participants.filter((item) => item.challenge_id === editingChallengeId).length; const mode = sponsoredChallengeEditMode(challenge?.status ?? '', joined); return <div className="brand-edit-notice-v15712"><Pencil size={16}/><span><strong>{mode === 'limited' ? 'Edición limitada' : 'Editando Branded Challenge'}</strong><small>{mode === 'limited' ? `Ya se unieron ${joined} participante(s). Para proteger lo prometido, la actividad y el objetivo quedan bloqueados; solo puedes ampliar/ajustar vigencia y cupos sin bajar de los inscritos.` : 'Aún no hay participantes: puedes corregir actividad, objetivo, vigencia y cupos.'}</small>{challenge && <small>Recompensa congelada de este reto: {challenge.reward_coins} DC · {challenge.reward_xp} XP · {challenge.sponsor_reward_points} SP {activeWorkspace.label}.</small>}</span></div>; })()}<label>Campaña<select value={publishCampaignId} onChange={(event) => setPublishCampaignId(event.target.value)} required disabled={Boolean(editingChallengeId)}><option value="">Selecciona</option>{campaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name} · {campaignStatusLabel(campaign.status)}</option>)}</select></label>{editingChallengeId && sponsoredChallengeEditMode(challenges.find((item) => item.id === editingChallengeId)?.status ?? '', participants.filter((item) => item.challenge_id === editingChallengeId).length) === 'limited' ? <label>Actividad<input value={exerciseName} disabled/><small>Bloqueada porque el reto ya tiene participantes.</small></label> : <ExerciseCatalogPicker selected={selectedExercise} customMode={customActivity} customValue={exerciseName} onSelect={setSelectedExercise} onCustomMode={setCustomActivity} onCustomValue={setExerciseName}/>}<fieldset className="sponsored-goal-builder-v132" disabled={Boolean(editingChallengeId) && sponsoredChallengeEditMode(challenges.find((item) => item.id === editingChallengeId)?.status ?? '', participants.filter((item) => item.challenge_id === editingChallengeId).length) === 'limited'}><legend>Objetivo del reto</legend><div className="sponsored-goal-types-v132">{SPONSORED_GOAL_OPTIONS.map((option) => <button key={option.id} type="button" className={goalType === option.id ? 'active' : ''} onClick={() => { setGoalType(option.id); setGoalUnit(defaultGoalUnit(option.id)); }}>{option.label}</button>)}</div><div className="sponsored-goal-value-v132"><label>Meta<input type="number" min={goalType === 'distance' || goalType === 'time' ? 0.1 : 1} max={goalType === 'quantity' ? 1000000 : 100000} step={goalType === 'distance' || goalType === 'time' ? 0.1 : 1} value={goalValue} onChange={(event) => setGoalValue(Number(event.target.value))}/></label><label>Unidad<select value={goalUnit} onChange={(event) => setGoalUnit(event.target.value)}>{SPONSORED_GOAL_UNITS[goalType].map((unit) => <option key={unit.value} value={unit.value}>{unit.label}</option>)}</select></label></div><p className="sponsored-goal-preview-v132">El usuario verá: <strong>{selectedExercise?.name ?? (exerciseName.trim() || 'Actividad')} · {formatSponsoredGoal({ type: goalType, value: goalValue, unit: goalUnit })}</strong></p></fieldset>{editingChallengeId ? <label>Finaliza<input type="datetime-local" value={challengeEnd} onChange={(event) => setChallengeEnd(event.target.value)} required/><small>Puede ajustarse mientras el reto siga activo.</small></label> : <div className="brand-form-row-v13"><label>Duración<select value={durationHours} onChange={(event) => setDurationHours(Number(event.target.value))}><option value={24}>1 día</option><option value={48}>2 días</option><option value={72}>3 días</option><option value={168}>7 días</option><option value={336}>14 días</option></select></label></div>}<label>Cupos<input type="number" min={editingChallengeId ? Math.max(1, participants.filter((item) => item.challenge_id === editingChallengeId).length) : 1} max={5000} value={challengeMax} onChange={(event) => setChallengeMax(Number(event.target.value))}/></label><div className="brand-edit-actions-v15712"><button type="submit" disabled={Boolean(acting) || !verified}>{editingChallengeId ? <Save size={16}/> : <Send size={16}/>} {acting?.startsWith('edit-challenge:') ? 'Guardando…' : acting === 'publish' ? 'Publicando…' : editingChallengeId ? 'Guardar cambios' : 'Publicar a DadoFit'}</button>{editingChallengeId && <button type="button" className="secondary" onClick={resetChallengeForm} disabled={Boolean(acting)}><X size={15}/> Cancelar</button>}</div>{!verified && <small>La publicación se habilita al verificar la Marca.</small>}</form>
    </section>}

    <section className="brand-section-v13"><div className="brand-section-head-v13"><div><span className="eyebrow">CAMPAÑAS</span><h2>{campaigns.length} registradas</h2></div></div>{loading ? <div className="profile-card-v9">Cargando campañas…</div> : campaigns.length === 0 ? <div className="profile-card-v9 brand-empty-v13"><Megaphone size={30}/><h3>Aún no hay campañas</h3><p>{canManage ? 'Crea el primer borrador para comenzar.' : 'Los Owners o Admins de la Marca pueden crear campañas.'}</p></div> : <div className="brand-campaign-list-v13">{campaigns.map((campaign) => { const related = challenges.filter((item) => item.sponsor_campaign_id === campaign.id); const relatedParticipants = participants.filter((participant) => related.some((challenge) => challenge.id === participant.challenge_id)); return <article key={campaign.id} className="profile-card-v9 brand-campaign-card-v13"><header><div><span className="eyebrow">{campaignStatusLabel(campaign.status)}</span><h3>{campaign.name}</h3>{campaign.description && <p>{campaign.description}</p>}</div><span className={`brand-status-v13 status-${campaign.status}`}>{campaignStatusLabel(campaign.status)}</span></header><div className="brand-campaign-metrics-v13"><span><Sparkles size={14}/><strong>{related.length}</strong> retos</span><span><UsersRound size={14}/><strong>{relatedParticipants.length}</strong> participantes</span><span><CheckCircle2 size={14}/><strong>{relatedParticipants.filter((item) => item.status === 'approved').length}</strong> aprobados</span><span><Coins size={14}/><strong>{campaign.default_reward_coins}</strong> DC / aprobación</span><span><Sparkles size={14}/><strong>{campaign.default_reward_sp}</strong> SP {activeWorkspace.label} / aprobación</span></div>{canManage && <footer>{canEditSponsorCampaign(campaign.status) && <button type="button" className="brand-edit-button-v15712" onClick={() => { startCampaignEdit(campaign); }} disabled={Boolean(acting)}><Pencil size={14}/> Editar</button>}{campaign.status === 'draft' || campaign.status === 'paused' ? <button type="button" onClick={() => { void setCampaignStatus(campaign.id, 'active'); }} disabled={Boolean(acting) || !verified}><Play size={14}/> Activar</button> : null}{campaign.status === 'active' && <button type="button" className="secondary" onClick={() => { void setCampaignStatus(campaign.id, 'paused'); }} disabled={Boolean(acting)}><Pause size={14}/> Pausar</button>}{!['completed', 'cancelled'].includes(campaign.status) && <button type="button" className="secondary" onClick={() => { void setCampaignStatus(campaign.id, 'completed'); }} disabled={Boolean(acting)}><Check size={14}/> Finalizar campaña</button>}</footer>}</article>; })}</div>}</section>

    <section className="brand-section-v13"><div className="brand-section-head-v13"><div><span className="eyebrow">RETOS PUBLICADOS</span><h2>{challenges.length} Branded Challenges</h2></div></div>{challenges.length === 0 ? <div className="profile-card-v9 brand-empty-v13"><Sparkles size={30}/><h3>Sin retos patrocinados todavía</h3></div> : <div className="brand-challenge-list-v13">{challenges.map((challenge) => { const campaign = campaigns.find((item) => item.id === challenge.sponsor_campaign_id); const challengeParticipants = participants.filter((item) => item.challenge_id === challenge.id); return <article key={challenge.id} className="profile-card-v9 brand-challenge-card-v13"><header><div><span className="eyebrow">{campaign?.name || 'CAMPAÑA'}</span><h3>{challenge.exercise_name} · {formatSponsoredGoal(readSponsoredGoal(challenge.metadata, challenge.reps))}</h3><p><Clock3 size={13}/> hasta {formatDate(challenge.expires_at)}</p></div><span className={`brand-status-v13 status-${challenge.status}`}>{challenge.status}</span></header><div className="brand-campaign-metrics-v13"><span><UsersRound size={14}/><strong>{challengeParticipants.length}</strong> participantes</span><span><CheckCircle2 size={14}/><strong>{challengeParticipants.filter((item) => item.status === 'approved').length}</strong> aprobados</span><span><Trophy size={14}/><strong>{challenge.reward_coins} DC · {challenge.reward_xp} XP · {challenge.sponsor_reward_points} SP</strong></span></div>{canManage && challenge.status === 'active' && <div className="brand-challenge-actions-v15712"><button type="button" className="brand-edit-button-v15712" onClick={() => { startChallengeEdit(challenge); }} disabled={Boolean(acting)}><Pencil size={14}/> Editar</button><button type="button" className="brand-close-v13" onClick={() => { void closeChallenge(challenge.id); }} disabled={Boolean(acting)}>Cerrar reto</button></div>}</article>; })}</div>}</section>

    {canManage && <section className="brand-section-v13"><div className="brand-section-head-v13"><div><span className="eyebrow">EVIDENCIAS</span><h2>Por revisar <span>{submitted.length}</span></h2></div></div>{submitted.length === 0 ? <div className="profile-card-v9 brand-empty-v13"><CheckCircle2 size={30}/><h3>No tienes evidencia pendiente</h3></div> : <div className="brand-review-list-v13">{submitted.map((participant) => { const challenge = challenges.find((item) => item.id === participant.challenge_id); const campaign = campaigns.find((item) => item.id === challenge?.sponsor_campaign_id); const profile = profiles.get(participant.user_id); return <article key={participant.id} className="profile-card-v9 brand-review-card-v13"><header><div><span className="eyebrow">{campaign?.name || 'CAMPAÑA'}</span><h3>{profile?.display_name || profile?.username || 'Participante'}</h3><p>{challenge ? `${challenge.exercise_name} · ${formatSponsoredGoal(readSponsoredGoal(challenge.metadata, challenge.reps))}` : 'Branded Challenge'}</p></div><span className="brand-status-v13 status-submitted">En revisión</span></header><ReviewEvidence participant={participant} onChanged={load}/></article>; })}</div>}</section>}
  </main></div>;
}
