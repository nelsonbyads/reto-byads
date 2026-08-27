import { Building2, Check, Tag } from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { AppHeader } from '../components/AppHeader';
import { useAuth } from '../auth/AuthContext';
import { useWorkspace } from '../context/WorkspaceContext';
import { supabase } from '../lib/supabase';

export function BusinessSetupPage() {
  const { user } = useAuth();
  const { capabilities, workspaces, refresh } = useWorkspace();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const requested = params.get('type') === 'brand' ? 'brand' : 'gym';
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [website, setWebsite] = useState('');
  const [country, setCountry] = useState('CO');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const allowed = requested === 'gym' ? capabilities.canCreateGym : capabilities.canCreateBrand;
  const existing = useMemo(() => workspaces.find((item) => item.kind === requested), [requested, workspaces]);

  if (!user || user.provider !== 'supabase') return <Navigate to="/app" replace/>;
  if (existing) return <Navigate to="/workspace" replace/>;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!supabase || !allowed) return;
    setSubmitting(true); setError('');
    const { data, error: rpcError } = await supabase.rpc('create_organization', {
      p_name: name.trim(),
      p_organization_type: requested,
      p_description: description.trim() || null,
      p_website_url: website.trim() || null,
      p_country_code: country.trim().toUpperCase() || null,
    });
    setSubmitting(false);
    if (rpcError) { setError(rpcError.message); return; }
    await refresh(`org:${String(data)}`);
    navigate('/workspace', { replace: true });
  };

  return <div className="profile-shell-v9 business-setup-shell-v122"><AppHeader/><main className="business-setup-v122">
    <section className="business-setup-card-v122"><div className="business-setup-icon-v122">{requested === 'gym' ? <Building2 size={32}/> : <Tag size={32}/>}</div><span className="eyebrow">ONBOARDING EMPRESARIAL</span><h1>{requested === 'gym' ? 'Configura tu Gym' : 'Configura tu Marca'}</h1><p>Tu cuenta personal seguirá existiendo. Esta entidad tendrá su propio workspace y sus propios permisos.</p>
      {!allowed ? <div className="auth-error">Tu cuenta no tiene capacidad para crear este tipo de workspace. El tipo de onboarding queda fijado desde el registro o por administración.</div> : <form className="business-setup-form-v122" onSubmit={submit}><label>Nombre<input value={name} onChange={(event) => setName(event.target.value)} minLength={3} maxLength={80} required placeholder={requested === 'gym' ? 'Ej: DadoFit Gym Medellín' : 'Ej: ByAds Sports'}/></label><label>Descripción<textarea rows={3} maxLength={500} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Qué representa esta organización"/></label><label>Website<input value={website} onChange={(event) => setWebsite(event.target.value)} maxLength={300} placeholder="https://..."/></label><label>País<input value={country} onChange={(event) => setCountry(event.target.value.toUpperCase())} maxLength={2} placeholder="CO"/></label>{error && <div className="auth-error">{error}</div>}<button type="submit" disabled={submitting}><Check size={17}/>{submitting ? 'Creando workspace…' : `Crear ${requested === 'gym' ? 'Gym' : 'Marca'}`}</button></form>}
    </section>
  </main></div>;
}
