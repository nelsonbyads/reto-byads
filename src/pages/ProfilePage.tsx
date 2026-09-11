import { ArrowLeft, Building2, Coins, Eye, EyeOff, KeyRound, Save, ShieldCheck, Sparkles, Trophy, UserRound, UsersRound } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { WorkspaceActionLink } from '../components/WorkspaceActionLink';
import { AppHeader } from '../components/AppHeader';
import { useAuth } from '../auth/AuthContext';
import { supabase } from '../lib/supabase';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, validateNewPassword, validatePasswordConfirmation } from '../lib/passwordRules';

interface SponsorPointBalance { sponsor_organization_id: string; sponsor_name: string; logo_url: string | null; balance: number; lifetime_earned: number; lifetime_spent: number; }

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
  const { user, changePassword } = useAuth();
  const [displayName, setDisplayName] = useState(user?.name ?? '');
  const [username, setUsername] = useState(user?.username ?? '');
  const [stats, setStats] = useState<ProfileStats>(EMPTY_STATS);
  const [sponsorBalances, setSponsorBalances] = useState<SponsorPointBalance[]>([]);
  const [loading, setLoading] = useState(user?.provider === 'supabase');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showSecurityPasswords, setShowSecurityPasswords] = useState(false);
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [passwordMessage, setPasswordMessage] = useState('');

  useEffect(() => {
    if (!user || user.provider !== 'supabase' || !supabase) { setLoading(false); return; }
    const client = supabase;
    let active = true;
    const load = async () => {
      const [profileResult, progressResult, walletResult, sentGymbros, receivedGymbros, squadsResult, organizationsResult, dashboardResult, sponsorPointsResult] = await Promise.all([
        client.from('profiles').select('display_name, username').eq('id', user.id).single(),
        client.from('user_progress').select('xp, level, current_streak, challenges_completed').eq('user_id', user.id).single(),
        client.from('wallets').select('balance').eq('user_id', user.id).single(),
        client.from('friendships').select('id', { count: 'exact', head: true }).eq('requester_id', user.id).eq('status', 'accepted'),
        client.from('friendships').select('id', { count: 'exact', head: true }).eq('addressee_id', user.id).eq('status', 'accepted'),
        client.from('group_members').select('group_id', { count: 'exact', head: true }).eq('user_id', user.id).eq('status', 'active'),
        client.from('organization_members').select('organization_id', { count: 'exact', head: true }).eq('user_id', user.id).eq('status', 'active'),
        client.rpc('get_dadofit_dashboard_summary'),
        client.rpc('get_my_sponsor_point_balances'),
      ]);

      if (!active) return;
      if (profileResult.data) { setDisplayName(profileResult.data.display_name ?? ''); setUsername(profileResult.data.username ?? ''); }
      const dashboard = (dashboardResult.data ?? {}) as { squad_contribution_points?: number; organization_contribution_points?: number; direct_pending?: number; squad_pending?: number; organization_pending?: number; gym_battle_pending?: number };
      setStats({
        xp: Number(progressResult.data?.xp ?? 0), level: Number(progressResult.data?.level ?? 1), currentStreak: Number(progressResult.data?.current_streak ?? 0), challengesCompleted: Number(progressResult.data?.challenges_completed ?? 0), coins: Number(walletResult.data?.balance ?? 0),
        gymbros: Number(sentGymbros.count ?? 0) + Number(receivedGymbros.count ?? 0), squads: Number(squadsResult.count ?? 0), squadPoints: Number(dashboard.squad_contribution_points ?? 0), organizations: Number(organizationsResult.count ?? 0), organizationPoints: Number(dashboard.organization_contribution_points ?? 0), pendingChallenges: Number(dashboard.direct_pending ?? 0) + Number(dashboard.squad_pending ?? 0) + Number(dashboard.organization_pending ?? 0) + Number(dashboard.gym_battle_pending ?? 0),
      });
      setSponsorBalances(sponsorPointsResult.error ? [] : ((sponsorPointsResult.data ?? []) as SponsorPointBalance[]));
      setLoading(false);
    };
    void load();
    return () => { active = false; };
  }, [user]);

  const savePassword = async (event: FormEvent) => {
    event.preventDefault();
    setPasswordError('');
    setPasswordMessage('');
    if (!currentPassword) { setPasswordError('Ingresa tu contraseña actual.'); return; }
    if (currentPassword === newPassword) { setPasswordError('La nueva contraseña debe ser diferente a la actual.'); return; }
    const passwordRuleError = validateNewPassword(newPassword);
    if (passwordRuleError) { setPasswordError(passwordRuleError); return; }
    const confirmationError = validatePasswordConfirmation(newPassword, confirmPassword);
    if (confirmationError) { setPasswordError(confirmationError); return; }
    setPasswordSaving(true);
    try {
      await changePassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPasswordMessage('Contraseña actualizada correctamente.');
    } catch (reason) {
      setPasswordError(reason instanceof Error ? reason.message : 'No pudimos actualizar la contraseña.');
    } finally {
      setPasswordSaving(false);
    }
  };

  const save = async (event: FormEvent) => {
    event.preventDefault(); setMessage(''); setError('');
    if (!user || user.provider !== 'supabase' || !supabase) return;
    const normalizedUsername = username.trim().toLowerCase();
    if (!/^[a-z0-9_.]{3,30}$/.test(normalizedUsername)) { setError('El username debe tener 3-30 caracteres: letras minúsculas, números, punto o guion bajo.'); return; }
    setSaving(true);
    const { error: updateError } = await supabase.from('profiles').update({ display_name: displayName.trim(), username: normalizedUsername }).eq('id', user.id);
    setSaving(false);
    if (updateError) { setError(updateError.code === '23505' ? 'Ese username ya está siendo usado.' : updateError.message); return; }
    setUsername(normalizedUsername); setMessage('Perfil actualizado.');
  };

  return (
    <div className="profile-shell-v9 profile-shell-v133"><AppHeader/><main className="profile-page-v9 profile-page-v133">
      <WorkspaceActionLink className="profile-back-v9" to="/app" workspaceId="personal"><ArrowLeft size={16}/> Volver a entrenar</WorkspaceActionLink>
      <section className="profile-hero-v9 profile-hero-v133">
        <div className="profile-avatar-v9 profile-avatar-v133"><UserRound size={34}/></div>
        <div className="profile-hero-copy-v133">
          <span className="eyebrow">PERFIL DADOFIT</span>
          <h1>{displayName || user?.name || 'Gymbro'}</h1>
          <p>@{username || 'gymbro'} · Nivel {stats.level}</p>
        </div>
        <span className="profile-cloud-badge-v133">{user?.provider === 'supabase' ? 'Cloud conectado' : 'Sesión local'}</span>
      </section>

      {user?.provider !== 'supabase' ? <section className="profile-card-v9 profile-cloud-callout-v9"><h2>Activa tu perfil social</h2><p>Los Gymbros, retos, DadoCoins, Squads y organizaciones requieren una cuenta cloud.</p><Link className="profile-primary-v9" to="/register">Crear cuenta DadoFit</Link></section> : loading ? <section className="profile-card-v9">Cargando perfil…</section> : <>
        <section className="profile-stats-v9 profile-stats-v133">
          <article><Trophy size={20}/><span>Nivel</span><strong>{stats.level}</strong></article>
          <article><span className="profile-xp-icon-v9">XP</span><span>Experiencia</span><strong>{stats.xp.toLocaleString()}</strong></article>
          <article><Coins size={20}/><span>DadoCoins</span><strong>{stats.coins.toLocaleString()} DC</strong></article>
          <article><span className="profile-fire-v9">🔥</span><span>Racha</span><strong>{stats.currentStreak} días</strong></article>
        </section>

        <section id="sponsor-points" className="profile-card-v9 sponsor-wallet-eco1">
          <div className="sponsor-wallet-head-eco1"><div><span className="eyebrow">SPONSOR POINTS</span><h2>Tus saldos por Marca</h2><p>Los SP son exclusivos de cada patrocinador: SP Nike no se pueden usar en Adidas, Gyms ni otros sponsors.</p></div><Sparkles size={24}/></div>
          {sponsorBalances.length === 0 ? <div className="sponsor-wallet-empty-eco1"><strong>0 SP</strong><span>Aún no has ganado Sponsor Points. Participa en Branded Challenges para obtenerlos.</span></div> : <div className="sponsor-wallet-grid-eco1">{sponsorBalances.map((item) => <article key={item.sponsor_organization_id}><div className="sponsor-wallet-logo-eco1">{item.logo_url ? <img src={item.logo_url} alt=""/> : <Sparkles size={18}/>}</div><div><span>{item.sponsor_name}</span><strong>{Number(item.balance ?? 0).toLocaleString()} SP</strong><small>Ganados {Number(item.lifetime_earned ?? 0).toLocaleString()} · usados {Number(item.lifetime_spent ?? 0).toLocaleString()}</small></div></article>)}</div>}
        </section>

        <section className="profile-grid-v9 profile-grid-v133">
          <section className="profile-card-v9 profile-community-v133">
            <div><span className="eyebrow">ACTIVIDAD SOCIAL</span><h2>Tu ecosistema DadoFit</h2><p className="profile-section-copy-v133">Tu progreso social, participación y actividad competitiva.</p></div>
            <div className="profile-community-grid-v133">
              <div><span>Retos completados</span><strong>{stats.challengesCompleted}</strong></div>
              <div><span>Gymbros</span><strong>{stats.gymbros}</strong></div>
              <div><span>Squads</span><strong>{stats.squads}</strong></div>
              <div><span>Retos pendientes</span><strong>{stats.pendingChallenges}</strong></div>
              <div><span>Aporte a Squads</span><strong>{stats.squadPoints.toLocaleString()} TP</strong></div>
              <div><span>Aporte a Gym</span><strong>{stats.organizationPoints.toLocaleString()} GP</strong></div>
            </div>
            <div className="profile-action-links-v133">
              <WorkspaceActionLink to="/gymbros" workspaceId="personal"><UsersRound size={16}/> Gymbros</WorkspaceActionLink>
              <WorkspaceActionLink to="/squads" workspaceId="personal"><Trophy size={16}/> Squads</WorkspaceActionLink>
              <WorkspaceActionLink to="/organizations" workspaceId="personal"><Building2 size={16}/> Organizaciones ({stats.organizations})</WorkspaceActionLink>
            </div>
          </section>

          <form className="profile-card-v9 profile-form-v9 profile-settings-v133" onSubmit={save}>
            <div><span className="eyebrow">IDENTIDAD</span><h2>Perfil y cuenta</h2><p className="profile-section-copy-v133">Configura cómo te ven los demás Gymbros.</p></div>
            <label>Nombre visible<input value={displayName} onChange={(e) => setDisplayName(e.target.value)} minLength={2} maxLength={60} required/></label>
            <label>Username<div className="profile-username-field-v9"><span>@</span><input value={username} onChange={(e) => setUsername(e.target.value)} minLength={3} maxLength={30} required/></div></label>
            {error && <div className="auth-error">{error}</div>}{message && <div className="auth-success">{message}</div>}
            <button className="profile-primary-v9" type="submit" disabled={saving}><Save size={16}/>{saving ? 'Guardando…' : 'Guardar cambios'}</button>
          </form>
        </section>

        <section id="account-security" className="profile-card-v9 account-security-v15713">
          <div className="account-security-head-v15713"><div><span className="eyebrow">SEGURIDAD</span><h2>Contraseña de tu cuenta</h2><p className="profile-section-copy-v133">Actualiza tu contraseña verificando primero la actual. Ningún Gym, Marca o administrador puede verla.</p></div><ShieldCheck size={24}/></div>
          <form className="profile-form-v9 account-security-form-v15713" onSubmit={savePassword}>
            <label>Contraseña actual<div className="password-field-v15713"><input type={showSecurityPasswords?'text':'password'} autoComplete="current-password" value={currentPassword} onChange={(event)=>setCurrentPassword(event.target.value)} required/><button type="button" onClick={()=>setShowSecurityPasswords((value)=>!value)} aria-label={showSecurityPasswords?'Ocultar contraseñas':'Mostrar contraseñas'}>{showSecurityPasswords?<EyeOff size={17}/>:<Eye size={17}/>}</button></div></label>
            <label>Nueva contraseña<input type={showSecurityPasswords?'text':'password'} autoComplete="new-password" value={newPassword} onChange={(event)=>setNewPassword(event.target.value)} minLength={PASSWORD_MIN_LENGTH} maxLength={PASSWORD_MAX_LENGTH} required/></label>
            <label>Confirmar contraseña<input type={showSecurityPasswords?'text':'password'} autoComplete="new-password" value={confirmPassword} onChange={(event)=>setConfirmPassword(event.target.value)} minLength={PASSWORD_MIN_LENGTH} maxLength={PASSWORD_MAX_LENGTH} required/></label>
            <div className="password-policy-profile-v15713"><KeyRound size={15}/><span>Entre {PASSWORD_MIN_LENGTH} y {PASSWORD_MAX_LENGTH} caracteres. Evita reutilizar contraseñas de otros servicios.</span></div>
            {passwordError&&<div className="auth-error" role="alert">{passwordError}</div>}{passwordMessage&&<div className="auth-success" role="status">{passwordMessage}</div>}
            <button className="profile-primary-v9" type="submit" disabled={passwordSaving}><KeyRound size={16}/>{passwordSaving?'Actualizando…':'Cambiar contraseña'}</button>
          </form>
        </section>
      </>}
    </main></div>
  );
}
