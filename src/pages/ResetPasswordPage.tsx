import { ArrowLeft, ArrowRight, Dumbbell, Eye, EyeOff, KeyRound, ShieldCheck } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, validateNewPassword, validatePasswordConfirmation } from '../lib/passwordRules';

export function ResetPasswordPage() {
  const { user, loading, recoveryMode, completePasswordRecovery, cancelPasswordRecovery } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [error, setError] = useState('');

  if (loading) return <main className="auth-loading">Validando enlace seguro…</main>;

  const hasRecoverySession = recoveryMode && user?.provider === 'supabase';

  const cancelRecovery = async (destination: '/login' | '/forgot-password') => {
    await cancelPasswordRecovery();
    navigate(destination, { replace: true });
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    const passwordError = validateNewPassword(password);
    if (passwordError) { setError(passwordError); return; }
    const confirmationError = validatePasswordConfirmation(password, confirmation);
    if (confirmationError) { setError(confirmationError); return; }
    setSubmitting(true);
    try {
      await completePasswordRecovery(password);
      setPassword('');
      setConfirmation('');
      setCompleted(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No pudimos actualizar la contraseña.');
    } finally {
      setSubmitting(false);
    }
  };

  return <main className="auth-page auth-page-security-v15713">
    <section className="auth-hero auth-hero-security-v15713" aria-hidden="true">
      <div className="auth-brand"><div className="brand-mark brand-mark-large"><Dumbbell/></div><span>DadoFit</span></div>
      <div className="auth-hero-copy"><span className="auth-kicker"><KeyRound size={15}/> NUEVA CONTRASEÑA</span><h1>Recupera tu cuenta y vuelve a entrenar.</h1><p>El enlace de recuperación crea una sesión temporal. Al guardar la nueva contraseña cerraremos esa sesión y volverás al login.</p></div>
      <div className="auth-proof"><ShieldCheck size={18}/><span>Tu contraseña nunca es visible para DadoFit</span></div>
    </section>
    <section className="auth-panel"><div className="auth-form-wrap">
      <div className="mobile-auth-brand"><div className="brand-mark"><Dumbbell size={18}/></div><strong>DadoFit</strong></div>
      {completed ? <div className="password-recovery-sent-v15713" role="status"><ShieldCheck size={26}/><strong>Contraseña actualizada</strong><p>Tu sesión de recuperación fue cerrada. Ya puedes ingresar con la nueva contraseña.</p><Link className="auth-primary password-auth-link-v15713" to="/login">INICIAR SESIÓN <ArrowRight size={18}/></Link></div> : !hasRecoverySession ? <div className="password-recovery-invalid-v15713"><KeyRound size={26}/><div className="auth-heading"><span className="eyebrow">ENLACE NO DISPONIBLE</span><h2>Solicita un enlace nuevo</h2><p>Este enlace de recuperación no es válido, ya fue utilizado o expiró.</p></div><button className="auth-primary password-auth-link-v15713" type="button" onClick={()=>void cancelRecovery('/forgot-password')}>SOLICITAR OTRO ENLACE <ArrowRight size={18}/></button><button className="back-link password-back-v15713 recovery-link-button-v157131" type="button" onClick={()=>void cancelRecovery('/login')}><ArrowLeft size={16}/> Volver al login</button></div> : <>
        <button className="back-link recovery-link-button-v157131" type="button" onClick={()=>void cancelRecovery('/login')}><ArrowLeft size={16}/> Cancelar y volver</button>
        <div className="auth-heading"><span className="eyebrow">RESTABLECER CONTRASEÑA</span><h2>Crea una contraseña nueva</h2><p>Debe tener entre {PASSWORD_MIN_LENGTH} y {PASSWORD_MAX_LENGTH} caracteres.</p></div>
        <form className="auth-form" onSubmit={submit}>
          <label>Nueva contraseña<div className="password-field"><input type={showPassword?'text':'password'} autoComplete="new-password" value={password} onChange={(event)=>setPassword(event.target.value)} minLength={PASSWORD_MIN_LENGTH} maxLength={PASSWORD_MAX_LENGTH} required/><button type="button" onClick={()=>setShowPassword((value)=>!value)} aria-label={showPassword?'Ocultar contraseña':'Mostrar contraseña'}>{showPassword?<EyeOff size={18}/>:<Eye size={18}/>}</button></div></label>
          <label>Confirmar nueva contraseña<input type={showPassword?'text':'password'} autoComplete="new-password" value={confirmation} onChange={(event)=>setConfirmation(event.target.value)} minLength={PASSWORD_MIN_LENGTH} maxLength={PASSWORD_MAX_LENGTH} required/></label>
          <div className="password-policy-v15713"><ShieldCheck size={16}/><span>Mínimo {PASSWORD_MIN_LENGTH} caracteres. No reutilices una contraseña de otro servicio.</span></div>
          {error&&<div className="auth-error" role="alert">{error}</div>}
          <button className="auth-primary" type="submit" disabled={submitting}>{submitting?'Actualizando…':<>GUARDAR CONTRASEÑA <ArrowRight size={18}/></>}</button>
        </form>
      </>}
    </div></section>
  </main>;
}
