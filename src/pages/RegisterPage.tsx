import { ArrowLeft, ArrowRight, Building2, Dumbbell, Tag, UserRound } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth, type SignupIntent } from '../auth/AuthContext';
import { isSupabaseConfigured } from '../lib/supabase';

const INTENTS: Array<{ id: SignupIntent; title: string; description: string; icon: typeof UserRound }> = [
  { id: 'personal', title: 'Soy deportista', description: 'Entrenar, Gymbros, Squads y retos personales.', icon: UserRound },
  { id: 'gym', title: 'Represento un Gym', description: 'Gestionar miembros, retos y competencias Gym vs Gym.', icon: Building2 },
  { id: 'brand', title: 'Represento una Marca', description: 'Preparar campañas, retos patrocinados y rewards.', icon: Tag },
];

export function RegisterPage() {
  const { user, loading, register } = useAuth();
  const navigate = useNavigate();
  const [intent, setIntent] = useState<SignupIntent>('personal');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (loading) return <main className="auth-loading">Conectando DadoFit…</main>;
  if (user) return <Navigate to="/" replace />;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setSuccess('');
    if (name.trim().length < 2) { setError('Ingresa tu nombre.'); return; }
    if (password.length < 6) { setError('La contraseña debe tener mínimo 6 caracteres.'); return; }

    setSubmitting(true);
    try {
      const result = await register(name, email, password, intent);
      if (result.requiresEmailConfirmation) {
        setSuccess('Cuenta creada. Confirma tu correo; al entrar continuaremos con el workspace que elegiste.');
      } else {
        navigate(intent === 'personal' ? '/' : `/business-setup?type=${intent}`, { replace: true });
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No pudimos crear la cuenta.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="auth-page auth-page-register auth-page-register-v122">
      <section className="auth-hero auth-hero-register" aria-hidden="true">
        <div className="auth-brand"><div className="brand-mark brand-mark-large"><Dumbbell /></div><span>DadoFit</span></div>
        <div className="auth-hero-copy"><span className="auth-kicker">UNA CUENTA · VARIOS CONTEXTOS</span><h1>Tu identidad es una. Tus permisos dependen del workspace.</h1><p>Entrena como Gymbro o administra un Gym o una Marca sin crear cuentas separadas.</p></div>
      </section>

      <section className="auth-panel"><div className="auth-form-wrap auth-form-wrap-v122">
        <Link className="back-link" to="/login"><ArrowLeft size={16}/> Volver</Link>
        <div className="auth-heading"><span className="eyebrow">NUEVA CUENTA</span><h2>¿Cómo usarás DadoFit?</h2><p>Siempre tendrás un perfil personal. Esta elección habilita el onboarding empresarial correspondiente.</p></div>

        <div className="signup-intent-grid-v122" role="radiogroup" aria-label="Tipo de cuenta">
          {INTENTS.map((option) => {
            const Icon = option.icon;
            const selected = intent === option.id;
            return <button key={option.id} type="button" role="radio" aria-checked={selected} className={selected ? 'selected' : ''} onClick={() => setIntent(option.id)}><Icon size={20}/><span><strong>{option.title}</strong><small>{option.description}</small></span><i/></button>;
          })}
        </div>

        <form className="auth-form" onSubmit={submit}>
          <label>Nombre<input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required/></label>
          <label>Correo electrónico<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required/></label>
          <label>Contraseña<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" minLength={6} required/></label>
          {error && <div className="auth-error" role="alert">{error}</div>}
          {success && <div className="auth-success" role="status">{success}</div>}
          <button className="auth-primary" type="submit" disabled={submitting || Boolean(success)}>{submitting ? 'Creando…' : <>CREAR CUENTA <ArrowRight size={18}/></>}</button>
        </form>
        {success && <p className="auth-switch"><Link to="/login">Volver a iniciar sesión</Link></p>}
        {!isSupabaseConfigured && intent !== 'personal' && <p className="auth-error">El modo local solo admite el workspace personal. Conecta Supabase para Gyms y Marcas.</p>}
      </div></section>
    </main>
  );
}
