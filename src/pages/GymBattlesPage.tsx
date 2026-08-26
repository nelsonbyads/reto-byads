import {
  ArrowLeft,
  Building2,
  Check,
  Clock3,
  Coins,
  FileVideo2,
  Image as ImageIcon,
  RefreshCw,
  Send,
  ShieldCheck,
  Swords,
  Trophy,
  Upload,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { Link } from 'react-router-dom';
import { AppHeader } from '../components/AppHeader';
import { useAuth } from '../auth/AuthContext';
import { supabase } from '../lib/supabase';

interface BattleRow {
  id: string;
  challenge_id: string;
  challenger_organization_id: string;
  challenged_organization_id: string;
  created_by_user_id: string;
  accepted_by_user_id: string | null;
  status: 'pending' | 'active' | 'completed' | 'declined' | 'expired' | 'cancelled';
  response_expires_at: string;
  starts_at: string | null;
  expires_at: string | null;
  completed_at: string | null;
  winner_organization_id: string | null;
  created_at: string;
}

interface ChallengeRow {
  id: string;
  status: string;
  exercise_name: string;
  reps: number;
  dice_level: string;
  starts_at: string;
  expires_at: string | null;
  reward_coins: number;
  reward_xp: number;
  sponsor_points: number;
}

interface ParticipantRow {
  id: string;
  challenge_id: string;
  user_id: string;
  organization_id: string | null;
  status: string;
  invited_at: string;
  accepted_at: string | null;
  submitted_at: string | null;
  completed_at: string | null;
  rewarded_at: string | null;
  reward_coins_granted: number;
  reward_xp_granted: number;
  sponsor_points_granted: number;
  reward_block_reason: string | null;
}

interface OrganizationRow {
  id: string;
  name: string;
  logo_url: string | null;
  organization_type: string;
}

interface MembershipRow {
  organization_id: string;
  role: 'owner' | 'admin' | 'coach' | 'member';
  status: string;
}

interface ProfileRow {
  id: string;
  username: string | null;
  display_name: string;
  avatar_url: string | null;
}

interface EvidenceRow {
  id: string;
  participant_id: string;
  evidence_kind: 'image' | 'video';
  storage_path: string;
  file_name: string | null;
  size_bytes: number | null;
  created_at: string;
}

interface EvidenceView extends EvidenceRow {
  signedUrl: string | null;
}

function formatDate(value: string | null) {
  if (!value) return '—';
  try {
    return new Intl.DateTimeFormat('es-CO', {
      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function formatBytes(value: number | null) {
  if (!value) return '';
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function participantStatusLabel(status: string) {
  const labels: Record<string, string> = {
    accepted: 'Participando',
    declined: 'No participa',
    submitted: 'En revisión',
    approved: 'Aprobado',
    rejected: 'Nueva evidencia',
    expired: 'Expirado',
  };
  return labels[status] ?? status;
}

function battleStatusLabel(status: BattleRow['status']) {
  const labels: Record<BattleRow['status'], string> = {
    pending: 'Esperando respuesta',
    active: 'Batalla activa',
    completed: 'Finalizada',
    declined: 'Rechazada',
    expired: 'Expirada',
    cancelled: 'Cancelada',
  };
  return labels[status];
}

function initials(profile: ProfileRow | undefined) {
  const name = profile?.display_name?.trim() || profile?.username || 'DF';
  return name.split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'DF';
}

function GymBattleEvidence({
  participant,
  canUpload,
  canReview,
  onChanged,
}: {
  participant: ParticipantRow;
  canUpload: boolean;
  canReview: boolean;
  onChanged: () => Promise<void>;
}) {
  const { user } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<EvidenceView[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [acting, setActing] = useState(false);
  const [notes, setNotes] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!supabase) return;
    const client = supabase;
    setLoading(true);
    setError('');
    const { data, error: evidenceError } = await client
      .from('challenge_evidence')
      .select('id, participant_id, evidence_kind, storage_path, file_name, size_bytes, created_at')
      .eq('participant_id', participant.id)
      .order('created_at', { ascending: false });

    if (evidenceError) {
      setError(evidenceError.message);
      setLoading(false);
      return;
    }

    const rows = (data ?? []) as EvidenceRow[];
    const hydrated = await Promise.all(rows.map(async (row): Promise<EvidenceView> => {
      const { data: signed } = await client.storage.from('challenge-evidence').createSignedUrl(row.storage_path, 3600);
      return { ...row, signedUrl: signed?.signedUrl ?? null };
    }));
    setItems(hydrated);
    setLoading(false);
  }, [participant.id]);

  useEffect(() => { void load(); }, [load]);

  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !user || user.provider !== 'supabase' || !supabase || !canUpload) return;
    if (file.size > 50 * 1024 * 1024) { setError('El archivo supera el límite de 50 MB.'); return; }
    const isImage = file.type.startsWith('image/');
    const isVideo = file.type.startsWith('video/');
    if (!isImage && !isVideo) { setError('Sube una imagen o video compatible.'); return; }

    const client = supabase;
    setUploading(true);
    setError('');
    setMessage('');
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '-').slice(-100) || 'evidence';
    const path = `${user.id}/${participant.id}/${crypto.randomUUID()}-${safeName}`;
    const { error: storageError } = await client.storage.from('challenge-evidence').upload(path, file, { contentType: file.type, upsert: false });
    if (storageError) { setUploading(false); setError(storageError.message); return; }

    const { error: rowError } = await client.from('challenge_evidence').insert({
      participant_id: participant.id,
      evidence_kind: isImage ? 'image' : 'video',
      storage_path: path,
      file_name: file.name,
      mime_type: file.type,
      size_bytes: file.size,
    });
    if (rowError) {
      await client.storage.from('challenge-evidence').remove([path]);
      setUploading(false);
      setError(rowError.message);
      return;
    }
    setUploading(false);
    setMessage('Evidencia cargada. Ya puedes enviarla a revisión.');
    await load();
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
    setActing(true);
    setError('');
    setMessage('');
    const { error: rpcError } = await supabase.rpc('submit_organization_battle', { p_participant_id: participant.id });
    setActing(false);
    if (rpcError) { setError(rpcError.message); return; }
    setMessage('Evidencia enviada al Gym rival.');
    await onChanged();
  };

  const review = async (decision: 'approved' | 'rejected') => {
    if (!supabase || !canReview) return;
    setActing(true);
    setError('');
    setMessage('');
    const { data, error: rpcError } = await supabase.rpc('review_organization_battle', {
      p_participant_id: participant.id,
      p_decision: decision,
      p_notes: notes.trim() || null,
    });
    setActing(false);
    if (rpcError) { setError(rpcError.message); return; }
    const result = data as { reward_blocked?: boolean; coins_granted?: number; xp_granted?: number; sponsor_points?: number } | null;
    if (decision === 'rejected') setMessage('Evidencia rechazada. El participante deberá subir una nueva.');
    else if (result?.reward_blocked) setMessage('Aporte aprobado sin recompensa adicional por política anti-farming.');
    else setMessage(`Aprobado: +${result?.coins_granted ?? 25} DC · +${result?.xp_granted ?? 50} XP · +${result?.sponsor_points ?? 100} SP.`);
    await onChanged();
  };

  return (
    <div className="gym-battle-evidence-v121">
      <div className="gym-battle-evidence-head-v121">
        <strong>Evidencia</strong>
        {canUpload && <button type="button" onClick={() => inputRef.current?.click()} disabled={uploading}><Upload size={15}/>{uploading ? 'Subiendo…' : 'Agregar'}</button>}
        <input ref={inputRef} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm" onChange={(event) => { void upload(event); }}/>
      </div>
      {error && <div className="auth-error">{error}</div>}
      {message && <div className="auth-success">{message}</div>}
      {loading ? <p className="gym-battle-muted-v121">Cargando evidencia…</p> : items.length === 0 ? (
        <p className="gym-battle-muted-v121">Aún no hay evidencia.</p>
      ) : (
        <div className="gym-battle-evidence-list-v121">
          {items.map((item) => (
            <article key={item.id}>
              <div className="gym-battle-evidence-preview-v121">
                {item.signedUrl && item.evidence_kind === 'image' ? <img src={item.signedUrl} alt=""/> : item.signedUrl ? <video src={item.signedUrl} controls preload="metadata"/> : item.evidence_kind === 'image' ? <ImageIcon/> : <FileVideo2/>}
              </div>
              <div><strong>{item.file_name || 'Evidencia'}</strong><small>{formatBytes(item.size_bytes)} · {formatDate(item.created_at)}</small></div>
              {canUpload && <button type="button" onClick={() => { void remove(item); }} aria-label="Eliminar evidencia"><X size={14}/></button>}
            </article>
          ))}
        </div>
      )}
      {canUpload && <button className="gym-battle-submit-v121" type="button" onClick={() => { void submit(); }} disabled={acting || items.length === 0}><Send size={15}/>{participant.status === 'rejected' ? 'Volver a enviar' : 'Enviar al Gym rival'}</button>}
      {canReview && (
        <div className="gym-battle-review-v121">
          <label>Comentario opcional<textarea rows={2} maxLength={500} value={notes} onChange={(event) => setNotes(event.target.value)}/></label>
          <div>
            <button type="button" className="reject" onClick={() => { void review('rejected'); }} disabled={acting}><X size={15}/> Pedir otra evidencia</button>
            <button type="button" onClick={() => { void review('approved'); }} disabled={acting}><Check size={15}/> Aprobar +100 SP</button>
          </div>
        </div>
      )}
    </div>
  );
}

export function GymBattlesPage() {
  const { user } = useAuth();
  const [memberships, setMemberships] = useState<MembershipRow[]>([]);
  const [battles, setBattles] = useState<BattleRow[]>([]);
  const [challenges, setChallenges] = useState<Map<string, ChallengeRow>>(new Map());
  const [organizations, setOrganizations] = useState<Map<string, OrganizationRow>>(new Map());
  const [participants, setParticipants] = useState<ParticipantRow[]>([]);
  const [profiles, setProfiles] = useState<Map<string, ProfileRow>>(new Map());
  const [tab, setTab] = useState<'active' | 'history'>('active');
  const [loading, setLoading] = useState(user?.provider === 'supabase');
  const [acting, setActing] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const cloudReady = user?.provider === 'supabase' && Boolean(supabase);

  const load = useCallback(async () => {
    if (!user || user.provider !== 'supabase' || !supabase) { setLoading(false); return; }
    const client = supabase;
    setLoading(true);
    setError('');

    const [membershipResult, battleResult] = await Promise.all([
      client.from('organization_members').select('organization_id, role, status').eq('user_id', user.id).eq('status', 'active'),
      client.from('organization_battles').select('id, challenge_id, challenger_organization_id, challenged_organization_id, created_by_user_id, accepted_by_user_id, status, response_expires_at, starts_at, expires_at, completed_at, winner_organization_id, created_at').order('created_at', { ascending: false }),
    ]);
    const firstError = membershipResult.error ?? battleResult.error;
    if (firstError) { setError(firstError.message); setLoading(false); return; }

    const membershipRows = (membershipResult.data ?? []) as MembershipRow[];
    const battleRows = (battleResult.data ?? []) as BattleRow[];
    setMemberships(membershipRows);
    setBattles(battleRows);

    const challengeIds = battleRows.map((item) => item.challenge_id);
    const orgIds = [...new Set(battleRows.flatMap((item) => [item.challenger_organization_id, item.challenged_organization_id]))];

    const [challengeResult, orgResult, participantResult] = await Promise.all([
      challengeIds.length ? client.from('challenges').select('id, status, exercise_name, reps, dice_level, starts_at, expires_at, reward_coins, reward_xp, sponsor_points').in('id', challengeIds) : Promise.resolve({ data: [] as ChallengeRow[], error: null }),
      orgIds.length ? client.from('organizations').select('id, name, logo_url, organization_type').in('id', orgIds) : Promise.resolve({ data: [] as OrganizationRow[], error: null }),
      challengeIds.length ? client.from('challenge_participants').select('id, challenge_id, user_id, organization_id, status, invited_at, accepted_at, submitted_at, completed_at, rewarded_at, reward_coins_granted, reward_xp_granted, sponsor_points_granted, reward_block_reason').in('challenge_id', challengeIds) : Promise.resolve({ data: [] as ParticipantRow[], error: null }),
    ]);
    const secondError = challengeResult.error ?? orgResult.error ?? participantResult.error;
    if (secondError) { setError(secondError.message); setLoading(false); return; }

    const participantRows = (participantResult.data ?? []) as ParticipantRow[];
    setChallenges(new Map(((challengeResult.data ?? []) as ChallengeRow[]).map((item) => [item.id, item])));
    setOrganizations(new Map(((orgResult.data ?? []) as OrganizationRow[]).map((item) => [item.id, item])));
    setParticipants(participantRows);

    const profileIds = [...new Set(participantRows.map((item) => item.user_id))];
    if (profileIds.length) {
      const profileResult = await client.from('profiles').select('id, username, display_name, avatar_url').in('id', profileIds);
      if (profileResult.error) { setError(profileResult.error.message); setLoading(false); return; }
      setProfiles(new Map(((profileResult.data ?? []) as ProfileRow[]).map((item) => [item.id, item])));
    } else {
      setProfiles(new Map());
    }

    setLoading(false);
  }, [user]);

  useEffect(() => { void load(); }, [load]);

  const managerOrgIds = useMemo(() => new Set(memberships.filter((item) => ['owner', 'admin', 'coach'].includes(item.role)).map((item) => item.organization_id)), [memberships]);
  const activeBattles = useMemo(() => battles.filter((item) => ['pending', 'active'].includes(item.status)), [battles]);
  const historyBattles = useMemo(() => battles.filter((item) => !['pending', 'active'].includes(item.status)), [battles]);
  const current = tab === 'active' ? activeBattles : historyBattles;

  const respond = async (battleId: string, accept: boolean) => {
    if (!supabase) return;
    setActing(`respond:${battleId}`);
    setError('');
    setMessage('');
    const { error: rpcError } = await supabase.rpc('respond_organization_battle', { p_battle_id: battleId, p_accept: accept });
    setActing(null);
    if (rpcError) { setError(rpcError.message); return; }
    setMessage(accept ? 'Batalla aceptada. El roster quedó congelado por 72 horas.' : 'Batalla rechazada.');
    await load();
  };

  const declineContribution = async (participantId: string) => {
    if (!supabase || !window.confirm('¿No participar en esta batalla?')) return;
    setActing(`decline:${participantId}`);
    const { error: rpcError } = await supabase.rpc('decline_organization_battle_participation', { p_participant_id: participantId });
    setActing(null);
    if (rpcError) setError(rpcError.message);
    else await load();
  };

  const finalize = async (battleId: string) => {
    if (!supabase) return;
    setActing(`finalize:${battleId}`);
    setError('');
    const { error: rpcError } = await supabase.rpc('finalize_organization_battle', { p_battle_id: battleId });
    setActing(null);
    if (rpcError) setError(rpcError.message);
    else await load();
  };

  return (
    <div className="profile-shell-v9 gym-battles-shell-v121">
      <AppHeader/>
      <main className="profile-page-v9 gym-battles-page-v121">
        <div className="gym-battles-topline-v121">
          <Link className="profile-back-v9" to="/app"><ArrowLeft size={16}/> Volver a entrenar</Link>
          {cloudReady && <button type="button" onClick={() => { void load(); }} disabled={loading}><RefreshCw size={15}/> Actualizar</button>}
        </div>

        <section className="profile-hero-v9 gym-battles-hero-v121">
          <div className="profile-avatar-v9"><Trophy size={31}/></div>
          <div><span className="eyebrow">DADOFIT GYM LEAGUE</span><h1>Gym vs Gym</h1><p>Los miembros compiten, los managers rivales validan y cada aporte aprobado suma Sponsor Points.</p></div>
          {cloudReady && <div className="gym-battles-hero-stats-v121"><span><strong>{activeBattles.length}</strong> activas</span><span><strong>{historyBattles.length}</strong> historial</span></div>}
        </section>

        {!cloudReady ? (
          <section className="profile-card-v9 profile-cloud-callout-v9"><h2>Necesitas una cuenta cloud</h2><p>Las batallas Gym vs Gym funcionan con organizaciones y miembros reales.</p></section>
        ) : (
          <>
            {error && <div className="auth-error">{error}</div>}
            {message && <div className="auth-success">{message}</div>}

            <section className="gym-battle-tabs-v121" role="tablist" aria-label="Batallas Gym">
              <button type="button" className={tab === 'active' ? 'active' : ''} onClick={() => setTab('active')}>Activas <span>{activeBattles.length}</span></button>
              <button type="button" className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}>Historial <span>{historyBattles.length}</span></button>
            </section>

            {loading ? (
              <section className="profile-card-v9 gym-battle-empty-v121">Cargando batallas…</section>
            ) : current.length === 0 ? (
              <section className="profile-card-v9 gym-battle-empty-v121"><Swords size={32}/><h2>{tab === 'active' ? 'No tienes batallas activas' : 'Aún no hay historial'}</h2><p>Lanza los dados y usa “Gym vs Gym” para desafiar otro gimnasio.</p><Link className="profile-primary-v9" to="/app">Lanzar dados</Link></section>
            ) : (
              <section className="gym-battle-list-v121">
                {current.map((battle) => {
                  const challenge = challenges.get(battle.challenge_id);
                  const challenger = organizations.get(battle.challenger_organization_id);
                  const challenged = organizations.get(battle.challenged_organization_id);
                  const battleParticipants = participants.filter((item) => item.challenge_id === battle.challenge_id);
                  const challengerParticipants = battleParticipants.filter((item) => item.organization_id === battle.challenger_organization_id);
                  const challengedParticipants = battleParticipants.filter((item) => item.organization_id === battle.challenged_organization_id);
                  const challengerPoints = challengerParticipants.reduce((sum, item) => sum + Number(item.sponsor_points_granted ?? 0), 0);
                  const challengedPoints = challengedParticipants.reduce((sum, item) => sum + Number(item.sponsor_points_granted ?? 0), 0);
                  const ownParticipant = battleParticipants.find((item) => item.user_id === user?.id);
                  const canRespond = battle.status === 'pending' && managerOrgIds.has(battle.challenged_organization_id);
                  const canFinalize = managerOrgIds.has(battle.challenger_organization_id) || managerOrgIds.has(battle.challenged_organization_id);
                  const reviewable = battleParticipants.filter((item) => {
                    if (item.status !== 'submitted' || !item.organization_id) return false;
                    const opposing = item.organization_id === battle.challenger_organization_id ? battle.challenged_organization_id : battle.challenger_organization_id;
                    return managerOrgIds.has(opposing) && item.user_id !== user?.id;
                  });
                  const winner = battle.winner_organization_id ? organizations.get(battle.winner_organization_id) : null;

                  return (
                    <article key={battle.id} className={`profile-card-v9 gym-battle-card-v121 battle-${battle.status}`}>
                      <header className="gym-battle-card-head-v121">
                        <div><span className="eyebrow">GYM VS GYM</span><h2>{challenge ? `${challenge.reps}× ${challenge.exercise_name}` : 'Batalla de Gym'}</h2><p>{challenge?.dice_level?.toUpperCase() ?? ''} · creada {formatDate(battle.created_at)}</p></div>
                        <span className={`gym-battle-status-v121 status-${battle.status}`}>{battleStatusLabel(battle.status)}</span>
                      </header>

                      <div className="gym-battle-score-v121">
                        <div className="gym-battle-team-v121">
                          <div className="gym-battle-logo-v121">{challenger?.logo_url ? <img src={challenger.logo_url} alt=""/> : <Building2 size={22}/>}</div>
                          <span><strong>{challenger?.name ?? 'Gym retador'}</strong><small>{challengerParticipants.length} participantes</small></span>
                          <b>{challengerPoints} SP</b>
                        </div>
                        <div className="gym-battle-versus-v121"><Swords size={18}/><span>VS</span></div>
                        <div className="gym-battle-team-v121 right">
                          <b>{challengedPoints} SP</b>
                          <span><strong>{challenged?.name ?? 'Gym rival'}</strong><small>{challengedParticipants.length} participantes</small></span>
                          <div className="gym-battle-logo-v121">{challenged?.logo_url ? <img src={challenged.logo_url} alt=""/> : <Building2 size={22}/>}</div>
                        </div>
                      </div>

                      <div className="gym-battle-meta-v121">
                        {battle.status === 'pending' && <span><Clock3 size={14}/> Responder antes de {formatDate(battle.response_expires_at)}</span>}
                        {battle.status === 'active' && <span><Clock3 size={14}/> Finaliza {formatDate(battle.expires_at)}</span>}
                        <span><Coins size={14}/> Hasta 25 DC por aporte</span>
                        <span><Trophy size={14}/> Hasta 50 XP + 100 SP</span>
                      </div>

                      {canRespond && (
                        <div className="gym-battle-response-v121">
                          <button type="button" className="reject" onClick={() => { void respond(battle.id, false); }} disabled={Boolean(acting)}><X size={16}/> Rechazar</button>
                          <button type="button" onClick={() => { void respond(battle.id, true); }} disabled={Boolean(acting)}><Check size={16}/> Aceptar batalla</button>
                        </div>
                      )}

                      {battle.status === 'pending' && !canRespond && <div className="gym-battle-info-v121">Esperando que un owner, admin o coach de {challenged?.name ?? 'Gym rival'} responda.</div>}

                      {battle.status === 'active' && ownParticipant && (
                        <section className="gym-battle-own-v121">
                          <div className="gym-battle-subheading-v121"><div><ShieldCheck size={16}/><span><strong>Tu aporte</strong><small>{participantStatusLabel(ownParticipant.status)}</small></span></div>{['accepted', 'rejected'].includes(ownParticipant.status) && <button type="button" className="gym-battle-skip-v121" onClick={() => { void declineContribution(ownParticipant.id); }} disabled={Boolean(acting)}>No participar</button>}</div>
                          {['accepted', 'rejected', 'submitted', 'approved'].includes(ownParticipant.status) && <GymBattleEvidence participant={ownParticipant} canUpload={['accepted', 'rejected'].includes(ownParticipant.status)} canReview={false} onChanged={load}/>} 
                          {ownParticipant.status === 'approved' && <div className="gym-battle-approved-v121"><Check size={18}/><span><strong>Aporte aprobado</strong><small>+{ownParticipant.reward_coins_granted} DC · +{ownParticipant.reward_xp_granted} XP · +{ownParticipant.sponsor_points_granted} SP{ownParticipant.reward_block_reason ? ' · anti-farming aplicado' : ''}</small></span></div>}
                        </section>
                      )}

                      {battle.status === 'active' && reviewable.length > 0 && (
                        <section className="gym-battle-reviews-v121">
                          <div className="gym-battle-subheading-v121"><div><Trophy size={16}/><span><strong>Evidencias del Gym rival</strong><small>{reviewable.length} por revisar</small></span></div></div>
                          {reviewable.map((participant) => {
                            const profile = profiles.get(participant.user_id);
                            return (
                              <article key={participant.id} className="gym-battle-review-card-v121">
                                <div className="gym-battle-person-v121"><div>{profile?.avatar_url ? <img src={profile.avatar_url} alt=""/> : <span>{initials(profile)}</span>}</div><span><strong>{profile?.display_name || profile?.username || 'Gymbro'}</strong><small>{profile?.username ? `@${profile.username}` : 'Miembro DadoFit'}</small></span></div>
                                <GymBattleEvidence participant={participant} canUpload={false} canReview onChanged={load}/>
                              </article>
                            );
                          })}
                        </section>
                      )}

                      {battle.status === 'active' && canFinalize && <button className="gym-battle-finalize-v121" type="button" onClick={() => { void finalize(battle.id); }} disabled={Boolean(acting)}><RefreshCw size={15}/> Actualizar cierre</button>}

                      {battle.status === 'completed' && (
                        <div className="gym-battle-result-v121"><Trophy size={21}/><div><strong>{winner ? `${winner.name} gana` : 'Empate entre Gyms'}</strong><span>{challenger?.name ?? 'Gym A'} {challengerPoints} SP · {challenged?.name ?? 'Gym B'} {challengedPoints} SP</span></div></div>
                      )}
                      {battle.status === 'declined' && <div className="gym-battle-info-v121">El Gym rival rechazó esta batalla.</div>}
                      {battle.status === 'expired' && <div className="gym-battle-info-v121">La batalla expiró.</div>}
                    </article>
                  );
                })}
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}
