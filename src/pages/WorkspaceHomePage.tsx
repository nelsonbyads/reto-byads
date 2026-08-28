import { Building2, CheckCircle2, Dice5, Megaphone, ShieldCheck, Swords, Tag, Trophy, UsersRound } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
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
  participants: number;
  approved: number;
}

const EMPTY: WorkspaceStats = { members: 0, sponsorPoints: 0, activeChallenges: 0, activeBattles: 0, campaigns: 0, activeCampaigns: 0, sponsoredChallenges: 0, participants: 0, approved: 0 };

function roleLabel(role: string | null) {
  const labels: Record<string, string> = { owner: 'Owner', admin: 'Admin', coach: 'Coach', member: 'Member' };
  return role ? labels[role] ?? role : 'Member';
}

export function WorkspaceHomePage() {
  const { activeWorkspace } = useWorkspace();
  const [stats, setStats] = useState<WorkspaceStats>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!supabase || !activeWorkspace.organizationId) { setLoading(false); return; }
    const client = supabase;
    const orgId = activeWorkspace.organizationId;
    setLoading(true);
    setError('');

    if (activeWorkspace.kind === 'brand') {
      const { data, error: summaryError } = await client.rpc('get_brand_dashboard_summary', { p_organization_id: orgId });
      if (summaryError) setError(summaryError.message);
      else {
        const row = (data ?? {}) as Record<string, unknown>;
        setStats({
          ...EMPTY,
          members: Number(row.members ?? 0),
          campaigns: Number(row.campaigns ?? 0),
          activeCampaigns: Number(row.active_campaigns ?? 0),
          sponsoredChallenges: Number(row.sponsored_challenges ?? 0),
          participants: Number(row.participants ?? 0),
          approved: Number(row.approved ?? 0),
        });
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
  }, [activeWorkspace.kind, activeWorkspace.organizationId]);

  useEffect(() => { void load(); }, [load]);
  if (activeWorkspace.kind === 'personal') return <Navigate to="/app" replace/>;

  const gym = activeWorkspace.kind === 'gym';
  const gymManager = ['owner', 'admin', 'coach'].includes(activeWorkspace.role ?? '');
  const brandManager = canManageBrandRole(activeWorkspace.role);
  const verification = activeWorkspace.verificationStatus ?? 'pending_verification';

  return <div className="profile-shell-v9 workspace-shell-v122"><AppHeader/><main className="profile-page-v9 workspace-home-v122">
    <section className="workspace-hero-v122"><div className="workspace-hero-icon-v122">{gym ? <Building2 size={34}/> : <Tag size={34}/>}</div><div><span className="eyebrow">{gym ? 'WORKSPACE GYM' : 'WORKSPACE MARCA'}</span><h1>{activeWorkspace.label}</h1><p>{roleLabel(activeWorkspace.role)} · {verification}</p></div><ShieldCheck size={24}/></section>
    {error && <div className="auth-error">{error}</div>}

    {gym ? <>
      <section className="workspace-stats-v122"><article><UsersRound size={20}/><span>Miembros</span><strong>{loading ? '…' : stats.members}</strong></article><article><Trophy size={20}/><span>Sponsor Points</span><strong>{loading ? '…' : `${stats.sponsorPoints.toLocaleString()} SP`}</strong></article><article><Swords size={20}/><span>Retos activos</span><strong>{loading ? '…' : stats.activeChallenges}</strong></article><article><Building2 size={20}/><span>Batallas activas</span><strong>{loading ? '…' : stats.activeBattles}</strong></article></section>
      <section className="workspace-action-grid-v122">
        {gymManager && <Link to="/app"><Dice5 size={24}/><span><strong>Generar reto</strong><small>Usa los dados como creador institucional.</small></span></Link>}
        <Link to="/organization-challenges"><Swords size={24}/><span><strong>Retos del Gym</strong><small>{gymManager ? 'Publica, revisa y controla evidencias.' : 'Participa en los retos de tu Gym.'}</small></span></Link>
        <Link to="/gym-battles"><Trophy size={24}/><span><strong>Gym vs Gym</strong><small>Competencias entre organizaciones verificables.</small></span></Link>
        <Link to="/organizations"><UsersRound size={24}/><span><strong>Miembros y roles</strong><small>Owner, Admin, Coach y Member.</small></span></Link>
      </section>
    </> : <>
      {verification !== 'verified' && <section className="brand-verification-v13"><ShieldCheck size={20}/><div><strong>Marca pendiente de verificación</strong><p>Puedes preparar campañas en borrador. La publicación de Branded Challenges se habilita cuando la Marca esté verificada.</p></div></section>}
      <section className="workspace-stats-v122 brand-stats-v13"><article><UsersRound size={20}/><span>Equipo</span><strong>{loading ? '…' : stats.members}</strong></article><article><Megaphone size={20}/><span>Campañas</span><strong>{loading ? '…' : stats.campaigns}</strong></article><article><Swords size={20}/><span>Retos patrocinados</span><strong>{loading ? '…' : stats.sponsoredChallenges}</strong></article><article><UsersRound size={20}/><span>Participantes</span><strong>{loading ? '…' : stats.participants}</strong></article><article><CheckCircle2 size={20}/><span>Aprobados</span><strong>{loading ? '…' : stats.approved}</strong></article></section>
      <section className="workspace-action-grid-v122">
        <Link to="/brand-campaigns"><Megaphone size={24}/><span><strong>Campañas & Branded Challenges</strong><small>{brandManager ? 'Crea campañas, publica retos y revisa evidencias.' : 'Consulta campañas y resultados de la Marca.'}</small></span></Link>
        <Link to="/organizations"><UsersRound size={24}/><span><strong>Equipo de Marca</strong><small>Administra miembros y permisos del workspace.</small></span></Link>
        <article className="workspace-coming-v122"><Tag size={24}/><span><strong>Rewards Marketplace</strong><small>Canjes, productos y beneficios llegan en el siguiente milestone.</small></span></article>
      </section>
    </>}
  </main></div>;
}
