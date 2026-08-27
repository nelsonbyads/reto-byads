import { Building2, Dice5, ShieldCheck, Swords, Tag, Trophy, UsersRound } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { AppHeader } from '../components/AppHeader';
import { useWorkspace } from '../context/WorkspaceContext';
import { supabase } from '../lib/supabase';

interface WorkspaceStats {
  members: number;
  sponsorPoints: number;
  activeChallenges: number;
  activeBattles: number;
}

const EMPTY: WorkspaceStats = { members: 0, sponsorPoints: 0, activeChallenges: 0, activeBattles: 0 };

function roleLabel(role: string | null) {
  const labels: Record<string, string> = { owner: 'Owner', admin: 'Admin', coach: 'Coach', member: 'Member' };
  return role ? labels[role] ?? role : 'Member';
}

export function WorkspaceHomePage() {
  const { activeWorkspace } = useWorkspace();
  const [stats, setStats] = useState<WorkspaceStats>(EMPTY);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!supabase || !activeWorkspace.organizationId) { setLoading(false); return; }
    const orgId = activeWorkspace.organizationId;
    setLoading(true);
    const [members, scores, challenges, battlesA, battlesB] = await Promise.all([
      supabase.from('organization_members').select('user_id', { count: 'exact', head: true }).eq('organization_id', orgId).eq('status', 'active'),
      supabase.from('score_events').select('sponsor_points').eq('organization_id', orgId),
      supabase.from('challenges').select('id', { count: 'exact', head: true }).eq('creator_organization_id', orgId).eq('status', 'active'),
      supabase.from('organization_battles').select('id', { count: 'exact', head: true }).eq('challenger_organization_id', orgId).in('status', ['pending', 'active']),
      supabase.from('organization_battles').select('id', { count: 'exact', head: true }).eq('challenged_organization_id', orgId).in('status', ['pending', 'active']),
    ]);
    const sponsorPoints = (scores.data ?? []).reduce((sum, item) => sum + Number(item.sponsor_points ?? 0), 0);
    setStats({ members: Number(members.count ?? 0), sponsorPoints, activeChallenges: Number(challenges.count ?? 0), activeBattles: Number(battlesA.count ?? 0) + Number(battlesB.count ?? 0) });
    setLoading(false);
  }, [activeWorkspace.organizationId]);

  useEffect(() => { void load(); }, [load]);
  if (activeWorkspace.kind === 'personal') return <Navigate to="/app" replace/>;

  const gym = activeWorkspace.kind === 'gym';
  const manager = ['owner', 'admin', 'coach'].includes(activeWorkspace.role ?? '');

  return <div className="profile-shell-v9 workspace-shell-v122"><AppHeader/><main className="profile-page-v9 workspace-home-v122">
    <section className="workspace-hero-v122"><div className="workspace-hero-icon-v122">{gym ? <Building2 size={34}/> : <Tag size={34}/>}</div><div><span className="eyebrow">{gym ? 'WORKSPACE GYM' : 'WORKSPACE MARCA'}</span><h1>{activeWorkspace.label}</h1><p>{roleLabel(activeWorkspace.role)} · {activeWorkspace.verificationStatus ?? 'active'}</p></div><ShieldCheck size={24}/></section>

    <section className="workspace-stats-v122"><article><UsersRound size={20}/><span>Miembros</span><strong>{loading ? '…' : stats.members}</strong></article><article><Trophy size={20}/><span>Sponsor Points</span><strong>{loading ? '…' : `${stats.sponsorPoints.toLocaleString()} SP`}</strong></article>{gym && <article><Swords size={20}/><span>Retos activos</span><strong>{loading ? '…' : stats.activeChallenges}</strong></article>}{gym && <article><Building2 size={20}/><span>Batallas activas</span><strong>{loading ? '…' : stats.activeBattles}</strong></article>}</section>

    {gym ? <section className="workspace-action-grid-v122">
      {manager && <Link to="/app"><Dice5 size={24}/><span><strong>Generar reto</strong><small>Usa los dados como creador institucional.</small></span></Link>}
      <Link to="/organization-challenges"><Swords size={24}/><span><strong>Retos del Gym</strong><small>{manager ? 'Publica, revisa y controla evidencias.' : 'Participa en los retos de tu Gym.'}</small></span></Link>
      <Link to="/gym-battles"><Trophy size={24}/><span><strong>Gym vs Gym</strong><small>Competencias entre organizaciones verificables.</small></span></Link>
      <Link to="/organizations"><UsersRound size={24}/><span><strong>Miembros y roles</strong><small>Owner, Admin, Coach y Member.</small></span></Link>
    </section> : <section className="workspace-action-grid-v122">
      <Link to="/organizations"><UsersRound size={24}/><span><strong>Equipo de Marca</strong><small>Administra miembros y permisos del workspace.</small></span></Link>
      <article className="workspace-coming-v122"><Tag size={24}/><span><strong>Brands & Sponsors</strong><small>Campañas, branded challenges, rewards y analytics llegan en V13.</small></span></article>
    </section>}
  </main></div>;
}
