import { BellRing, Building2, Coins, Shield, Sparkles, Swords, Trophy, WalletCards } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useWorkspace } from '../context/WorkspaceContext';
import { supabase } from '../lib/supabase';
import { loadPartnerPointConfigs, resolvePartnerPointConfig, type PartnerPointConfig } from '../lib/partnerPoints';

interface SponsorPointBalance { sponsor_organization_id: string; sponsor_name: string; balance: number; }
interface GymPointBalance { gym_organization_id: string; gym_name: string; balance: number; }

interface DashboardSummary {
  xp: number; level: number; coins: number; challenges_completed: number;
  squad_contribution_points: number; organization_contribution_points: number;
  direct_pending: number; squad_pending: number; organization_pending: number; gym_battle_pending: number;
  unread_notifications: number; active_squads: number; active_organizations: number;
  sponsored_pending: number;
  sponsor_point_balances: SponsorPointBalance[]; sponsor_point_sponsor_count: number;
}
const EMPTY: DashboardSummary = { xp: 0, level: 1, coins: 0, challenges_completed: 0, squad_contribution_points: 0, organization_contribution_points: 0, direct_pending: 0, squad_pending: 0, organization_pending: 0, gym_battle_pending: 0, unread_notifications: 0, active_squads: 0, active_organizations: 0, sponsored_pending: 0, sponsor_point_balances: [], sponsor_point_sponsor_count: 0 };

export function SocialSummaryBar() {
  const { user } = useAuth();
  const { activeWorkspace } = useWorkspace();
  const [summary, setSummary] = useState<DashboardSummary>(EMPTY);
  const [gymBalances, setGymBalances] = useState<GymPointBalance[]>([]);
  const [ppConfigs, setPpConfigs] = useState<Map<string, PartnerPointConfig>>(new Map());
  const cloudReady = user?.provider === 'supabase' && Boolean(supabase) && activeWorkspace.kind === 'personal';

  const load = useCallback(async () => {
    if (!cloudReady || !supabase) return;
    const client = supabase;
    const [dashboard, sponsored, gymPoints] = await Promise.all([
      client.rpc('get_dadofit_dashboard_summary'),
      client.rpc('get_sponsored_pending_count'),
      client.rpc('get_my_gym_point_balances'),
    ]);
    if (!dashboard.error && dashboard.data) setSummary({ ...EMPTY, ...(dashboard.data as Partial<DashboardSummary>), sponsored_pending: sponsored.error ? 0 : Number(sponsored.data ?? 0) });
    const gymData = gymPoints.error ? [] : ((gymPoints.data ?? []) as GymPointBalance[]);
    setGymBalances(gymData);
    const sponsorData = Array.isArray((dashboard.data as Partial<DashboardSummary>)?.sponsor_point_balances) ? ((dashboard.data as Partial<DashboardSummary>).sponsor_point_balances as SponsorPointBalance[]) : [];
    const orgIds = [...gymData.map((b) => b.gym_organization_id), ...sponsorData.map((b) => b.sponsor_organization_id)];
    const configs = await loadPartnerPointConfigs(orgIds);
    setPpConfigs(configs);
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
  const pending = summary.direct_pending + summary.squad_pending + summary.organization_pending + summary.gym_battle_pending + summary.sponsored_pending;
  const pendingTarget = summary.direct_pending > 0 ? '/challenges' : summary.squad_pending > 0 ? '/squads' : summary.sponsored_pending > 0 ? '/sponsored-challenges' : '/organization-challenges';
  const sponsorBalances = Array.isArray(summary.sponsor_point_balances) ? summary.sponsor_point_balances : [];
  const firstGymCfg = gymBalances.length > 0 ? resolvePartnerPointConfig(ppConfigs, gymBalances[0].gym_organization_id, 'gym') : null;
  const firstSponsorCfg = sponsorBalances.length > 0 ? resolvePartnerPointConfig(ppConfigs, sponsorBalances[0].sponsor_organization_id, 'brand') : null;
  const sponsorPointDisplay = sponsorBalances.length === 0 ? '0 puntos' : sponsorBalances.length === 1 ? `${Number(sponsorBalances[0].balance ?? 0).toLocaleString()} ${firstSponsorCfg?.points_short_name ?? 'PP'}` : `${sponsorBalances.length} saldos`;
  const gymPointDisplay = gymBalances.length === 0 ? '0 puntos' : gymBalances.length === 1 ? `${Number(gymBalances[0].balance ?? 0).toLocaleString()} ${firstGymCfg?.points_short_name ?? 'PP'}` : `${gymBalances.length} saldos`;
  const sponsorPointName = sponsorBalances.length === 1 ? firstSponsorCfg?.points_name ?? 'Partner Points' : 'Partner Points';
  const gymPointName = gymBalances.length === 1 ? firstGymCfg?.points_name ?? 'Partner Points' : 'Partner Points';

  return <section className="social-summary-v112 social-summary-v12" aria-label="Resumen social DadoFit"><div className="social-summary-stats-v112"><Link to="/profile"><Trophy size={16}/><span>XP</span><strong>{summary.xp.toLocaleString()}</strong></Link><Link to="/profile"><Coins size={16}/><span>DadoCoins</span><strong>{summary.coins.toLocaleString()}</strong></Link><Link to="/squads"><Shield size={16}/><span>Score de Squad</span><strong>{summary.squad_contribution_points.toLocaleString()} pts</strong></Link><Link to="/profile"><Building2 size={16}/><span>Score de Gym</span><strong>{summary.organization_contribution_points.toLocaleString()} pts</strong></Link><Link to="/profile#gym-points" title="Los puntos disponibles pertenecen a un Gym específico"><WalletCards size={16}/><span>{gymPointName}</span><strong>{gymPointDisplay}</strong></Link><Link to="/profile#sponsor-points" title="Los puntos de Marca no se combinan entre marcas"><Sparkles size={16}/><span>{sponsorPointName}</span><strong>{sponsorPointDisplay}</strong></Link><Link to={pendingTarget} className={pending > 0 ? 'has-pending' : ''}><BellRing size={16}/><span>Pendientes</span><strong>{pending}</strong></Link></div>{pending > 0 && <div className="social-pending-v112"><div><BellRing size={16}/><span>Tienes actividad pendiente</span></div><div>{summary.direct_pending > 0 && <Link to="/challenges"><Swords size={14}/> {summary.direct_pending} reto(s) 1v1</Link>}{summary.squad_pending > 0 && <Link to="/squads"><Shield size={14}/> {summary.squad_pending} batalla(s) Squad</Link>}{summary.organization_pending > 0 && <Link to="/organization-challenges"><Building2 size={14}/> {summary.organization_pending} reto(s) de Gym</Link>}{summary.sponsored_pending > 0 && <Link to="/sponsored-challenges"><Sparkles size={14}/> {summary.sponsored_pending} Branded Challenge(s)</Link>}</div></div>}</section>;
}
