import { ArrowRight, Dumbbell, Eye, EyeOff, LifeBuoy, MailCheck, ShieldCheck, Sparkles } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { readAuthLinkToken } from '../lib/authLinkToken';

type ConfirmState = 'idle' | 'checking' | 'confirmed' | 'failed';

export function LoginPage() {
  const { user, loading, login, loginAsGuest, recoveryMode, confirmEmail, resendConfirmation } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [needsConfirmation, setNeedsConfirmation] = useState(false);
  const [resent, setResent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [confirmState, setConfirmState] = useState<ConfirmState>('idle');
  const confirmStarted = useRef(false);

  // E-mail confirmation links arrive as /login#confirm=<token> (legacy: ?confirm=).
  // A link opened in a tab already on /login only changes the fragment (no page
  // load), hence the hashchange listener.
  useEffect(() => {
    const check = () => {
      if (confirmStarted.current) return;
      const { token, cleanedUrl } = readAuthLinkToken(window.location.href, 'confirm');
      if (!token) return;
      confirmStarted.current = true;
      setConfirmState('checking');
      navigate(cleanedUrl, { replace: true, state: window.history.state?.usr });
      confirmEmail(token)
        .then(() => setConfirmState('confirmed'))
        .catch(() => setConfirmState('failed'))
        .finally(() => { confirmStarted.current = false; });
    };
    check();
    window.addEventListener('hashchange', check);
    return () => window.removeEventListener('hashchange', check);
  }, [navigate, confirmEmail]);

  if (loading) return <main className="auth-loading">Conectando DadoFit…</main>;
  if (recoveryMode) return <Navigate to="/reset-password" replace />;
  if (user) return <Navigate to="/" replace />;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setNeedsConfirmation(false);
    setResent(false);
    setSubmitting(true);
    try {
      await login(email, password);
      const from = (location.state as { from?: string } | null)?.from ?? '/';
      navigate(from, { replace: true });
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'No pudimos iniciar sesión.';
      setError(message);
      setNeedsConfirmation(/confirmar tu correo/i.test(message));
    } finally {
      setSubmitting(false);
    }
  };

  const resend = async () => {
    await resendConfirmation(email);
    setResent(true);
  };

  const guest = () => {
    loginAsGuest();
    navigate('/', { replace: true });
  };

  return <main className="auth-page">
    <section className="auth-hero" aria-hidden="true">
      <div className="auth-brand"><div className="brand-mark brand-mark-large"><Dumbbell /></div><span>DadoFit</span></div>
      <div className="auth-hero-copy"><span className="auth-kicker"><Sparkles size={15} /> FITNESS + GAME</span><h1>Una cuenta. El contexto correcto.</h1><p>Entra con tu identidad y cambia entre tu perfil personal, tus Gyms y tus Marcas según tus permisos.</p></div>
      <div className="auth-proof"><ShieldCheck size={18} /><span>Workspaces y RBAC activos</span></div>
    </section>
    <section className="auth-panel"><div className="auth-form-wrap">
      <div className="mobile-auth-brand"><div className="brand-mark"><Dumbbell size={18} /></div><strong>DadoFit</strong></div>
      <div className="auth-heading"><span className="eyebrow">BIENVENIDO</span><h2>Inicia sesión</h2><p>No necesitas un login diferente para cada rol. Elegirás el workspace después de entrar.</p></div>
      {confirmState === 'checking' && <div className="auth-proof" role="status"><MailCheck size={18} /><span>Confirmando tu correo…</span></div>}
      {confirmState === 'confirmed' && <div className="auth-proof" role="status"><MailCheck size={18} /><span>Correo confirmado. Ya puedes iniciar sesión.</span></div>}
      {confirmState === 'failed' && <div className="auth-error" role="alert">El enlace de confirmación no es válido o ya expiró. Inicia sesión para pedir uno nuevo.</div>}
      <form className="auth-form" onSubmit={submit}>
        <label>Correo electrónico<input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="tu@correo.com" required /></label>
        <label>Contraseña<div className="password-field"><input type={showPassword ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" minLength={6} required /><button type="button" onClick={() => setShowPassword((v) => !v)} aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></div></label>
        <div className="auth-forgot-row-v15713"><Link to="/forgot-password">¿Olvidaste tu contraseña?</Link></div>
        {error && <div className="auth-error" role="alert">{error}</div>}
        {needsConfirmation && (resent
          ? <div className="auth-proof" role="status"><MailCheck size={18} /><span>Si la cuenta existe, enviamos un nuevo enlace de confirmación.</span></div>
          : <button className="auth-guest" type="button" onClick={() => void resend()}>Reenviar correo de confirmación</button>)}
        <button className="auth-primary" type="submit" disabled={submitting}>{submitting ? 'Ingresando…' : <>ENTRAR <ArrowRight size={18} /></>}</button>
      </form>
      <button className="auth-guest" type="button" onClick={guest}>Continuar como invitado</button>
      <p className="auth-switch">¿No tienes cuenta? <Link to="/register">Crear cuenta DadoFit</Link></p>
      <p className="auth-switch"><LifeBuoy size={13} /> ¿Necesitas ayuda o quieres pautar? <Link to="/contact">Contáctanos</Link></p>
      {import.meta.env.DEV && <details className="demo-credentials"><summary>Acceso local (solo desarrollo)</summary><code>admin@dadofit.local</code><code>admin123</code></details>}
    </div></section>
  </main>;
}
