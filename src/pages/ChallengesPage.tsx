import {
  ArrowLeft,
  Check,
  Clock3,
  Coins,
  Eye,
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
import { useAuth } from '../auth/AuthContext';
import { AppHeader } from '../components/AppHeader';
import { supabase } from '../lib/supabase';

interface ChallengeRow {
  id: string;
  creator_user_id: string | null;
  challenge_type: string;
  status: string;
  exercise_id: string;
  exercise_name: string;
  reps: number;
  dice_level: string;
  starts_at: string;
  expires_at: string | null;
  reward_coins: number;
  reward_xp: number;
}

interface ParticipantRow {
  id: string;
  challenge_id: string;
  user_id: string;
  status: string;
  invited_at: string;
  accepted_at: string | null;
  submitted_at: string | null;
  completed_at: string | null;
  rewarded_at: string | null;
  reward_coins_granted: number;
  reward_xp_granted: number;
}

interface PublicProfile {
  id: string;
  username: string | null;
  display_name: string;
  avatar_url: string | null;
}

interface ChallengeView {
  challenge: ChallengeRow;
  participant: ParticipantRow;
  counterpart: PublicProfile | null;
  direction: 'received' | 'sent';
}

interface EvidenceRow {
  id: string;
  participant_id: string;
  evidence_kind: 'image' | 'video';
  storage_path: string;
  file_name: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  created_at: string;
}

interface EvidenceView extends EvidenceRow {
  signedUrl: string | null;
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    invited: 'Pendiente',
    accepted: 'Aceptado',
    declined: 'Rechazado',
    submitted: 'Evidencia enviada',
    approved: 'Completado',
    rejected: 'Nueva evidencia requerida',
    expired: 'Expirado',
  };
  return labels[status] ?? status;
}

