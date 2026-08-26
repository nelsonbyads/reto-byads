import { ArrowLeft, Building2, Coins, Save, Trophy, UserRound, UsersRound } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { AppHeader } from '../components/AppHeader';
import { useAuth } from '../auth/AuthContext';
import { supabase } from '../lib/supabase';

interface ProfileStats {
  xp: number;
  level: number;
  currentStreak: number;
  challengesCompleted: number;
  coins: number;
  gymbros: number;
  squads: number;
  squadPoints: number;
  organizations: number;
  organizationPoints: number;
  pendingChallenges: number;
}

const EMPTY_STATS: ProfileStats = { xp: 0, level: 1, currentStreak: 0, challengesCompleted: 0, coins: 0, gymbros: 0, squads: 0, squadPoints: 0, organizations: 0, organizationPoints: 0, pendingChallenges: 0 };

export function ProfilePage() {
  const { user } = useAuth();
  const [displayName, setDisplayName] = useState(user?.name ?? '');
  const [username, setUsername] = useState(user?.username ?? '');
  const [stats, setStats] = useState<ProfileStats>(EMPTY_STATS);
  const [loading, setLoading] = useState(user?.provider === 'supabase');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!user || user.provider !== 'supabase' || !supabase) { setLoading(false); return; }
    const client = supabase;
    let active = true;
    const load = async () => {
      const [profileResult, progressResult, walletResult, sentGymbros, receivedGymbros, squadsResult, organizationsResult, dashboardResult] = await Promise.all([
        client.from('profiles').select('display_name, username').eq('id', user.id).single(),
        client.from('user_progress').select('xp, level, current_streak, challenges_completed').eq('user_id', user.id).single(),
        client.from('wallets').select('balance').eq('user_id', user.id).single(),
        client.from('friendships').select('id', { count: 'exact', head: true }).eq('requester_id', user.id).eq('status', 'accepted'),
        client.from('friendships').select('id', { count: 'exact', head: true }).eq('addressee_id', user.id).eq('status', 'accepted'),
        client.from('group_members').select('group_id', { count: 'exact', head: true }).eq('user_id', user.id).eq('status', 'active'),
        client.from('organization_members').select('organization_id', { count: 'exact', head: true }).eq('user_id', user.id).eq('status', 'active'),
        client.rpc('get_dadofit_dashboard_summary'),
      ]);

      if (!active) return;
      if (profileResult.data) { setDisplayName(profileResult.data.display_name ?? ''); setUsername(profileResult.data.username ?? ''); }
      const dashboard = (dashboardResult.data ?? {}) as { squad_contribution_points?: number; organization_contribution_points?: number; direct_pending?: number; squad_pending?: number; organization_pending?: number; gym_battle_pending?: number };
      setStats({
        xp: Number(progressResult.data?.xp ?? 0), level: Number(progressResult.data?.level ?? 1), currentStreak: Number(progressResult.data?.current_streak ?? 0), challengesCompleted: Number(progressResult.data?.challenges_completed ?? 0), coins: Number(walletResult.data?.balance ?? 0),
        gymbros: Number(sentGymbros.count ?? 0) + Number(receivedGymbros.count ?? 0), squads: Number(squadsResult.count ?? 0), squadPoints: Number(dashboard.squad_contribution_points ?? 0), organizations: Number(organizationsResult.count ?? 0), organizationPoints: Number(dashboard.organization_contribution_points ?? 0), pendingChallenges: Number(dashboard.direct_pending ?? 0) + Number(dashboard.squad_pending ?? 0) + Number(dashboard.organization_pending ?? 0) + Number(dashboard.gym_battle_pending ?? 0),
      });
      setLoading(false);
    };
    void load();
    return () => { active = false; };
  }, [user]);

  const save = async (event: FormEvent) => {
    event.preventDefault(); setMessage(''); setError('');
    if (!user || user.provider !== 'supabase' || !supabase) return;
    const normalizedUsername = username.trim().toLowerCase();
    if (!/^[a-z0-9_.]{3,30}$/.test(normalizedUsername)) { setError('El username debe tener 3–30 caracteres: letras minúsculas, números, punto o guion bajo.'); return; }
    setSaving(true);
    const { error: updateError } = await supabase.from('profiles').update({ display_name: displayName.trim(), username: normalizedUsername }).eq('id', user.id);
    setSaving(false);
    if (updateError) { setError(updateError.code === '23505' ? 'Ese username ya está siendo usado.' : updateError.message); return; }
    setUsername(normalizedUsername); setMessage('Perfil actualizado.');
  };

  return (
    <div className="profile-shell-v9"><AppHeader/><main className="profile-page-v9">
      <Link className="profile-back-v9" to="/app"><ArrowLeft size={16}/> Volver a entrenar</Link>
      <section className="profile-hero-v9"><div className="profile-avatar-v9"><UserRound size={34}/></div><div><span className="eyebrow">PERFIL DADOFIT</span><h1>{user?.name ?? 'Gymbro'}</h1><p>{user?.provider === 'supabase' ? 'Cuenta cloud conectada' : user?.provider === 'guest' ? 'Sesión de invitado' : 'Cuenta local de recuperación'}</p></div></section>
      {user?.provider !== 'supabase' ? <section className="profile-card-v9 profile-cloud-callout-v9"><h2>Activa tu perfil social</h2><p>Los Gymbros, retos, DadoCoins, Squads y Organizations requieren una cuenta cloud.</p><Link className="profile-primary-v9" to="/register">Crear cuenta DadoFit</Link></section> : loading ? <section className="profile-card-v9">Cargando perfil…</section> : <>
        <section className="profile-stats-v9"><article><Trophy size={20}/><span>Nivel</span><strong>{stats.level}</strong></article><article><span className="profile-xp-icon-v9">XP</span><span>Experiencia</span><strong>{stats.xp.toLocaleString()}</strong></article><article><Coins size={20}/><span>DadoCoins</span><strong>{stats.coins.toLocaleString()} DC</strong></article><article><span className="profile-fire-v9">🔥</span><span>Racha</span><strong>{stats.currentStreak} días</strong></article></section>
        <section className="profile-grid-v9">
          <form className="profile-card-v9 profile-form-v9" onSubmit={save}><div><span className="eyebrow">IDENTIDAD</span><h2>Tu perfil</h2></div><label>Nombre visible<input value={displayName} onChange={(e) => setDisplayName(e.target.value)} minLength={2} maxLength={60} required/></label><label>Username<div className="profile-username-field-v9"><span>@</span><input value={username} onChange={(e) => setUsername(e.target.value)} minLength={3} maxLength={30} required/></div></label>{error && <div className="auth-error">{error}</div>}{message && <div className="auth-success">{message}</div>}<button className="profile-primary-v9" type="submit" disabled={saving}><Save size={16}/>{saving ? 'Guardando…' : 'Guardar perfil'}</button></form>
          <section className="profile-card-v9"><span className="eyebrow">ACTIVIDAD SOCIAL</span><h2>Tu ecosistema DadoFit</h2><div className="profile-social-stat-v9"><span>Retos completados</span><strong>{stats.challengesCompleted}</strong></div><div className="profile-social-stat-v9"><span>Gymbros</span><strong>{stats.gymbros}</strong></div><div className="profile-social-stat-v9"><span>Squads</span><strong>{stats.squads}</strong></div><div className="profile-social-stat-v9"><span>Aporte a Squads</span><strong>{stats.squadPoints.toLocaleString()} TP</strong></div><div className="profile-social-stat-v9"><span>Organizations</span><strong>{stats.organizations}</strong></div><div className="profile-social-stat-v9"><span>Aporte a Organizations</span><strong>{stats.organizationPoints.toLocaleString()} SP</strong></div><div className="profile-social-stat-v9"><span>Retos pendientes</span><strong>{stats.pendingChallenges}</strong></div><Link className="profile-primary-v9 profile-gymbros-link-v9" to="/gymbros"><UsersRound size={16}/> Gestionar Gymbros</Link><Link className="profile-primary-v9 profile-squads-link-v11" to="/squads">Gestionar Squads</Link><Link className="profile-primary-v9 profile-organizations-link-v12" to="/organizations"><Building2 size={16}/> Gestionar Organizations</Link><Link className="profile-primary-v9 profile-gym-battles-link-v121" to="/gym-battles">Gym vs Gym</Link></section>
        </section>
      </>}
    </main></div>
  );
}
