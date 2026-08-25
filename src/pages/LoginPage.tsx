import { ArrowRight, Dumbbell, Eye, EyeOff, ShieldCheck, Sparkles } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { isSupabaseConfigured } from '../lib/supabase';

export function LoginPage() {
  const { user, loading, login, loginAsGuest } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (loading) return <main className="auth-loading">Conectando DadoFit…</main>;
  if (user) return <Navigate to="/app" replace />;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await login(email, password);
      const from = (location.state as { from?: string } | null)?.from ?? '/app';
      navigate(from, { replace: true });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No pudimos iniciar sesión.');
    } finally {
      setSubmitting(false);
    }
  };

  const guest = () => { loginAsGuest(); navigate('/app', { replace: true }); };

  return (
    <main className="auth-page">
      <section className="auth-hero" aria-hidden="true">
        <div className="auth-brand"><div className="brand-mark brand-mark-large"><Dumbbell /></div><span>DadoFit</span></div>
        <div className="auth-hero-copy">
          <span className="auth-kicker"><Sparkles size={15}/> FITNESS + GAME</span>
          <h1>Tu próximo ejercicio está a una tirada.</h1>
          <p>Entrena, reta Gymbros y construye tu progreso desde una sola cuenta.</p>
        </div>
        <div className="auth-proof"><ShieldCheck size={18}/><span>{isSupabaseConfigured ? 'Cuenta cloud de DadoFit activa' : 'Modo local de recuperación'}</span></div>
      </section>

      <section className="auth-panel">
        <div className="auth-form-wrap">
          <div className="mobile-auth-brand"><div className="brand-mark"><Dumbbell size={18}/></div><strong>DadoFit</strong></div>
          <div className="auth-heading"><span className="eyebrow">BIENVENIDO</span><h2>Inicia sesión</h2><p>{isSupabaseConfigured ? 'Tu progreso ahora puede acompañarte entre dispositivos.' : 'Continúa tu sesión de entrenamiento.'}</p></div>
          <form className="auth-form" onSubmit={submit}>
            <label>Correo electrónico<input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="tu@correo.com" required /></label>
            <label>Contraseña<div className="password-field"><input type={showPassword ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" minLength={6} required/><button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}>{showPassword ? <EyeOff size={18}/> : <Eye size={18}/>}</button></div></label>
            {error && <div className="auth-error" role="alert">{error}</div>}
            <button className="auth-primary" type="submit" disabled={submitting}>{submitting ? 'Ingresando…' : <>ENTRAR <ArrowRight size={18}/></>}</button>
          </form>
          <button className="auth-guest" type="button" onClick={guest}>Continuar como invitado</button>
          <p className="auth-switch">¿No tienes cuenta? <Link to="/register">Crear cuenta DadoFit</Link></p>
          <details className="demo-credentials"><summary>Acceso local de recuperación</summary><code>admin@dadofit.local</code><code>admin123</code></details>
        </div>
      </section>
    </main>
  );
}
