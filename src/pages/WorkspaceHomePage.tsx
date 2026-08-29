import { Activity, Building2, CheckCircle2, CircleDollarSign, ClipboardCheck, Dice5, History, Megaphone, ShieldCheck, Swords, Tag, Trophy, UserCheck, UsersRound, XCircle } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { AppHeader } from '../components/AppHeader';
import { useWorkspace } from '../context/WorkspaceContext';
import { canManageBrandRole } from '../lib/sponsoredRules';
import { supabase } from '../lib/supabase';

interface WorkspaceStats {
  members: number;
  sponsorPoints: number;
  activeChallenges: number;
  activeBattles: number;
  campaigns: number;
  activeCampaigns: number;
  sponsoredChallenges: number;
  activeSponsoredChallenges: number;
  participants: number;
  pendingReview: number;
  pendingAudit: number;
  approved: number;
  rejected: number;
  coinsGranted: number;
  xpGranted: number;
}

interface RecentReview {
  id: string;
  review_stage: 'primary' | 'audit';
  decision: 'approved' | 'rejected';
  participant_name: string;
  campaign_name: string;
  reviewer_name: string;
  created_at: string;
}

const EMPTY: WorkspaceStats = { members: 0, sponsorPoints: 0, activeChallenges: 0, activeBattles: 0, campaigns: 0, activeCampaigns: 0, sponsoredChallenges: 0, activeSponsoredChallenges: 0, participants: 0, pendingReview: 0, pendingAudit: 0, approved: 0, rejected: 0, coinsGranted: 0, xpGranted: 0 };

function roleLabel(role: string | null) {
  const labels: Record<string, string> = { owner: 'Owner', admin: 'Admin', coach: 'Coach', member: 'Member' };
  return role ? labels[role] ?? role : 'Member';
}

function verificationLabel(status: string) {
  const labels: Record<string, string> = { verified: 'Verificada', pending_verification: 'Pendiente de verificación', draft: 'Borrador', rejected: 'Rechazada', suspended: 'Suspendida' };
  return labels[status] ?? status;
}

