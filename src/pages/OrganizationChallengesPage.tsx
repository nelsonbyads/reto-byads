import { ArrowLeft, Building2, Check, Clock3, Coins, FileVideo2, Image as ImageIcon, RefreshCw, Send, ShieldCheck, Trophy, Upload, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { Link } from 'react-router-dom';
import { AppHeader } from '../components/AppHeader';
import { useAuth } from '../auth/AuthContext';
import { supabase } from '../lib/supabase';

interface ChallengeRow {
  id: string;
  creator_organization_id: string | null;
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

interface OrganizationRow { id: string; name: string; organization_type: string; }
interface ProfileRow { id: string; username: string | null; display_name: string; avatar_url: string | null; }
interface MembershipRow { organization_id: string; role: string; status: string; }
interface EvidenceRow { id: string; participant_id: string; evidence_kind: 'image' | 'video'; storage_path: string; file_name: string | null; mime_type: string | null; size_bytes: number | null; created_at: string; }
interface EvidenceView extends EvidenceRow { signedUrl: string | null; }

function formatDate(value: string | null) {
  if (!value) return '—';
  try { return new Intl.DateTimeFormat('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(value)); }
  catch { return value; }
}

function formatBytes(bytes: number | null) {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function statusLabel(status: string) {
  const labels: Record<string, string> = { invited: 'Pendiente', accepted: 'Aceptado', declined: 'No participa', submitted: 'En revisión', approved: 'Aprobado', rejected: 'Nueva evidencia', expired: 'Expirado' };
  return labels[status] ?? status;
}

function EvidencePanel({ participant, mode, onChanged }: { participant: ParticipantRow; mode: 'participant' | 'reviewer'; onChanged: () => Promise<void> }) {
  const { user } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<EvidenceView[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [acting, setActing] = useState(false);
  const [notes, setNotes] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const canUpload = mode === 'participant' && ['accepted', 'rejected'].includes(participant.status);
  const canReview = mode === 'reviewer' && participant.status === 'submitted';

  const load = useCallback(async () => {
    if (!supabase) return;
    const client = supabase;
    setLoading(true);
    const { data, error: evidenceError } = await client.from('challenge_evidence').select('id, participant_id, evidence_kind, storage_path, file_name, mime_type, size_bytes, created_at').eq('participant_id', participant.id).order('created_at', { ascending: false });
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
    if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) { setError('Sube una imagen o video compatible.'); return; }

    const client = supabase;
    setUploading(true); setError(''); setMessage('');
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '-').slice(-100) || 'evidence';
    const path = `${user.id}/${participant.id}/${crypto.randomUUID()}-${safeName}`;
    const { error: storageError } = await client.storage.from('challenge-evidence').upload(path, file, { contentType: file.type, upsert: false });
    if (storageError) { setUploading(false); setError(storageError.message); return; }
    const { error: rowError } = await client.from('challenge_evidence').insert({ participant_id: participant.id, evidence_kind: file.type.startsWith('image/') ? 'image' : 'video', storage_path: path, file_name: file.name, mime_type: file.type, size_bytes: file.size });
    if (rowError) { await client.storage.from('challenge-evidence').remove([path]); setUploading(false); setError(rowError.message); return; }
    setUploading(false); setMessage('Evidencia cargada. Ya puedes enviarla a revisión.'); await load();
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
    const { error: rpcError } = await supabase.rpc('submit_organization_challenge', { p_participant_id: participant.id });
    setActing(false);
    if (rpcError) { setError(rpcError.message); return; }
    setMessage('Evidencia enviada a los managers de la organización.');
    await onChanged();
  };

  const review = async (decision: 'approved' | 'rejected') => {
    if (!supabase || !canReview) return;
    setActing(true); setError(''); setMessage('');
    const { data, error: rpcError } = await supabase.rpc('review_organization_challenge', { p_participant_id: participant.id, p_decision: decision, p_notes: notes.trim() || null });
    setActing(false);
    if (rpcError) { setError(rpcError.message); return; }
    const result = data as { reward_blocked?: boolean; coins_granted?: number; xp_granted?: number; sponsor_points?: number } | null;
    if (decision === 'rejected') setMessage('Evidencia rechazada. El miembro deberá subir una nueva.');
    else if (result?.reward_blocked) setMessage('Reto aprobado sin recompensa adicional por política anti-farming.');
    else setMessage(`Aprobado: +${result?.coins_granted ?? 25} DC · +${result?.xp_granted ?? 50} XP · +${result?.sponsor_points ?? 100} SP.`);
    await onChanged();
  };

  return (
    <div className="organization-evidence-v12">
      <div className="organization-evidence-head-v12"><strong>Evidencia</strong>{canUpload && <button type="button" onClick={() => inputRef.current?.click()} disabled={uploading}><Upload size={15}/>{uploading ? 'Subiendo…' : 'Agregar'}</button>}<input ref={inputRef} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm" onChange={(event) => { void upload(event); }}/></div>
      {error && <div className="auth-error">{error}</div>}{message && <div className="auth-success">{message}</div>}
      {loading ? <p className="organization-muted-v12">Cargando evidencia…</p> : items.length === 0 ? <p className="organization-muted-v12">Aún no hay evidencia.</p> : (
        <div className="organization-evidence-list-v12">{items.map((item) => <article key={item.id}><div className="organization-evidence-preview-v12">{item.signedUrl && item.evidence_kind === 'image' ? <img src={item.signedUrl} alt=""/> : item.signedUrl ? <video src={item.signedUrl} controls preload="metadata"/> : item.evidence_kind === 'image' ? <ImageIcon/> : <FileVideo2/>}</div><div><strong>{item.file_name || 'Evidencia'}</strong><small>{formatBytes(item.size_bytes)} · {formatDate(item.created_at)}</small></div>{canUpload && <button type="button" onClick={() => { void remove(item); }}><X size={14}/></button>}</article>)}</div>
      )}
      {canUpload && <button className="organization-submit-v12" type="button" onClick={() => { void submit(); }} disabled={acting || items.length === 0}><Send size={15}/>{participant.status === 'rejected' ? 'Volver a enviar' : 'Enviar a revisión'}</button>}
      {canReview && <div className="organization-review-v12"><label>Comentario opcional<textarea rows={2} maxLength={500} value={notes} onChange={(event) => setNotes(event.target.value)}/></label><div><button type="button" className="reject" onClick={() => { void review('rejected'); }} disabled={acting}><X size={15}/> Pedir otra evidencia</button><button type="button" onClick={() => { void review('approved'); }} disabled={acting}><Check size={15}/> Aprobar</button></div></div>}
    </div>
  );
}

export function OrganizationChallengesPage() {
  const { user } = useAuth();
  const [memberships, setMemberships] = useState<MembershipRow[]>([]);
  const [organizations, setOrganizations] = useState<Map<string, OrganizationRow>>(new Map());
  const [challenges, setChallenges] = useState<Map<string, ChallengeRow>>(new Map());
  const [ownParticipants, setOwnParticipants] = useState<ParticipantRow[]>([]);
  const [managedParticipants, setManagedParticipants] = useState<ParticipantRow[]>([]);
  const [profiles, setProfiles] = useState<Map<string, ProfileRow>>(new Map());
  const [tab, setTab] = useState<'mine' | 'review' | 'published'>('mine');
  const [loading, setLoading] = useState(user?.provider === 'supabase');
  const [error, setError] = useState('');
  const [acting, setActing] = useState<string | null>(null);

  const cloudReady = user?.provider === 'supabase' && Boolean(supabase);

  const load = useCallback(async () => {
    if (!user || user.provider !== 'supabase' || !supabase) { setLoading(false); return; }
    const client = supabase;
    setLoading(true); setError('');

    const [membershipResult, ownResult] = await Promise.all([
      client.from('organization_members').select('organization_id, role, status').eq('user_id', user.id).eq('status', 'active'),
      client.from('challenge_participants').select('id, challenge_id, user_id, status, invited_at, accepted_at, submitted_at, completed_at, rewarded_at, reward_coins_granted, reward_xp_granted, sponsor_points_granted, reward_block_reason').eq('user_id', user.id).order('invited_at', { ascending: false }),
    ]);
    const firstError = membershipResult.error ?? ownResult.error;
    if (firstError) { setError(firstError.message); setLoading(false); return; }

    const membershipRows = (membershipResult.data ?? []) as MembershipRow[];
    setMemberships(membershipRows);
    const orgIds = [...new Set(membershipRows.map((item) => item.organization_id))];
    const managerOrgIds = membershipRows.filter((item) => ['owner', 'admin', 'coach'].includes(item.role)).map((item) => item.organization_id);
    const ownRows = (ownResult.data ?? []) as ParticipantRow[];
    const ownChallengeIds = [...new Set(ownRows.map((item) => item.challenge_id))];

    const [orgResult, ownChallengesResult, managedChallengesResult] = await Promise.all([
      orgIds.length ? client.from('organizations').select('id, name, organization_type').in('id', orgIds) : Promise.resolve({ data: [] as OrganizationRow[], error: null }),
      ownChallengeIds.length ? client.from('challenges').select('id, creator_organization_id, status, exercise_name, reps, dice_level, starts_at, expires_at, reward_coins, reward_xp, sponsor_points').in('id', ownChallengeIds).eq('challenge_type', 'organization') : Promise.resolve({ data: [] as ChallengeRow[], error: null }),
      managerOrgIds.length ? client.from('challenges').select('id, creator_organization_id, status, exercise_name, reps, dice_level, starts_at, expires_at, reward_coins, reward_xp, sponsor_points').in('creator_organization_id', managerOrgIds).eq('challenge_type', 'organization').order('starts_at', { ascending: false }) : Promise.resolve({ data: [] as ChallengeRow[], error: null }),
    ]);
    const secondError = orgResult.error ?? ownChallengesResult.error ?? managedChallengesResult.error;
    if (secondError) { setError(secondError.message); setLoading(false); return; }

    const orgMap = new Map(((orgResult.data ?? []) as OrganizationRow[]).map((item) => [item.id, item]));
    const ownChallenges = (ownChallengesResult.data ?? []) as ChallengeRow[];
    const managedChallenges = (managedChallengesResult.data ?? []) as ChallengeRow[];
    const challengeMap = new Map<string, ChallengeRow>();
    for (const item of [...ownChallenges, ...managedChallenges]) challengeMap.set(item.id, item);
    setOrganizations(orgMap); setChallenges(challengeMap);

    const managedIds = managedChallenges.map((item) => item.id);
    const participantResult = managedIds.length
      ? await client.from('challenge_participants').select('id, challenge_id, user_id, status, invited_at, accepted_at, submitted_at, completed_at, rewarded_at, reward_coins_granted, reward_xp_granted, sponsor_points_granted, reward_block_reason').in('challenge_id', managedIds)
      : { data: [] as ParticipantRow[], error: null };
    if (participantResult.error) { setError(participantResult.error.message); setLoading(false); return; }
    const managerRows = (participantResult.data ?? []) as ParticipantRow[];
    setManagedParticipants(managerRows);

    const organizationChallengeIds = new Set(ownChallenges.map((item) => item.id));
    setOwnParticipants(ownRows.filter((item) => organizationChallengeIds.has(item.challenge_id)));

    const profileIds = [...new Set(managerRows.map((item) => item.user_id))];
    if (profileIds.length) {
      const profileResult = await client.from('profiles').select('id, username, display_name, avatar_url').in('id', profileIds);
      if (profileResult.error) { setError(profileResult.error.message); setLoading(false); return; }
      setProfiles(new Map(((profileResult.data ?? []) as ProfileRow[]).map((item) => [item.id, item])));
    } else setProfiles(new Map());
    setLoading(false);
  }, [user]);

  useEffect(() => { void load(); }, [load]);

  const respond = async (participantId: string, accept: boolean) => {
    if (!supabase) return;
    setActing(participantId);
    const { error: rpcError } = await supabase.rpc('respond_organization_challenge', { p_participant_id: participantId, p_accept: accept });
    setActing(null);
    if (rpcError) setError(rpcError.message); else await load();
  };

  const finalize = async (challengeId: string) => {
    if (!supabase) return;
    setActing(`finalize:${challengeId}`);
    const { error: rpcError } = await supabase.rpc('finalize_organization_challenge', { p_challenge_id: challengeId });
    setActing(null);
    if (rpcError) setError(rpcError.message); else await load();
  };

  const submittedForReview = useMemo(() => managedParticipants.filter((item) => item.status === 'submitted'), [managedParticipants]);
  const published = useMemo(() => [...challenges.values()].filter((item) => memberships.some((membership) => membership.organization_id === item.creator_organization_id && ['owner', 'admin', 'coach'].includes(membership.role))).sort((a, b) => new Date(b.starts_at).getTime() - new Date(a.starts_at).getTime()), [challenges, memberships]);

  return (
    <div className="profile-shell-v9 organization-challenges-shell-v12">
      <AppHeader/>
      <main className="profile-page-v9 organization-challenges-page-v12">
        <div className="organizations-topline-v12"><Link className="profile-back-v9" to="/organizations"><ArrowLeft size={16}/> Organizations</Link>{cloudReady && <button type="button" onClick={() => { void load(); }} disabled={loading}><RefreshCw size={15}/> Actualizar</button>}</div>
        <section className="profile-hero-v9 organizations-hero-v12"><div className="profile-avatar-v9"><ShieldCheck size={31}/></div><div><span className="eyebrow">GYM CHALLENGES</span><h1>Retos de organizaciones</h1><p>Miembros entrenan, managers revisan y cada aprobación puede sumar Sponsor Points.</p></div></section>

        {!cloudReady ? <section className="profile-card-v9 profile-cloud-callout-v9"><h2>Necesitas una cuenta cloud</h2></section> : <>
          <section className="organization-challenge-tabs-v12"><button className={tab === 'mine' ? 'active' : ''} onClick={() => setTab('mine')}>Mis retos <span>{ownParticipants.length}</span></button><button className={tab === 'review' ? 'active' : ''} onClick={() => setTab('review')}>Por revisar <span>{submittedForReview.length}</span></button><button className={tab === 'published' ? 'active' : ''} onClick={() => setTab('published')}>Publicados <span>{published.length}</span></button></section>
          {error && <div className="auth-error">{error}</div>}
          {loading ? <section className="profile-card-v9">Cargando retos…</section> : tab === 'mine' ? (
            <section className="organization-challenge-list-v12">{ownParticipants.length === 0 ? <div className="profile-card-v9 organization-empty-v12"><Building2 size={30}/><h3>No tienes retos de organización</h3><p>Cuando un Gym u organización te publique uno, aparecerá aquí.</p></div> : ownParticipants.map((participant) => {
              const challenge = challenges.get(participant.challenge_id); if (!challenge) return null;
              const org = challenge.creator_organization_id ? organizations.get(challenge.creator_organization_id) : null;
              return <article key={participant.id} className="profile-card-v9 organization-challenge-card-v12"><header><div><span className="eyebrow">{org?.name || 'ORGANIZACIÓN'}</span><h2>{challenge.reps}× {challenge.exercise_name}</h2><p>{challenge.dice_level.toUpperCase()} · hasta {formatDate(challenge.expires_at)}</p></div><span className={`organization-status-v12 status-${participant.status}`}>{statusLabel(participant.status)}</span></header><div className="organization-challenge-rewards-v12"><span><Coins size={14}/> Hasta {challenge.reward_coins} DC</span><span><Trophy size={14}/> Hasta {challenge.reward_xp} XP</span><span><Building2 size={14}/> Hasta {challenge.sponsor_points} SP</span></div>{participant.status === 'invited' && <div className="organization-response-v12"><button className="reject" onClick={() => { void respond(participant.id, false); }} disabled={Boolean(acting)}><X size={15}/> No participar</button><button onClick={() => { void respond(participant.id, true); }} disabled={Boolean(acting)}><Check size={15}/> Aceptar reto</button></div>}{participant.status === 'approved' && <div className="organization-approved-v12"><Check size={18}/><div><strong>Reto aprobado</strong><span>{participant.reward_block_reason ? 'Completado sin recompensa adicional por anti-farming.' : `+${participant.reward_coins_granted} DC · +${participant.reward_xp_granted} XP · +${participant.sponsor_points_granted} SP`}</span></div></div>}{['accepted', 'rejected', 'submitted', 'approved'].includes(participant.status) && <EvidencePanel participant={participant} mode="participant" onChanged={load}/>}</article>;
            })}</section>
          ) : tab === 'review' ? (
            <section className="organization-challenge-list-v12">{submittedForReview.length === 0 ? <div className="profile-card-v9 organization-empty-v12"><ShieldCheck size={30}/><h3>No hay evidencias esperando revisión</h3></div> : submittedForReview.map((participant) => {
              const challenge = challenges.get(participant.challenge_id); if (!challenge) return null;
              const profile = profiles.get(participant.user_id); const org = challenge.creator_organization_id ? organizations.get(challenge.creator_organization_id) : null;
              return <article key={participant.id} className="profile-card-v9 organization-challenge-card-v12"><header><div><span className="eyebrow">REVISIÓN · {org?.name || 'ORGANIZACIÓN'}</span><h2>{profile?.display_name || profile?.username || 'Miembro'}</h2><p>{challenge.reps}× {challenge.exercise_name}</p></div><span className="organization-status-v12 status-submitted">En revisión</span></header><EvidencePanel participant={participant} mode="reviewer" onChanged={load}/></article>;
            })}</section>
          ) : (
            <section className="organization-challenge-list-v12">{published.length === 0 ? <div className="profile-card-v9 organization-empty-v12"><Building2 size={30}/><h3>Aún no has publicado retos</h3><Link className="profile-primary-v9" to="/app">Lanzar dados</Link></div> : published.map((challenge) => {
              const participants = managedParticipants.filter((item) => item.challenge_id === challenge.id); const approved = participants.filter((item) => item.status === 'approved').length; const submitted = participants.filter((item) => item.status === 'submitted').length; const org = challenge.creator_organization_id ? organizations.get(challenge.creator_organization_id) : null;
              return <article key={challenge.id} className="profile-card-v9 organization-published-v12"><header><div><span className="eyebrow">{org?.name || 'ORGANIZACIÓN'}</span><h2>{challenge.reps}× {challenge.exercise_name}</h2><p><Clock3 size={13}/> {formatDate(challenge.starts_at)} → {formatDate(challenge.expires_at)}</p></div><span className={`organization-status-v12 status-${challenge.status}`}>{challenge.status}</span></header><div className="organization-published-stats-v12"><div><span>Participantes</span><strong>{participants.length}</strong></div><div><span>Aprobados</span><strong>{approved}</strong></div><div><span>Por revisar</span><strong>{submitted}</strong></div><div><span>Sponsor Points</span><strong>{participants.reduce((sum, item) => sum + Number(item.sponsor_points_granted ?? 0), 0)} SP</strong></div></div><button type="button" className="organization-finalize-v12" onClick={() => { void finalize(challenge.id); }} disabled={Boolean(acting)}>Actualizar / cerrar si corresponde</button></article>;
            })}</section>
          )}
        </>}
      </main>
    </div>
  );
}
