import { ArrowLeft, ArrowRight, Dumbbell, Mail, ShieldCheck } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { isSupabaseConfigured } from '../lib/supabase';

export function ForgotPasswordPage() {
  const { user, loading, recoveryMode, requestPasswordReset } = useAuth();
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  if (loading) return <main className="auth-loading">Conectando DadoFit…</main>;
  if (recoveryMode) return <Navigate to="/reset-password" replace/>;
  if (user) return <Navigate to="/profile" replace/>;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await requestPasswordReset(email);
      setSent(true);
    } catch {
      setError('No pudimos procesar la solicitud. Revisa tu conexión e inténtalo nuevamente en unos minutos.');
    } finally {
      setSubmitting(false);
    }
  };

  return <main className="auth-page auth-page-security-v15713">
    <section className="auth-hero auth-hero-security-v15713" aria-hidden="true">
      <div className="auth-brand"><div className="brand-mark brand-mark-large"><Dumbbell/></div><span>DadoFit</span></div>
      <div className="auth-hero-copy"><span className="auth-kicker"><ShieldCheck size={15}/> SEGURIDAD DE CUENTA</span><h1>Recupera el acceso sin exponer tu contraseña.</h1><p>DadoFit nunca muestra ni recupera contraseñas existentes. Te enviaremos un enlace seguro para definir una nueva.</p></div>
      <div className="auth-proof"><Mail size={18}/><span>Recuperación gestionada por Supabase Auth</span></div>
    </section>
    <section className="auth-panel"><div className="auth-form-wrap">
      <div className="mobile-auth-brand"><div className="brand-mark"><Dumbbell size={18}/></div><strong>DadoFit</strong></div>
      <Link className="back-link" to="/login"><ArrowLeft size={16}/> Volver al inicio de sesión</Link>
      <div className="auth-heading"><span className="eyebrow">RECUPERAR ACCESO</span><h2>¿Olvidaste tu contraseña?</h2><p>Ingresa el correo asociado a tu cuenta DadoFit.</p></div>
      {!isSupabaseConfigured ? <div className="auth-error" role="alert">La recuperación de contraseña requiere conexión con Supabase.</div> : sent ? <div className="password-recovery-sent-v15713" role="status"><Mail size={24}/><strong>Revisa tu correo</strong><p>Si existe una cuenta asociada a <b>{email.trim()}</b>, recibirás un enlace para crear una nueva contraseña.</p><small>Por seguridad no confirmamos si el correo está registrado.</small><Link className="auth-primary password-auth-link-v15713" to="/login">VOLVER AL LOGIN <ArrowRight size={18}/></Link></div> : <form className="auth-form" onSubmit={submit}>
        <label>Correo electrónico<input type="email" autoComplete="email" value={email} onChange={(event)=>setEmail(event.target.value)} placeholder="tu@correo.com" required/></label>
        {error&&<div className="auth-error" role="alert">{error}</div>}
        <button className="auth-primary" type="submit" disabled={submitting}>{submitting?'Enviando…':<>ENVIAR ENLACE <ArrowRight size={18}/></>}</button>
      </form>}
    </div></section>
  </main>;
}
