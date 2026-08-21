import { ArrowLeft, ArrowRight, Dumbbell } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

export function RegisterPage() {
  const { user, register } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  if (user) return <Navigate to="/app" replace />;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    if (name.trim().length < 2) { setError('Ingresa tu nombre.'); return; }
    if (password.length < 6) { setError('La contraseña debe tener mínimo 6 caracteres.'); return; }
    setSubmitting(true);
    try { await register(name, email, password); navigate('/app', { replace: true }); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'No pudimos crear la cuenta.'); }
    finally { setSubmitting(false); }
  };

  return (
    <main className="auth-page auth-page-register">
      <section className="auth-hero auth-hero-register" aria-hidden="true">
        <div className="auth-brand"><div className="brand-mark brand-mark-large"><Dumbbell /></div><span>DadoFit</span></div>
        <div className="auth-hero-copy"><span className="auth-kicker">EMPIEZA HOY</span><h1>Haz que cada entrenamiento sea distinto.</h1><p>Crea tu perfil local y comienza a registrar tus tiradas y sesiones.</p></div>
      </section>
      <section className="auth-panel"><div className="auth-form-wrap"><Link className="back-link" to="/login"><ArrowLeft size={16}/> Volver</Link><div className="auth-heading"><span className="eyebrow">NUEVA CUENTA</span><h2>Crear perfil</h2><p>Por ahora se guarda únicamente en este navegador.</p></div><form className="auth-form" onSubmit={submit}><label>Nombre<input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required/></label><label>Correo electrónico<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required/></label><label>Contraseña<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" minLength={6} required/></label>{error && <div className="auth-error" role="alert">{error}</div>}<button className="auth-primary" type="submit" disabled={submitting}>{submitting ? 'Creando…' : <>CREAR CUENTA <ArrowRight size={18}/></>}</button></form></div></section>
    </main>
  );
}
