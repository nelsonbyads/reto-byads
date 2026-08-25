import {
  ArrowLeft,
  Check,
  Clock3,
  Coins,
  Crown,
  FileVideo2,
  Image as ImageIcon,
  Plus,
  RefreshCw,
  Send,
  Shield,
  ShieldCheck,
  Swords,
  Trophy,
  Upload,
  UserMinus,
  UserPlus,
  UsersRound,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { AppHeader } from '../components/AppHeader';
import { supabase } from '../lib/supabase';

interface SquadRow {
  id: string;
  owner_user_id: string;
  name: string;
  slug: string;
  visibility: 'private' | 'public';
  description: string | null;
  avatar_url: string | null;
  created_at: string;
}

interface MembershipRow {
  group_id: string;
  user_id: string;
  role: 'owner' | 'admin' | 'member';
  status: 'invited' | 'active' | 'left' | 'removed';
  joined_at: string;
}

interface FriendPair { requester_id: string; addressee_id: string; }

interface PublicProfile {
  id: string;
  username: string | null;
  display_name: string;
  avatar_url: string | null;
}

interface SquadMembershipView extends MembershipRow {
  squad: SquadRow | null;
}

interface BattleRow {
  id: string;
  challenge_id: string;
  challenger_group_id: string;
  challenged_group_id: string;
  created_by_user_id: string;
  accepted_by_user_id: string | null;
  status: 'pending' | 'active' | 'completed' | 'declined' | 'expired' | 'cancelled';
  response_expires_at: string;
  starts_at: string | null;
  expires_at: string | null;
  completed_at: string | null;
  winner_group_id: string | null;
  created_at: string;
}

interface ChallengeRow {
  id: string;
  status: string;
  exercise_id: string;
  exercise_name: string;
  reps: number;
  dice_level: string;
  reward_coins: number;
  reward_xp: number;
  team_points: number;
  expires_at: string | null;
}

interface ParticipantRow {
  id: string;
  challenge_id: string;
  user_id: string;
  group_id: string | null;
  status: string;
  accepted_at: string | null;
  submitted_at: string | null;
  completed_at: string | null;
  rewarded_at: string | null;
  reward_coins_granted: number;
  reward_xp_granted: number;
  reward_block_reason: string | null;
  team_points_granted: number;
}

interface ScoreEventRow {
  id: string;
  challenge_id: string;
  participant_id: string;
  group_id: string | null;
  team_points: number;
}

interface BattleView {
  battle: BattleRow;
  challenge: ChallengeRow | null;
  challenger: SquadRow | null;
  challenged: SquadRow | null;
  participants: ParticipantRow[];
  profiles: Map<string, PublicProfile>;
  scoreEvents: ScoreEventRow[];
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

function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'DF';
}

function profileName(profile: PublicProfile | null | undefined) {
  return profile?.display_name?.trim() || profile?.username || 'Gymbro';
}

function formatDate(value: string | null) {
  if (!value) return '—';
  try {
    return new Intl.DateTimeFormat('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
  } catch {
    return value;
  }
}

function formatBytes(bytes: number | null) {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function battleStatusLabel(status: BattleRow['status']) {
  const labels: Record<BattleRow['status'], string> = {
    pending: 'Esperando rival',
    active: 'En batalla',
    completed: 'Finalizada',
    declined: 'Rechazada',
    expired: 'Expirada',
    cancelled: 'Cancelada',
  };
  return labels[status];
}

function participantStatusLabel(status: string) {
  const labels: Record<string, string> = {
    accepted: 'Listo para competir',
    submitted: 'En revisión',
    approved: 'Aprobado',
    rejected: 'Nueva evidencia',
    declined: 'No participa',
    expired: 'Expirado',
  };
  return labels[status] ?? status;
}

function battleExpired(view: BattleView) {
  return Boolean(view.battle.expires_at && new Date(view.battle.expires_at).getTime() <= Date.now());
}

async function evidenceWithUrls(client: NonNullable<typeof supabase>, participantId: string): Promise<EvidenceView[]> {
  const { data, error } = await client
    .from('challenge_evidence')
    .select('id, participant_id, evidence_kind, storage_path, file_name, mime_type, size_bytes, created_at')
    .eq('participant_id', participantId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  const rows = (data ?? []) as EvidenceRow[];
  return Promise.all(rows.map(async (row) => {
    const { data: signed } = await client.storage.from('challenge-evidence').createSignedUrl(row.storage_path, 3600);
    return { ...row, signedUrl: signed?.signedUrl ?? null };
  }));
}

function EvidenceCards({ items }: { items: EvidenceView[] }) {
  if (items.length === 0) return <div className="squad-evidence-empty-v11"><ShieldCheck size={18}/> Aún no hay evidencia.</div>;
  return (
    <div className="squad-evidence-grid-v11">
      {items.map((item) => (
        <article className="squad-evidence-item-v11" key={item.id}>
          <div className="squad-evidence-preview-v11">
            {item.signedUrl && item.evidence_kind === 'image' && <img src={item.signedUrl} alt={item.file_name ?? 'Evidencia'}/>} 
            {item.signedUrl && item.evidence_kind === 'video' && <video src={item.signedUrl} controls preload="metadata"/>}
            {!item.signedUrl && (item.evidence_kind === 'image' ? <ImageIcon/> : <FileVideo2/>)}
          </div>
          <div><strong>{item.file_name || 'Evidencia'}</strong><span>{formatBytes(item.size_bytes)} · {formatDate(item.created_at)}</span></div>
        </article>
      ))}
    </div>
  );
}

function MyBattleParticipation({ participant, challenge, onChanged }: { participant: ParticipantRow; challenge: ChallengeRow; onChanged: () => Promise<void> }) {
  const { user } = useAuth();
  const input = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<EvidenceView[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [acting, setActing] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const canPrepare = ['accepted', 'rejected'].includes(participant.status);

  const loadEvidence = useCallback(async () => {
    if (!supabase) return;
    const client = supabase;
    setLoading(true);
    try {
      setItems(await evidenceWithUrls(client, participant.id));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No pudimos cargar la evidencia.');
    } finally {
      setLoading(false);
    }
  }, [participant.id]);

  useEffect(() => { void loadEvidence(); }, [loadEvidence]);

  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !user || user.provider !== 'supabase' || !supabase || !canPrepare) return;
    if (file.size > 50 * 1024 * 1024) {
      setError('El archivo supera el límite de 50 MB.');
      return;
    }
    if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) {
      setError('Sube una foto o video compatible.');
      return;
    }

    const client = supabase;
    setUploading(true);
    setError('');
    setMessage('');
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '-').slice(-100) || 'evidence';
    const storagePath = `${user.id}/${participant.id}/${crypto.randomUUID()}-${safeName}`;
    const { error: storageError } = await client.storage.from('challenge-evidence').upload(storagePath, file, { contentType: file.type, upsert: false });
    if (storageError) {
      setUploading(false);
      setError(storageError.message);
      return;
    }

    const { error: rowError } = await client.from('challenge_evidence').insert({
      participant_id: participant.id,
      evidence_kind: file.type.startsWith('image/') ? 'image' : 'video',
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
    setMessage('Evidencia cargada. Envíala cuando estés listo.');
    await loadEvidence();
  };

  const submit = async () => {
    if (!supabase || items.length === 0 || !canPrepare) return;
    const client = supabase;
    setActing(true);
    setError('');
    setMessage('');
    const { error: rpcError } = await client.rpc('submit_group_challenge', { p_participant_id: participant.id });
    setActing(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    setMessage('Evidencia enviada al capitán rival.');
    await onChanged();
  };

  const decline = async () => {
    if (!supabase || !canPrepare || !window.confirm('¿No participar en esta batalla? Tu Squad no recibirá Team Points por tu participación.')) return;
    const client = supabase;
    setActing(true);
    setError('');
    const { error: rpcError } = await client.rpc('decline_group_challenge_participation', { p_participant_id: participant.id });
    setActing(false);
    if (rpcError) setError(rpcError.message);
    else await onChanged();
  };

  return (
    <section className="squad-my-participation-v11">
      <div className="squad-section-head-v11"><div><span className="eyebrow">TU APORTE</span><h4>{participantStatusLabel(participant.status)}</h4></div><span>{participant.status === 'approved' ? participant.team_points_granted : challenge.team_points} TP</span></div>
      {error && <div className="auth-error">{error}</div>}
      {message && <div className="auth-success">{message}</div>}
      {loading ? <p className="squad-muted-v11">Cargando evidencia…</p> : <EvidenceCards items={items}/>} 

      {canPrepare && (
        <div className="squad-participant-actions-v11">
          <button type="button" onClick={() => input.current?.click()} disabled={uploading || acting}><Upload size={16}/>{uploading ? 'Subiendo…' : 'Agregar evidencia'}</button>
          <button className="primary" type="button" onClick={() => { void submit(); }} disabled={acting || items.length === 0}><Send size={16}/>{acting ? 'Procesando…' : participant.status === 'rejected' ? 'Reenviar evidencia' : 'Enviar a revisión'}</button>
          <button className="text-danger" type="button" onClick={() => { void decline(); }} disabled={acting}>No participar</button>
          <input ref={input} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm" onChange={(event) => { void upload(event); }}/>
        </div>
      )}

      {participant.status === 'submitted' && <p className="squad-waiting-v11">El capitán del Squad rival está revisando tu evidencia.</p>}
      {participant.status === 'approved' && <div className="squad-approved-v11"><Trophy size={18}/><strong>¡Aporte aprobado!</strong><span>{participant.reward_block_reason ? `Anti-farming activo · +0 DC · +0 XP · +0 Team Points` : `+${participant.reward_coins_granted} DC · +${participant.reward_xp_granted} XP · +${participant.team_points_granted} Team Points`}</span></div>}
      {participant.status === 'declined' && <p className="squad-muted-v11">Decidiste no participar en esta batalla.</p>}
    </section>
  );
}

function ReviewSubmission({ participant, profile, challenge, onChanged }: { participant: ParticipantRow; profile: PublicProfile | null; challenge: ChallengeRow; onChanged: () => Promise<void> }) {
  const [items, setItems] = useState<EvidenceView[]>([]);
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(true);
  const [reviewing, setReviewing] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!supabase) return;
    const client = supabase;
    let active = true;
    void evidenceWithUrls(client, participant.id)
      .then((records) => { if (active) setItems(records); })
      .catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : 'No pudimos cargar la evidencia.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [participant.id]);

  const review = async (decision: 'approved' | 'rejected') => {
    if (!supabase) return;
    const client = supabase;
    setReviewing(true);
    setError('');
    const { error: rpcError } = await client.rpc('review_group_challenge', {
      p_participant_id: participant.id,
      p_decision: decision,
      p_notes: notes.trim() || null,
    });
    setReviewing(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    await onChanged();
  };

  const name = profileName(profile);
  return (
    <article className="squad-review-card-v11">
      <div className="squad-person-v11"><div className="squad-avatar-v11">{profile?.avatar_url ? <img src={profile.avatar_url} alt=""/> : initials(name)}</div><div><strong>{name}</strong><span>{profile?.username ? `@${profile.username}` : 'Rival'}</span></div></div>
      {error && <div className="auth-error">{error}</div>}
      {loading ? <p className="squad-muted-v11">Cargando evidencia…</p> : <EvidenceCards items={items}/>} 
      <label className="squad-review-notes-v11">Comentario opcional<textarea rows={2} maxLength={500} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Ej: técnica correcta, reto cumplido."/></label>
      <div className="squad-review-actions-v11">
        <button className="reject" type="button" disabled={reviewing} onClick={() => { void review('rejected'); }}><X size={16}/> Pedir otra evidencia</button>
        <button className="approve" type="button" disabled={reviewing} onClick={() => { void review('approved'); }}><Check size={16}/>{reviewing ? 'Procesando…' : 'Aprobar aporte'}</button>
      </div>
      <small><ShieldCheck size={13}/> DadoCoins, XP y Team Points dependen de las reglas anti-farming y nunca se duplican.</small>
    </article>
  );
}

export function SquadsPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState<'squads' | 'battles'>('squads');
  const [loading, setLoading] = useState(user?.provider === 'supabase');
  const [refreshing, setRefreshing] = useState(false);
  const [actingId, setActingId] = useState<string | null>(null);
  const [memberships, setMemberships] = useState<SquadMembershipView[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState('');
  const [selectedMembers, setSelectedMembers] = useState<MembershipRow[]>([]);
  const [memberProfiles, setMemberProfiles] = useState<Map<string, PublicProfile>>(new Map());
  const [gymbros, setGymbros] = useState<PublicProfile[]>([]);
  const [battles, setBattles] = useState<BattleView[]>([]);
  const [newName, setNewName] = useState('');
  const [newVisibility, setNewVisibility] = useState<'public' | 'private'>('public');
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const cloudReady = user?.provider === 'supabase' && Boolean(supabase);
  const activeMemberships = useMemo(() => memberships.filter((item) => item.status === 'active'), [memberships]);
  const invitations = useMemo(() => memberships.filter((item) => item.status === 'invited'), [memberships]);
  const activeMembershipByGroup = useMemo(() => new Map(activeMemberships.map((item) => [item.group_id, item])), [activeMemberships]);
  const adminGroupIds = useMemo(() => new Set(activeMemberships.filter((item) => ['owner', 'admin'].includes(item.role)).map((item) => item.group_id)), [activeMemberships]);
  const selectedMembership = activeMembershipByGroup.get(selectedGroupId);
  const selectedSquad = selectedMembership?.squad ?? null;
  const selectedMemberIds = useMemo(() => new Set(selectedMembers.filter((item) => ['active', 'invited'].includes(item.status)).map((item) => item.user_id)), [selectedMembers]);

  const loadSquads = useCallback(async () => {
    if (!user || user.provider !== 'supabase' || !supabase) {
      setLoading(false);
      return;
    }
    const client = supabase;
    const { data: membershipData, error: membershipError } = await client
      .from('group_members')
      .select('group_id, user_id, role, status, joined_at')
      .eq('user_id', user.id)
      .in('status', ['active', 'invited'])
      .order('joined_at', { ascending: false });

    if (membershipError) throw membershipError;
    const rows = (membershipData ?? []) as MembershipRow[];
    const ids = [...new Set(rows.map((row) => row.group_id))];
    let groupMap = new Map<string, SquadRow>();
    if (ids.length > 0) {
      const { data: groupsData, error: groupsError } = await client
        .from('groups')
        .select('id, owner_user_id, name, slug, visibility, description, avatar_url, created_at')
        .in('id', ids);
      if (groupsError) throw groupsError;
      groupMap = new Map(((groupsData ?? []) as SquadRow[]).map((group) => [group.id, group]));
    }

    const views = rows.map((row) => ({ ...row, squad: groupMap.get(row.group_id) ?? null }));
    setMemberships(views);
    const activeIds = views.filter((item) => item.status === 'active').map((item) => item.group_id);
    setSelectedGroupId((current) => current && activeIds.includes(current) ? current : (activeIds[0] ?? ''));
  }, [user]);

  const loadBattles = useCallback(async () => {
    if (!user || user.provider !== 'supabase' || !supabase) return;
    const client = supabase;
    const { data: battleData, error: battleError } = await client
      .from('group_battles')
      .select('id, challenge_id, challenger_group_id, challenged_group_id, created_by_user_id, accepted_by_user_id, status, response_expires_at, starts_at, expires_at, completed_at, winner_group_id, created_at')
      .order('created_at', { ascending: false });
    if (battleError) throw battleError;
    const battleRows = (battleData ?? []) as BattleRow[];
    if (battleRows.length === 0) {
      setBattles([]);
      return;
    }

    const challengeIds = battleRows.map((item) => item.challenge_id);
    const groupIds = [...new Set(battleRows.flatMap((item) => [item.challenger_group_id, item.challenged_group_id]))];
    const [challengeResult, groupResult, participantResult, scoreResult] = await Promise.all([
      client.from('challenges').select('id, status, exercise_id, exercise_name, reps, dice_level, reward_coins, reward_xp, team_points, expires_at').in('id', challengeIds),
      client.from('groups').select('id, owner_user_id, name, slug, visibility, description, avatar_url, created_at').in('id', groupIds),
      client.from('challenge_participants').select('id, challenge_id, user_id, group_id, status, accepted_at, submitted_at, completed_at, rewarded_at, reward_coins_granted, reward_xp_granted, reward_block_reason, team_points_granted').in('challenge_id', challengeIds),
      client.from('score_events').select('id, challenge_id, participant_id, group_id, team_points').in('challenge_id', challengeIds),
    ]);

    const firstError = challengeResult.error ?? groupResult.error ?? participantResult.error ?? scoreResult.error;
    if (firstError) throw firstError;

    const challengeMap = new Map(((challengeResult.data ?? []) as ChallengeRow[]).map((item) => [item.id, item]));
    const groupMap = new Map(((groupResult.data ?? []) as SquadRow[]).map((item) => [item.id, item]));
    const participants = (participantResult.data ?? []) as ParticipantRow[];
    const profileIds = [...new Set(participants.map((item) => item.user_id))];
    let profileMap = new Map<string, PublicProfile>();
    if (profileIds.length > 0) {
      const { data: profileData, error: profileError } = await client.from('profiles').select('id, username, display_name, avatar_url').in('id', profileIds);
      if (profileError) throw profileError;
      profileMap = new Map(((profileData ?? []) as PublicProfile[]).map((item) => [item.id, item]));
    }
    const scores = (scoreResult.data ?? []) as ScoreEventRow[];

    setBattles(battleRows.map((battle) => ({
      battle,
      challenge: challengeMap.get(battle.challenge_id) ?? null,
      challenger: groupMap.get(battle.challenger_group_id) ?? null,
      challenged: groupMap.get(battle.challenged_group_id) ?? null,
      participants: participants.filter((item) => item.challenge_id === battle.challenge_id),
      profiles: profileMap,
      scoreEvents: scores.filter((item) => item.challenge_id === battle.challenge_id),
    })));
  }, [user]);

  const refreshAll = useCallback(async () => {
    if (!cloudReady) {
      setLoading(false);
      return;
    }
    setRefreshing(true);
    setError('');
    try {
      await Promise.all([loadSquads(), loadBattles()]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No pudimos cargar Squads.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [cloudReady, loadBattles, loadSquads]);

  useEffect(() => { void refreshAll(); }, [refreshAll]);

  useEffect(() => {
    if (!selectedGroupId || !user || user.provider !== 'supabase' || !supabase) {
      setSelectedMembers([]);
      setMemberProfiles(new Map());
      setGymbros([]);
      return;
    }
    const client = supabase;
    let active = true;

    const loadDetails = async () => {
      const { data: membersData, error: membersError } = await client
        .from('group_members')
        .select('group_id, user_id, role, status, joined_at')
        .eq('group_id', selectedGroupId)
        .in('status', ['active', 'invited'])
        .order('joined_at');
      if (!active) return;
      if (membersError) {
        setError(membersError.message);
        return;
      }
      const rows = (membersData ?? []) as MembershipRow[];
      setSelectedMembers(rows);
      const ids = [...new Set(rows.map((item) => item.user_id))];
      if (ids.length > 0) {
        const { data: profilesData } = await client.from('profiles').select('id, username, display_name, avatar_url').in('id', ids);
        if (active) setMemberProfiles(new Map(((profilesData ?? []) as PublicProfile[]).map((item) => [item.id, item])));
      } else {
        setMemberProfiles(new Map());
      }

      if (!adminGroupIds.has(selectedGroupId)) {
        setGymbros([]);
        return;
      }
      const [sent, received] = await Promise.all([
        client.from('friendships').select('requester_id, addressee_id').eq('requester_id', user.id).eq('status', 'accepted'),
        client.from('friendships').select('requester_id, addressee_id').eq('addressee_id', user.id).eq('status', 'accepted'),
      ]);
      if (!active) return;
      const relationError = sent.error ?? received.error;
      if (relationError) {
        setError(relationError.message);
        return;
      }
      const gymbroIds = [...new Set([
        ...((sent.data ?? []) as FriendPair[]).map((row) => row.addressee_id),
        ...((received.data ?? []) as FriendPair[]).map((row) => row.requester_id),
      ])];
      if (gymbroIds.length === 0) {
        setGymbros([]);
        return;
      }
      const { data: gymbroData, error: gymbroError } = await client.from('profiles').select('id, username, display_name, avatar_url').in('id', gymbroIds).order('display_name');
      if (!active) return;
      if (gymbroError) setError(gymbroError.message);
      else setGymbros((gymbroData ?? []) as PublicProfile[]);
    };

    void loadDetails();
    return () => { active = false; };
  }, [selectedGroupId, user, adminGroupIds]);

  const createSquad = async (event: FormEvent) => {
    event.preventDefault();
    if (!supabase || !newName.trim()) return;
    const client = supabase;
    setCreating(true);
    setError('');
    setMessage('');
    const { data, error: rpcError } = await client.rpc('create_squad', { p_name: newName.trim(), p_visibility: newVisibility });
    setCreating(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    setNewName('');
    setMessage('Squad creado. Ya puedes invitar Gymbros.');
    if (data) setSelectedGroupId(String(data));
    await refreshAll();
  };

  const act = async (id: string, action: () => Promise<{ error: { message: string } | null }>, success: string) => {
    setActingId(id);
    setError('');
    setMessage('');
    const { error: actionError } = await action();
    setActingId(null);
    if (actionError) {
      setError(actionError.message);
      return;
    }
    setMessage(success);
    await refreshAll();
  };

  const respondInvite = async (groupId: string, accept: boolean) => {
    if (!supabase) return;
    const client = supabase;
    await act(groupId, async () => {
      const { error: rpcError } = await client.rpc('respond_squad_invite', { p_group_id: groupId, p_accept: accept });
      return { error: rpcError };
    }, accept ? 'Te uniste al Squad.' : 'Invitación rechazada.');
  };

  const inviteGymbro = async (profileId: string) => {
    if (!supabase || !selectedGroupId) return;
    const client = supabase;
    await act(profileId, async () => {
      const { error: rpcError } = await client.rpc('invite_squad_member', { p_group_id: selectedGroupId, p_user_id: profileId });
      return { error: rpcError };
    }, 'Invitación enviada al Gymbro.');
  };

  const removeMember = async (profileId: string) => {
    if (!supabase || !selectedGroupId || !window.confirm('¿Sacar a este miembro del Squad?')) return;
    const client = supabase;
    await act(profileId, async () => {
      const { error: rpcError } = await client.rpc('remove_squad_member', { p_group_id: selectedGroupId, p_user_id: profileId });
      return { error: rpcError };
    }, 'Miembro retirado del Squad.');
  };

  const leaveSquad = async () => {
    if (!supabase || !selectedGroupId || !window.confirm('¿Salir de este Squad?')) return;
    const client = supabase;
    await act(selectedGroupId, async () => {
      const { error: rpcError } = await client.rpc('leave_squad', { p_group_id: selectedGroupId });
      return { error: rpcError };
    }, 'Saliste del Squad.');
  };

  const respondBattle = async (battleId: string, accept: boolean) => {
    if (!supabase) return;
    const client = supabase;
    await act(battleId, async () => {
      const { error: rpcError } = await client.rpc('respond_group_challenge', { p_battle_id: battleId, p_accept: accept });
      return { error: rpcError };
    }, accept ? 'Batalla aceptada. ¡A competir!' : 'Batalla rechazada.');
  };

  const finalizeBattle = async (battleId: string) => {
    if (!supabase) return;
    const client = supabase;
    await act(battleId, async () => {
      const { error: rpcError } = await client.rpc('finalize_group_battle', { p_battle_id: battleId });
      return { error: rpcError };
    }, 'Batalla finalizada.');
  };

  const renderProfile = (profile: PublicProfile | undefined, role?: MembershipRow['role']) => {
    const name = profileName(profile);
    return (
      <div className="squad-person-v11">
        <div className="squad-avatar-v11">{profile?.avatar_url ? <img src={profile.avatar_url} alt=""/> : initials(name)}</div>
        <div><strong>{name}</strong><span>{profile?.username ? `@${profile.username}` : 'Gymbro DadoFit'}{role ? ` · ${role === 'owner' ? 'capitán' : role}` : ''}</span></div>
      </div>
    );
  };

  if (!cloudReady) {
    return (
      <div className="profile-shell-v9"><AppHeader/><main className="profile-page-v9 squads-page-v11"><Link className="profile-back-v9" to="/app"><ArrowLeft size={16}/> Volver a entrenar</Link><section className="profile-card-v9 profile-cloud-callout-v9"><h2>Squads necesita una cuenta cloud</h2><p>Crea una cuenta DadoFit para formar equipos, competir y acumular Team Points.</p><Link className="profile-primary-v9" to="/register">Crear cuenta</Link></section></main></div>
    );
  }

  return (
    <div className="profile-shell-v9">
      <AppHeader/>
      <main className="profile-page-v9 squads-page-v11">
        <div className="squads-topline-v11">
          <Link className="profile-back-v9" to="/app"><ArrowLeft size={16}/> Volver a entrenar</Link>
          <button type="button" onClick={() => { void refreshAll(); }} disabled={refreshing}><RefreshCw size={15}/>{refreshing ? 'Actualizando…' : 'Actualizar'}</button>
        </div>

        <section className="profile-hero-v9 squads-hero-v11">
          <div className="profile-avatar-v9"><Shield size={34}/></div>
          <div><span className="eyebrow">DADOFIT TEAMS</span><h1>Squads</h1><p>Forma tu equipo, reta a otros Squads y convierte cada aprobación en Team Points.</p></div>
          <div className="squads-hero-stats-v11"><div><strong>{activeMemberships.length}</strong><span>Squads</span></div><div><strong>{battles.filter((item) => item.battle.status === 'active').length}</strong><span>Batallas activas</span></div></div>
        </section>

        <div className="squads-tabs-v11">
          <button className={tab === 'squads' ? 'active' : ''} onClick={() => setTab('squads')}><UsersRound size={16}/> Mis Squads</button>
          <button className={tab === 'battles' ? 'active' : ''} onClick={() => setTab('battles')}><Swords size={16}/> Batallas <span>{battles.length}</span></button>
        </div>

        {error && <div className="auth-error squads-global-feedback-v11">{error}</div>}
        {message && <div className="auth-success squads-global-feedback-v11">{message}</div>}

        {loading ? <section className="profile-card-v9">Cargando Squads…</section> : tab === 'squads' ? (
          <div className="squads-layout-v11">
            <aside className="squads-sidebar-v11">
              <form className="profile-card-v9 squad-create-v11" onSubmit={createSquad}>
                <span className="eyebrow">NUEVO EQUIPO</span><h2>Crear Squad</h2>
                <label>Nombre<input value={newName} onChange={(event) => setNewName(event.target.value)} minLength={3} maxLength={60} placeholder="Los Titanes" required/></label>
                <label>Visibilidad<select value={newVisibility} onChange={(event) => setNewVisibility(event.target.value as 'public' | 'private')}><option value="public">Público · puede recibir retos</option><option value="private">Privado</option></select></label>
                <button className="profile-primary-v9" type="submit" disabled={creating}><Plus size={16}/>{creating ? 'Creando…' : 'Crear Squad'}</button>
              </form>

              {invitations.length > 0 && <section className="profile-card-v9 squad-invitations-v11"><span className="eyebrow">INVITACIONES</span><h2>Te quieren en su equipo</h2>{invitations.map((item) => <article key={item.group_id}><div><strong>{item.squad?.name ?? 'Squad'}</strong><span>@{item.squad?.slug}</span></div><div><button onClick={() => { void respondInvite(item.group_id, true); }} disabled={actingId === item.group_id}><Check size={15}/> Aceptar</button><button className="secondary" onClick={() => { void respondInvite(item.group_id, false); }} disabled={actingId === item.group_id}><X size={15}/> Rechazar</button></div></article>)}</section>}

              <section className="profile-card-v9 squad-list-v11"><span className="eyebrow">TUS EQUIPOS</span><h2>Mis Squads</h2>{activeMemberships.length === 0 ? <p className="squad-muted-v11">Todavía no perteneces a ningún Squad.</p> : activeMemberships.map((item) => <button key={item.group_id} className={selectedGroupId === item.group_id ? 'selected' : ''} onClick={() => setSelectedGroupId(item.group_id)}><span className="squad-mini-mark-v11"><Shield size={16}/></span><span><strong>{item.squad?.name ?? 'Squad'}</strong><small>{item.role === 'owner' ? 'Capitán' : item.role}</small></span></button>)}</section>
            </aside>

            <section className="squads-main-v11">
              {!selectedSquad ? <section className="profile-card-v9 squad-empty-v11"><Shield size={34}/><h2>Crea tu primer Squad</h2><p>Después podrás invitar Gymbros y lanzar una tirada como batalla entre equipos.</p></section> : <>
                <section className="profile-card-v9 squad-detail-head-v11">
                  <div className="squad-detail-title-v11"><div className="squad-big-mark-v11"><Shield size={26}/></div><div><span className="eyebrow">{selectedSquad.visibility === 'public' ? 'SQUAD PÚBLICO' : 'SQUAD PRIVADO'}</span><h2>{selectedSquad.name}</h2><p>@{selectedSquad.slug}</p></div></div>
                  <div className="squad-detail-meta-v11"><div><strong>{selectedMembers.filter((item) => item.status === 'active').length}</strong><span>miembros</span></div><div><strong>{selectedMembership?.role === 'owner' ? 'Capitán' : selectedMembership?.role}</strong><span>tu rol</span></div></div>
                  {selectedMembership && selectedMembership.role !== 'owner' && <button className="squad-leave-v11" type="button" onClick={() => { void leaveSquad(); }}>Salir del Squad</button>}
                </section>

                <section className="profile-card-v9 squad-roster-v11"><div className="squad-section-head-v11"><div><span className="eyebrow">ROSTER</span><h3>Miembros</h3></div><span>{selectedMembers.filter((item) => item.status === 'active').length}</span></div><div className="squad-member-list-v11">{selectedMembers.map((member) => <article key={member.user_id}>{renderProfile(memberProfiles.get(member.user_id), member.role)}<div className="squad-member-actions-v11"><span className={`squad-member-status-v11 ${member.status}`}>{member.status === 'active' ? 'Activo' : 'Invitado'}</span>{adminGroupIds.has(selectedGroupId) && member.role !== 'owner' && member.user_id !== user?.id && <button type="button" onClick={() => { void removeMember(member.user_id); }} disabled={actingId === member.user_id}><UserMinus size={15}/> Retirar</button>}</div></article>)}</div></section>

                {adminGroupIds.has(selectedGroupId) && <section className="profile-card-v9 squad-invite-gymbros-v11"><div className="squad-section-head-v11"><div><span className="eyebrow">RECLUTAR</span><h3>Invitar Gymbros</h3></div><UserPlus size={20}/></div>{gymbros.length === 0 ? <p className="squad-muted-v11">Agrega Gymbros primero para poder invitarlos al Squad.</p> : <div className="squad-member-list-v11">{gymbros.map((profile) => <article key={profile.id}>{renderProfile(profile)}{selectedMemberIds.has(profile.id) ? <span className="squad-member-status-v11 active">En el Squad</span> : <button type="button" onClick={() => { void inviteGymbro(profile.id); }} disabled={actingId === profile.id}><UserPlus size={15}/> Invitar</button>}</article>)}</div>}</section>}

                <section className="profile-card-v9 squad-battle-cta-v11"><div><span className="eyebrow">SIGUIENTE PASO</span><h3>¿Listos para competir?</h3><p>Lanza los dados en el entrenamiento y usa <strong>“Retar con mi Squad”</strong> para mandar la misma tirada a otro equipo.</p></div><Link className="profile-primary-v9" to="/app"><Swords size={16}/> Lanzar dados</Link></section>
              </>}
            </section>
          </div>
        ) : (
          <section className="squad-battles-v11">
            {battles.length === 0 ? <section className="profile-card-v9 squad-empty-v11"><Swords size={34}/><h2>Aún no hay batallas</h2><p>Un capitán puede lanzar dados y retar a otro Squad público.</p><Link className="profile-primary-v9" to="/app">Crear batalla desde una tirada</Link></section> : battles.map((view) => {
              const challenge = view.challenge;
              const challengerName = view.challenger?.name ?? 'Squad A';
              const challengedName = view.challenged?.name ?? 'Squad B';
              const challengerPoints = view.scoreEvents.filter((item) => item.group_id === view.battle.challenger_group_id).reduce((total, item) => total + Number(item.team_points ?? 0), 0);
              const challengedPoints = view.scoreEvents.filter((item) => item.group_id === view.battle.challenged_group_id).reduce((total, item) => total + Number(item.team_points ?? 0), 0);
              const challengerParticipants = view.participants.filter((item) => item.group_id === view.battle.challenger_group_id);
              const challengedParticipants = view.participants.filter((item) => item.group_id === view.battle.challenged_group_id);
              const myParticipant = view.participants.find((item) => item.user_id === user?.id);
              const isChallengedAdmin = adminGroupIds.has(view.battle.challenged_group_id);
              const isChallengerAdmin = adminGroupIds.has(view.battle.challenger_group_id);
              const reviewGroupId = isChallengerAdmin ? view.battle.challenged_group_id : isChallengedAdmin ? view.battle.challenger_group_id : null;
              const reviewQueue = view.participants.filter((item) => item.status === 'submitted' && item.group_id === reviewGroupId);
              const terminal = view.participants.length > 0 && view.participants.every((item) => ['approved', 'declined', 'expired'].includes(item.status));
              const hasSubmitted = view.participants.some((item) => item.status === 'submitted');
              const canFinalize = view.battle.status === 'active' && (terminal || (battleExpired(view) && !hasSubmitted)) && (isChallengedAdmin || isChallengerAdmin);
              const winnerName = view.battle.winner_group_id === view.battle.challenger_group_id ? challengerName : view.battle.winner_group_id === view.battle.challenged_group_id ? challengedName : null;

              return (
                <article className={`profile-card-v9 squad-battle-card-v11 battle-${view.battle.status}`} key={view.battle.id}>
                  <header className="squad-battle-head-v11"><div><span className="eyebrow">SQUAD VS SQUAD</span><h2>{challengerName} <Swords size={18}/> {challengedName}</h2><p>{challenge ? `${challenge.reps}× ${challenge.exercise_name}` : 'Cargando reto…'}</p></div><span className={`squad-battle-status-v11 ${view.battle.status}`}>{battleStatusLabel(view.battle.status)}</span></header>

                  <div className="squad-scoreboard-v11"><div className={view.battle.winner_group_id === view.battle.challenger_group_id ? 'winner' : ''}><span>{challengerName}</span><strong>{challengerPoints}</strong><small>{challengerParticipants.filter((item) => item.status === 'approved').length}/{challengerParticipants.length || '—'} aprobados</small></div><div className="versus"><Swords size={22}/><span>TEAM POINTS</span></div><div className={view.battle.winner_group_id === view.battle.challenged_group_id ? 'winner' : ''}><span>{challengedName}</span><strong>{challengedPoints}</strong><small>{challengedParticipants.filter((item) => item.status === 'approved').length}/{challengedParticipants.length || '—'} aprobados</small></div></div>

                  {view.battle.status === 'pending' && <div className="squad-pending-battle-v11"><Clock3 size={18}/><div><strong>{isChallengedAdmin ? 'Tu Squad fue retado.' : 'Esperando respuesta del Squad rival.'}</strong><span>La invitación vence {formatDate(view.battle.response_expires_at)}.</span></div>{isChallengedAdmin && <div><button className="secondary" onClick={() => { void respondBattle(view.battle.id, false); }} disabled={actingId === view.battle.id}><X size={16}/> Rechazar</button><button className="primary" onClick={() => { void respondBattle(view.battle.id, true); }} disabled={actingId === view.battle.id}><Check size={16}/> Aceptar batalla</button></div>}</div>}

                  {view.battle.status === 'active' && challenge && <>
                    <div className="squad-battle-rules-v11"><div><Coins size={17}/><span>Por miembro aprobado</span><strong>Hasta +25 DC · +50 XP</strong></div><div><Trophy size={17}/><span>Para el Squad</span><strong>Hasta +{challenge.team_points} TP</strong></div><div><Clock3 size={17}/><span>Cierra</span><strong>{formatDate(view.battle.expires_at)}</strong></div></div>
                    {myParticipant && <MyBattleParticipation participant={myParticipant} challenge={challenge} onChanged={refreshAll}/>} 
                    {reviewQueue.length > 0 && <section className="squad-review-queue-v11"><div className="squad-section-head-v11"><div><span className="eyebrow">CAPITÁN RIVAL</span><h3>Evidencias por revisar</h3></div><span>{reviewQueue.length}</span></div>{reviewQueue.map((participant) => <ReviewSubmission key={participant.id} participant={participant} profile={view.profiles.get(participant.user_id) ?? null} challenge={challenge} onChanged={refreshAll}/>)}</section>}
                    {(isChallengerAdmin || isChallengedAdmin) && reviewQueue.length === 0 && <p className="squad-muted-v11 squad-captain-note-v11"><Crown size={15}/> Como capitán, revisarás únicamente las evidencias del Squad rival.</p>}
                    {canFinalize && <button className="squad-finalize-v11" type="button" onClick={() => { void finalizeBattle(view.battle.id); }} disabled={actingId === view.battle.id}><Trophy size={17}/> Finalizar batalla</button>}
                  </>}

                  {view.battle.status === 'completed' && <div className="squad-battle-result-v11"><Trophy size={24}/><div><span>RESULTADO FINAL</span><strong>{winnerName ? `${winnerName} gana la batalla` : 'Empate entre Squads'}</strong><small>{challengerPoints} TP · {challengedPoints} TP</small></div></div>}
                  {['declined', 'expired', 'cancelled'].includes(view.battle.status) && <p className="squad-muted-v11">Esta batalla ya no está activa.</p>}
                </article>
              );
            })}
          </section>
        )}
      </main>
    </div>
  );
}
