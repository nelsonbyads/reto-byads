import { BellRing, Building2, Coins, Shield, Swords, Trophy } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { supabase } from '../lib/supabase';

interface DashboardSummary {
  xp: number;
  level: number;
  coins: number;
  challenges_completed: number;
  squad_contribution_points: number;
  organization_contribution_points: number;
  direct_pending: number;
  squad_pending: number;
  organization_pending: number;
  gym_battle_pending: number;
  unread_notifications: number;
  active_squads: number;
  active_organizations: number;
}

const EMPTY: DashboardSummary = {
  xp: 0, level: 1, coins: 0, challenges_completed: 0,
  squad_contribution_points: 0, organization_contribution_points: 0,
  direct_pending: 0, squad_pending: 0, organization_pending: 0, gym_battle_pending: 0,
  unread_notifications: 0, active_squads: 0, active_organizations: 0,
};

export function SocialSummaryBar() {
  const { user } = useAuth();
  const [summary, setSummary] = useState<DashboardSummary>(EMPTY);
  const cloudReady = user?.provider === 'supabase' && Boolean(supabase);

  const load = useCallback(async () => {
    if (!cloudReady || !supabase) return;
    const { data, error } = await supabase.rpc('get_dadofit_dashboard_summary');
    if (!error && data) setSummary({ ...EMPTY, ...(data as Partial<DashboardSummary>) });
  }, [cloudReady]);

  useEffect(() => {
    if (!cloudReady) return;
    void load();
    const interval = window.setInterval(() => { void load(); }, 30000);
    const handleFocus = () => { void load(); };
    window.addEventListener('focus', handleFocus);
    return () => { window.clearInterval(interval); window.removeEventListener('focus', handleFocus); };
  }, [cloudReady, load]);

  if (!cloudReady) return null;

  const pending = summary.direct_pending + summary.squad_pending + summary.organization_pending + summary.gym_battle_pending;
  const pendingTarget = summary.direct_pending > 0 ? '/challenges' : summary.squad_pending > 0 ? '/squads' : summary.organization_pending > 0 ? '/organization-challenges' : '/gym-battles';

  return (
    <section className="social-summary-v112 social-summary-v12" aria-label="Resumen social DadoFit">
      <div className="social-summary-stats-v112">
        <Link to="/profile"><Trophy size={16}/><span>XP</span><strong>{summary.xp.toLocaleString()}</strong></Link>
        <Link to="/profile"><Coins size={16}/><span>DadoCoins</span><strong>{summary.coins.toLocaleString()}</strong></Link>
        <Link to="/squads"><Shield size={16}/><span>Mi aporte Squad</span><strong>{summary.squad_contribution_points.toLocaleString()} TP</strong></Link>
        <Link to="/organizations"><Building2 size={16}/><span>Mi aporte Gym</span><strong>{summary.organization_contribution_points.toLocaleString()} SP</strong></Link>
        <Link to={pendingTarget} className={pending > 0 ? 'has-pending' : ''}><BellRing size={16}/><span>Pendientes</span><strong>{pending}</strong></Link>
      </div>

      {pending > 0 && <div className="social-pending-v112"><div><BellRing size={16}/><span>Tienes actividad pendiente</span></div><div>{summary.direct_pending > 0 && <Link to="/challenges"><Swords size={14}/> {summary.direct_pending} {summary.direct_pending === 1 ? 'reto 1v1' : 'retos 1v1'}</Link>}{summary.squad_pending > 0 && <Link to="/squads"><Shield size={14}/> {summary.squad_pending} {summary.squad_pending === 1 ? 'batalla Squad' : 'batallas Squad'}</Link>}{summary.organization_pending > 0 && <Link to="/organization-challenges"><Building2 size={14}/> {summary.organization_pending} {summary.organization_pending === 1 ? 'reto de Gym' : 'retos de Gym'}</Link>}{summary.gym_battle_pending > 0 && <Link to="/gym-battles"><Swords size={14}/> {summary.gym_battle_pending} {summary.gym_battle_pending === 1 ? 'batalla Gym' : 'batallas Gym'}</Link>}</div></div>}
    </section>
  );
}