function formatDate(value: string) {
  try { return new Intl.DateTimeFormat('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(value)); } catch { return value; }
}

export function WorkspaceHomePage() {
  const { activeWorkspace } = useWorkspace();
  const [stats, setStats] = useState<WorkspaceStats>(EMPTY);
  const [recent, setRecent] = useState<RecentReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!supabase || !activeWorkspace.organizationId) { setLoading(false); return; }
    const client = supabase;
    const orgId = activeWorkspace.organizationId;
    setLoading(true);
    setError('');

    if (activeWorkspace.kind === 'brand') {
      const manager = canManageBrandRole(activeWorkspace.role);
      const { data, error: summaryError } = manager
        ? await client.rpc('get_brand_governance_dashboard', { p_organization_id: orgId })
        : await client.rpc('get_brand_dashboard_summary', { p_organization_id: orgId });
      if (summaryError) setError(summaryError.message);
      else {
        const row = (data ?? {}) as Record<string, unknown>;
        setStats({
          ...EMPTY,
          members: Number(row.members ?? 0),
          campaigns: Number(row.campaigns ?? 0),
          activeCampaigns: Number(row.active_campaigns ?? 0),
          sponsoredChallenges: Number(row.sponsored_challenges ?? 0),
          activeSponsoredChallenges: Number(row.active_challenges ?? 0),
          participants: Number(row.participants ?? 0),
          pendingReview: Number(row.pending_review ?? 0),
          pendingAudit: manager ? Number(row.pending_audit ?? 0) : 0,
          approved: Number(row.approved ?? 0),
          rejected: manager ? Number(row.rejected ?? 0) : 0,
          coinsGranted: Number(row.coins_granted ?? 0),
          xpGranted: Number(row.xp_granted ?? 0),
        });
        setRecent(manager ? ((row.history ?? []) as RecentReview[]).slice(0, 6) : []);
      }
      setLoading(false);
      return;
    }

    const [members, scores, challenges, battlesA, battlesB] = await Promise.all([
      client.from('organization_members').select('user_id', { count: 'exact', head: true }).eq('organization_id', orgId).eq('status', 'active'),
      client.from('score_events').select('sponsor_points').eq('organization_id', orgId),
      client.from('challenges').select('id', { count: 'exact', head: true }).eq('creator_organization_id', orgId).eq('status', 'active'),
      client.from('organization_battles').select('id', { count: 'exact', head: true }).eq('challenger_organization_id', orgId).in('status', ['pending', 'active']),
      client.from('organization_battles').select('id', { count: 'exact', head: true }).eq('challenged_organization_id', orgId).in('status', ['pending', 'active']),
    ]);
    const queryError = members.error ?? scores.error ?? challenges.error ?? battlesA.error ?? battlesB.error;
    if (queryError) setError(queryError.message);
    const sponsorPoints = (scores.data ?? []).reduce((sum, item) => sum + Number(item.sponsor_points ?? 0), 0);
    setStats({ ...EMPTY, members: Number(members.count ?? 0), sponsorPoints, activeChallenges: Number(challenges.count ?? 0), activeBattles: Number(battlesA.count ?? 0) + Number(battlesB.count ?? 0) });
    setLoading(false);
  }, [activeWorkspace.kind, activeWorkspace.organizationId, activeWorkspace.role]);

  useEffect(() => { void load(); }, [load]);
  if (activeWorkspace.kind === 'personal') return <Navigate to="/app" replace/>;

  const gym = activeWorkspace.kind === 'gym';
  const gymManager = ['owner', 'admin', 'coach'].includes(activeWorkspace.role ?? '');
  const brandManager = canManageBrandRole(activeWorkspace.role);
  const verification = activeWorkspace.verificationStatus ?? 'pending_verification';
  const reviewed = stats.approved + stats.rejected;
  const approvalRate = useMemo(() => reviewed > 0 ? Math.round((stats.approved / reviewed) * 100) : 0, [reviewed, stats.approved]);

  return <div className="profile-shell-v9 workspace-shell-v122 workspace-shell-v133"><AppHeader/><main className="profile-page-v9 workspace-home-v122 workspace-home-v133">
    <section className="workspace-hero-v122 workspace-hero-v133">
      <div className="workspace-hero-icon-v122">{gym ? <Building2 size={32}/> : <Tag size={32}/>}</div>
      <div className="workspace-hero-copy-v133"><span className="eyebrow">{gym ? 'WORKSPACE GYM' : 'WORKSPACE MARCA'}</span><h1>{activeWorkspace.label}</h1><p>{roleLabel(activeWorkspace.role)} · {verificationLabel(verification)}</p></div>
      <span className={`workspace-verification-pill-v133 ${verification}`}><ShieldCheck size={16}/>{verificationLabel(verification)}</span>
    </section>
    {error && <div className="auth-error">{error}</div>}

    {gym ? <>
      <section className="workspace-stats-v122 workspace-stats-v133"><article><UsersRound size={20}/><span>Miembros</span><strong>{loading ? '…' : stats.members}</strong></article><article><Trophy size={20}/><span>Sponsor Points</span><strong>{loading ? '…' : `${stats.sponsorPoints.toLocaleString()} SP`}</strong></article><article><Swords size={20}/><span>Retos activos</span><strong>{loading ? '…' : stats.activeChallenges}</strong></article><article><Building2 size={20}/><span>Batallas activas</span><strong>{loading ? '…' : stats.activeBattles}</strong></article></section>
      <section className="workspace-section-v133"><div className="workspace-section-title-v133"><div><span className="eyebrow">OPERACIÓN</span><h2>Gestiona tu Gym</h2></div></div><div className="workspace-action-grid-v122 workspace-action-grid-v133">
        {gymManager && <Link to="/app"><Dice5 size={24}/><span><strong>Generar reto</strong><small>Usa los dados como creador institucional.</small></span></Link>}
        <Link to="/organization-challenges"><Swords size={24}/><span><strong>Retos del Gym</strong><small>{gymManager ? 'Publica, revisa y controla evidencias.' : 'Participa en los retos de tu Gym.'}</small></span></Link>
        <Link to="/gym-battles"><Trophy size={24}/><span><strong>Gym vs Gym</strong><small>Competencias entre organizaciones verificadas.</small></span></Link>
        <Link to="/organizations"><UsersRound size={24}/><span><strong>Miembros y roles</strong><small>Owner, Admin, Coach y Member.</small></span></Link>
      </div></section>
    </> : <>
      {verification !== 'verified' && <section className="brand-verification-v13"><ShieldCheck size={20}/><div><strong>Marca pendiente de verificación</strong><p>Puedes preparar campañas en borrador. La publicación se habilita cuando la Marca esté verificada.</p></div></section>}

      <section className="workspace-stats-v122 workspace-stats-v133 brand-ops-stats-v133">
        <article><Megaphone size={20}/><span>Campañas activas</span><strong>{loading ? '…' : stats.activeCampaigns}</strong><small>{stats.campaigns} totales</small></article>
        <article><Swords size={20}/><span>Retos activos</span><strong>{loading ? '…' : stats.activeSponsoredChallenges}</strong><small>{stats.sponsoredChallenges} históricos</small></article>
        <article className={stats.pendingReview > 0 ? 'attention' : ''}><ClipboardCheck size={20}/><span>Por revisar</span><strong>{loading ? '…' : stats.pendingReview}</strong><small>Revisión operativa</small></article>
        <article className={stats.pendingAudit > 0 ? 'attention' : ''}><ShieldCheck size={20}/><span>Por auditar</span><strong>{loading ? '…' : stats.pendingAudit}</strong><small>Segunda validación</small></article>
        <article><CheckCircle2 size={20}/><span>Aprobados</span><strong>{loading ? '…' : stats.approved}</strong><small>{approvalRate}% aprobación</small></article>
        <article><CircleDollarSign size={20}/><span>DC entregados</span><strong>{loading ? '…' : stats.coinsGranted.toLocaleString()}</strong><small>{stats.xpGranted.toLocaleString()} XP</small></article>
      </section>

      <section className="workspace-section-v133"><div className="workspace-section-title-v133"><div><span className="eyebrow">OPERACIÓN</span><h2>Centro de Marca</h2><p>Campañas, control de calidad, equipo y trazabilidad.</p></div></div><div className="workspace-action-grid-v122 workspace-action-grid-v133 brand-actions-v133">
        <Link to="/brand-campaigns"><Megaphone size={24}/><span><strong>Campañas & Branded Challenges</strong><small>{brandManager ? 'Crea campañas, publica retos y realiza la revisión inicial.' : 'Consulta campañas y resultados de la Marca.'}</small></span></Link>
        {brandManager && <Link to="/brand-audit" className="governance-action-v133"><ShieldCheck size={24}/><span><strong>Control & Auditoría</strong><small>Histórico, doble validación y segunda revisión independiente.</small></span>{stats.pendingAudit > 0 && <b>{stats.pendingAudit}</b>}</Link>}
        <Link to="/organizations"><UsersRound size={24}/><span><strong>Equipo de Marca</strong><small>Administra miembros y permisos del workspace.</small></span></Link>
      </div></section>

      <section className="brand-dashboard-grid-v133">
        <article className="profile-card-v9 brand-health-card-v133"><div className="workspace-section-title-v133"><div><span className="eyebrow">SALUD OPERATIVA</span><h2>Estado de la operación</h2></div><Activity size={22}/></div><div className="brand-health-grid-v133"><div><UserCheck size={18}/><span>Participantes</span><strong>{stats.participants}</strong></div><div><CheckCircle2 size={18}/><span>Aprobados</span><strong>{stats.approved}</strong></div><div><XCircle size={18}/><span>Rechazados</span><strong>{stats.rejected}</strong></div><div><ShieldCheck size={18}/><span>Auditorías pendientes</span><strong>{stats.pendingAudit}</strong></div></div></article>

        {brandManager && <article className="profile-card-v9 brand-recent-v133"><div className="workspace-section-title-v133"><div><span className="eyebrow">TRAZABILIDAD</span><h2>Actividad reciente</h2></div><History size={22}/></div>{recent.length === 0 ? <p className="workspace-empty-v133">Todavía no hay revisiones registradas.</p> : <div className="brand-recent-list-v133">{recent.map((item) => <div key={item.id}><span className={`review-dot-v133 ${item.decision}`}/><div><strong>{item.participant_name}</strong><p>{item.campaign_name} · {item.review_stage === 'audit' ? 'Auditoría' : 'Revisión'} · {item.decision === 'approved' ? 'Aprobada' : 'Rechazada'}</p><small>{item.reviewer_name} · {formatDate(item.created_at)}</small></div></div>)}</div>}<Link className="text-link-v133" to="/brand-audit">Ver histórico completo →</Link></article>}
      </section>
    </>}
  </main></div>;
}