function isExpired(view: ChallengeView) {
  return Boolean(
    view.challenge.expires_at
      && new Date(view.challenge.expires_at).getTime() <= Date.now()
      && !['approved', 'declined', 'expired'].includes(view.participant.status),
  );
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

function formatBytes(bytes: number | null) {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function initials(profile: PublicProfile | null) {
  const name = profile?.display_name?.trim() || profile?.username || 'DF';
  return name.split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'DF';
}

function personName(profile: PublicProfile | null) {
  return profile?.display_name?.trim() || profile?.username || 'Gymbro';
}

function ChallengeEvidence({ view, onChanged }: { view: ChallengeView; onChanged: () => Promise<void> }) {
  const { user } = useAuth();
  const fileInput = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<EvidenceView[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [notes, setNotes] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const participant = view.participant;
  const canUpload = view.direction === 'received' && ['accepted', 'rejected'].includes(participant.status) && !isExpired(view);
  const canSubmit = canUpload && items.length > 0;
  const canReview = view.direction === 'sent' && participant.status === 'submitted';

  const loadEvidence = useCallback(async () => {
    if (!supabase) return;
    const client = supabase;
    setLoading(true);
    setError('');

    const { data, error: evidenceError } = await client
      .from('challenge_evidence')
      .select('id, participant_id, evidence_kind, storage_path, file_name, mime_type, size_bytes, created_at')
      .eq('participant_id', participant.id)
      .order('created_at', { ascending: false });

    if (evidenceError) {
      setError(evidenceError.message);
      setLoading(false);
      return;
    }

    const records = (data ?? []) as EvidenceRow[];
    const hydrated = await Promise.all(records.map(async (record): Promise<EvidenceView> => {
      const { data: signed } = await client.storage.from('challenge-evidence').createSignedUrl(record.storage_path, 3600);
      return { ...record, signedUrl: signed?.signedUrl ?? null };
    }));
    setItems(hydrated);
    setLoading(false);
  }, [participant.id]);

  useEffect(() => {
    void loadEvidence();
  }, [loadEvidence]);

  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !user || user.provider !== 'supabase' || !supabase || !canUpload) return;

    if (file.size > 50 * 1024 * 1024) {
      setError('El archivo supera el límite de 50 MB.');
      return;
    }

    const isImage = file.type.startsWith('image/');
    const isVideo = file.type.startsWith('video/');
    if (!isImage && !isVideo) {
      setError('Sube una imagen o un video compatible.');
      return;
    }

    const client = supabase;
    setUploading(true);
    setError('');
    setMessage('');

    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '-').slice(-100) || 'evidence';
    const storagePath = `${user.id}/${participant.id}/${crypto.randomUUID()}-${safeName}`;

    const { error: storageError } = await client.storage
      .from('challenge-evidence')
      .upload(storagePath, file, { contentType: file.type, upsert: false });

    if (storageError) {
      setUploading(false);
      setError(storageError.message);
      return;
    }

    const { error: rowError } = await client.from('challenge_evidence').insert({
      participant_id: participant.id,
      evidence_kind: isImage ? 'image' : 'video',
      storage_path: storagePath,
      file_name: file.name,
      mime_type: file.type,
      size_bytes: file.size,
    });

    if (rowError) {
      await client.storage.from('challenge-evidence').remove([storagePath]);
      setUploading(false);
      setError(rowError.message);
      return;
    }

    setUploading(false);
    setMessage('Evidencia cargada. Cuando estés listo, envíala a revisión.');
    await loadEvidence();
  };

  const removeEvidence = async (item: EvidenceView) => {
    if (!supabase || !canUpload || !window.confirm('¿Eliminar esta evidencia antes de enviarla?')) return;
    const client = supabase;
    setError('');
    const { error: dbError } = await client.from('challenge_evidence').delete().eq('id', item.id);
    if (dbError) {
      setError(dbError.message);
      return;
    }
    await client.storage.from('challenge-evidence').remove([item.storage_path]);
    await loadEvidence();
  };

  const submit = async () => {
    if (!supabase || !canSubmit) return;
    const client = supabase;
    setSubmitting(true);
    setError('');
    setMessage('');
    const { error: rpcError } = await client.rpc('submit_direct_challenge', { p_participant_id: participant.id });
    setSubmitting(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    setMessage('Evidencia enviada. Tu Gymbro ya puede revisarla.');
    await onChanged();
  };

  const review = async (decision: 'approved' | 'rejected') => {
    if (!supabase || !canReview) return;
    const client = supabase;
    setReviewing(true);
    setError('');
    setMessage('');
    const { data, error: rpcError } = await client.rpc('review_direct_challenge', {
      p_participant_id: participant.id,
      p_decision: decision,
      p_notes: notes.trim() || null,
    });
    setReviewing(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }

    if (decision === 'approved') {
      const result = data as { coins_granted?: number; xp_granted?: number; already_rewarded?: boolean } | null;
      setMessage(result?.already_rewarded
        ? 'Este reto ya había entregado su recompensa. No se duplicaron DadoCoins ni XP.'
        : `Reto aprobado: +${result?.coins_granted ?? 25} DC y +${result?.xp_granted ?? 50} XP.`);
    } else {
      setMessage('Evidencia rechazada. El Gymbro podrá subir una nueva evidencia.');
    }
    await onChanged();
  };

  return (
    <div className="challenge-evidence-v10">
      <div className="challenge-evidence-head-v10">
        <div><span className="eyebrow">EVIDENCIA</span><strong>{items.length} {items.length === 1 ? 'archivo' : 'archivos'}</strong></div>
        {canUpload && <button type="button" onClick={() => fileInput.current?.click()} disabled={uploading}><Upload size={16}/>{uploading ? 'Subiendo…' : 'Agregar evidencia'}</button>}
        <input ref={fileInput} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm" onChange={(event) => { void upload(event); }}/>
      </div>

      {error && <div className="auth-error">{error}</div>}
      {message && <div className="auth-success">{message}</div>}

      {loading ? <p className="challenge-muted-v10">Cargando evidencia…</p> : items.length === 0 ? (
        <div className="challenge-evidence-empty-v10"><ShieldCheck size={20}/><span>Aún no hay evidencia para este reto.</span></div>
      ) : (
        <div className="challenge-evidence-grid-v10">
          {items.map((item) => (
            <article key={item.id} className="challenge-evidence-item-v10">
              <div className="challenge-evidence-preview-v10">
                {item.signedUrl && item.evidence_kind === 'image' && <img src={item.signedUrl} alt={item.file_name ?? 'Evidencia'}/>} 
                {item.signedUrl && item.evidence_kind === 'video' && <video src={item.signedUrl} controls preload="metadata"/>}
                {!item.signedUrl && <span>{item.evidence_kind === 'image' ? <ImageIcon/> : <FileVideo2/>}</span>}
              </div>
              <div className="challenge-evidence-meta-v10">
                <strong>{item.file_name || (item.evidence_kind === 'image' ? 'Foto' : 'Video')}</strong>
                <span>{formatBytes(item.size_bytes)} · {formatDate(item.created_at)}</span>
              </div>
              {canUpload && <button className="challenge-evidence-remove-v10" type="button" onClick={() => { void removeEvidence(item); }} aria-label="Eliminar evidencia"><X size={15}/></button>}
            </article>
          ))}
        </div>
      )}

      {canUpload && (
        <button className="challenge-submit-v10" type="button" onClick={() => { void submit(); }} disabled={!canSubmit || submitting}>
          <Send size={17}/>{submitting ? 'Enviando…' : participant.status === 'rejected' ? 'Volver a enviar evidencia' : 'Enviar evidencia a revisión'}
        </button>
      )}

      {canReview && (
        <div className="challenge-review-v10">
          <label>Comentario opcional<textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={2} maxLength={500} placeholder="Ej: buena técnica, reto cumplido."/></label>
          <div>
            <button className="challenge-reject-v10" type="button" onClick={() => { void review('rejected'); }} disabled={reviewing}><X size={17}/> Pedir otra evidencia</button>
            <button className="challenge-approve-v10" type="button" onClick={() => { void review('approved'); }} disabled={reviewing}><Check size={17}/>{reviewing ? 'Procesando…' : 'Aprobar reto'}</button>
          </div>
          <small><ShieldCheck size={13}/> La recompensa solo se entrega una vez por participante, incluso si se repite la aprobación.</small>
        </div>
      )}
    </div>
  );
}

function ChallengeCard({ view, onChanged }: { view: ChallengeView; onChanged: () => Promise<void> }) {
  const [acting, setActing] = useState(false);
  const [error, setError] = useState('');
  const expired = isExpired(view);
  const effectiveStatus = expired ? 'expired' : view.participant.status;
  const received = view.direction === 'received';

  const respond = async (accept: boolean) => {
    if (!supabase) return;
    const client = supabase;
    setActing(true);
    setError('');
    const { error: rpcError } = await client.rpc('respond_direct_challenge', {
      p_participant_id: view.participant.id,
      p_accept: accept,
    });
    setActing(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    await onChanged();
  };

  const profile = view.counterpart;
  const displayName = personName(profile);

  return (
    <article className={`challenge-card-v10 challenge-status-${effectiveStatus}-v10`}>
      <header className="challenge-card-head-v10">
        <div className="challenge-person-v10">
          <div className="challenge-person-avatar-v10">{profile?.avatar_url ? <img src={profile.avatar_url} alt=""/> : <span>{initials(profile)}</span>}</div>
          <div><span>{received ? 'Te retó' : 'Retaste a'}</span><strong>{displayName}</strong><small>{profile?.username ? `@${profile.username}` : 'Gymbro DadoFit'}</small></div>
        </div>
        <span className={`challenge-status-badge-v10 status-${effectiveStatus}`}>{statusLabel(effectiveStatus)}</span>
      </header>

      <div className="challenge-main-v10">
        <div className="challenge-reps-v10"><strong>{view.challenge.reps}</strong><span>REP</span></div>
        <div className="challenge-exercise-v10"><span className="eyebrow">EJERCICIO</span><h2>{view.challenge.exercise_name}</h2><p>{view.challenge.dice_level.toUpperCase()} · creado {formatDate(view.challenge.starts_at)}</p></div>
      </div>

      <div className="challenge-meta-v10">
        <span><Clock3 size={14}/> Hasta {formatDate(view.challenge.expires_at)}</span>
        <span><Coins size={14}/> {view.challenge.reward_coins} DC</span>
        <span><Trophy size={14}/> {view.challenge.reward_xp} XP</span>
      </div>

      {error && <div className="auth-error">{error}</div>}

      {received && effectiveStatus === 'invited' && (
        <div className="challenge-response-v10">
          <button type="button" className="challenge-decline-v10" onClick={() => { void respond(false); }} disabled={acting}><X size={17}/> Rechazar</button>
          <button type="button" className="challenge-accept-v10" onClick={() => { void respond(true); }} disabled={acting}><Check size={17}/>{acting ? 'Procesando…' : 'Aceptar reto'}</button>
        </div>
      )}

      {effectiveStatus === 'approved' && (
        <div className="challenge-completed-v10"><Check size={20}/><div><strong>Reto cumplido</strong><span>Recompensa entregada una sola vez: +{view.participant.reward_coins_granted} DC · +{view.participant.reward_xp_granted} XP</span></div></div>
      )}

      {effectiveStatus === 'declined' && <div className="challenge-muted-box-v10">El reto fue rechazado.</div>}
      {effectiveStatus === 'expired' && <div className="challenge-muted-box-v10">El tiempo de este reto terminó.</div>}
      {received && effectiveStatus === 'submitted' && <div className="challenge-muted-box-v10"><Eye size={16}/> Evidencia enviada. Esperando revisión del Gymbro que te retó.</div>}
      {received && effectiveStatus === 'rejected' && <div className="challenge-warning-v10">Tu evidencia fue rechazada. Sube una nueva y vuelve a enviarla.</div>}
      {!received && effectiveStatus === 'accepted' && <div className="challenge-muted-box-v10">Tu Gymbro aceptó el reto. Esperando su evidencia.</div>}
      {!received && effectiveStatus === 'rejected' && <div className="challenge-warning-v10">Pediste otra evidencia. Esperando un nuevo envío.</div>}

      {['accepted', 'rejected', 'submitted', 'approved'].includes(effectiveStatus) && (
        <ChallengeEvidence view={view} onChanged={onChanged}/>
      )}
    </article>
  );
}

export function ChallengesPage() {
  const { user } = useAuth();
  const [views, setViews] = useState<ChallengeView[]>([]);
  const [loading, setLoading] = useState(user?.provider === 'supabase');
  const [error, setError] = useState('');
  const [tab, setTab] = useState<'received' | 'sent'>('received');

  const cloudReady = user?.provider === 'supabase' && Boolean(supabase);

  const load = useCallback(async () => {
    if (!user || user.provider !== 'supabase' || !supabase) {
      setLoading(false);
      return;
    }
    const client = supabase;
    setLoading(true);
    setError('');

    const [receivedParticipantsResult, sentChallengesResult] = await Promise.all([
      client
        .from('challenge_participants')
        .select('id, challenge_id, user_id, status, invited_at, accepted_at, submitted_at, completed_at, rewarded_at, reward_coins_granted, reward_xp_granted')
        .eq('user_id', user.id)
        .order('invited_at', { ascending: false }),
      client
        .from('challenges')
        .select('id, creator_user_id, challenge_type, status, exercise_id, exercise_name, reps, dice_level, starts_at, expires_at, reward_coins, reward_xp')
        .eq('creator_user_id', user.id)
        .eq('challenge_type', 'direct')
        .order('starts_at', { ascending: false }),
    ]);

    const firstError = receivedParticipantsResult.error ?? sentChallengesResult.error;
    if (firstError) {
      setError(firstError.message);
      setLoading(false);
      return;
    }

    const receivedParticipants = (receivedParticipantsResult.data ?? []) as ParticipantRow[];
    const sentChallenges = (sentChallengesResult.data ?? []) as ChallengeRow[];
    const receivedIds = [...new Set(receivedParticipants.map((item) => item.challenge_id))];
    const sentIds = sentChallenges.map((item) => item.id);

    const [receivedChallengesResult, sentParticipantsResult] = await Promise.all([
      receivedIds.length
        ? client.from('challenges').select('id, creator_user_id, challenge_type, status, exercise_id, exercise_name, reps, dice_level, starts_at, expires_at, reward_coins, reward_xp').in('id', receivedIds)
        : Promise.resolve({ data: [] as ChallengeRow[], error: null }),
      sentIds.length
        ? client.from('challenge_participants').select('id, challenge_id, user_id, status, invited_at, accepted_at, submitted_at, completed_at, rewarded_at, reward_coins_granted, reward_xp_granted').in('challenge_id', sentIds)
        : Promise.resolve({ data: [] as ParticipantRow[], error: null }),
    ]);

    const secondError = receivedChallengesResult.error ?? sentParticipantsResult.error;
    if (secondError) {
      setError(secondError.message);
      setLoading(false);
      return;
    }

    const receivedChallenges = (receivedChallengesResult.data ?? []) as ChallengeRow[];
    const sentParticipants = (sentParticipantsResult.data ?? []) as ParticipantRow[];
    const receivedChallengeMap = new Map(receivedChallenges.map((item) => [item.id, item]));
    const sentParticipantMap = new Map(sentParticipants.map((item) => [item.challenge_id, item]));

    const profileIds = [...new Set([
      ...receivedChallenges.map((item) => item.creator_user_id).filter((id): id is string => Boolean(id)),
      ...sentParticipants.map((item) => item.user_id),
    ])];

    let profileMap = new Map<string, PublicProfile>();
    if (profileIds.length) {
      const { data: profileData, error: profileError } = await client
        .from('profiles')
        .select('id, username, display_name, avatar_url')
        .in('id', profileIds);
      if (profileError) {
        setError(profileError.message);
        setLoading(false);
        return;
      }
      profileMap = new Map((profileData ?? []).map((profile) => [profile.id, profile as PublicProfile]));
    }

    const receivedViews: ChallengeView[] = receivedParticipants.flatMap((participant) => {
      const challenge = receivedChallengeMap.get(participant.challenge_id);
      if (!challenge || challenge.challenge_type !== 'direct') return [];
      return [{ challenge, participant, counterpart: challenge.creator_user_id ? profileMap.get(challenge.creator_user_id) ?? null : null, direction: 'received' as const }];
    });

    const sentViews: ChallengeView[] = sentChallenges.flatMap((challenge) => {
      const participant = sentParticipantMap.get(challenge.id);
      if (!participant) return [];
      return [{ challenge, participant, counterpart: profileMap.get(participant.user_id) ?? null, direction: 'sent' as const }];
    });

    setViews([...receivedViews, ...sentViews].sort((a, b) => new Date(b.challenge.starts_at).getTime() - new Date(a.challenge.starts_at).getTime()));
    setLoading(false);
  }, [user]);

  useEffect(() => { void load(); }, [load]);

  const received = useMemo(() => views.filter((item) => item.direction === 'received'), [views]);
  const sent = useMemo(() => views.filter((item) => item.direction === 'sent'), [views]);
  const current = tab === 'received' ? received : sent;
  const pendingCount = received.filter((item) => ['invited', 'accepted', 'rejected'].includes(item.participant.status)).length;

  return (
    <div className="profile-shell-v9 challenges-shell-v10">
      <AppHeader/>
      <main className="profile-page-v9 challenges-page-v10">
        <div className="challenges-topline-v10">
          <Link className="profile-back-v9" to="/app"><ArrowLeft size={16}/> Volver a entrenar</Link>
          {cloudReady && <button type="button" onClick={() => { void load(); }} disabled={loading}><RefreshCw size={15}/> Actualizar</button>}
        </div>

        <section className="profile-hero-v9 challenges-hero-v10">
          <div className="profile-avatar-v9"><Swords size={31}/></div>
          <div><span className="eyebrow">DADOFIT SOCIAL</span><h1>Retos 1 vs 1</h1><p>Tus tiradas ahora pueden viajar directo a un Gymbro.</p></div>
          {cloudReady && <div className="challenge-pending-total-v10"><strong>{pendingCount}</strong><span>por completar</span></div>}
        </section>

        {!cloudReady ? (
          <section className="profile-card-v9 profile-cloud-callout-v9"><h2>Necesitas una cuenta cloud</h2><p>Los retos entre Gymbros funcionan con perfiles reales de DadoFit.</p><Link className="profile-primary-v9" to="/register">Crear cuenta DadoFit</Link></section>
        ) : (
          <>
            <section className="challenge-tabs-v10" role="tablist" aria-label="Tipo de retos">
              <button type="button" className={tab === 'received' ? 'active' : ''} onClick={() => setTab('received')}>Recibidos <span>{received.length}</span></button>
              <button type="button" className={tab === 'sent' ? 'active' : ''} onClick={() => setTab('sent')}>Enviados <span>{sent.length}</span></button>
            </section>

            {error && <div className="auth-error challenges-global-error-v10">{error}</div>}
            {loading ? (
              <section className="profile-card-v9 challenge-empty-page-v10">Cargando retos…</section>
            ) : current.length === 0 ? (
              <section className="profile-card-v9 challenge-empty-page-v10">
                <Swords size={34}/><h2>{tab === 'received' ? 'Aún no te han retado' : 'Aún no has enviado retos'}</h2>
                <p>{tab === 'received' ? 'Cuando un Gymbro te mande una tirada aparecerá aquí.' : 'Ve a entrenar, lanza los dados y usa “Retar a un Gymbro”.'}</p>
                <Link className="profile-primary-v9" to="/app">Lanzar dados</Link>
              </section>
            ) : (
              <section className="challenge-list-v10">
                {current.map((view) => <ChallengeCard key={view.participant.id} view={view} onChanged={load}/>) }
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}
