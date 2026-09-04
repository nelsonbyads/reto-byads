import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { supabase } from '../lib/supabase';

export function PlatformAccountGate({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const [status, setStatus] = useState<'loading' | 'active' | 'suspended'>('loading');

  useEffect(() => {
    let mounted = true;
    const run = async () => {
      if (!user || user.provider !== 'supabase' || !supabase) {
        if (mounted) setStatus('active');
        return;
      }
      const { data, error } = await supabase.rpc('get_my_platform_status');
      if (mounted) setStatus(!error && data === 'suspended' ? 'suspended' : 'active');
    };
    void run();
    return () => { mounted = false; };
  }, [user]);

  if (status === 'loading') return <main className="auth-loading">Validando cuenta…</main>;
  if (status === 'suspended') return (
    <main className="platform-suspended-v14">
      <ShieldAlert size={42}/><h1>Cuenta suspendida</h1>
      <p>Tu acceso a DadoFit fue suspendido por administración. Si consideras que se trata de un error, comunícate con soporte.</p>
      <div><Link to="/contact">Contactar soporte</Link><button type="button" onClick={() => { void logout(); }}>Cerrar sesión</button></div>
    </main>
  );
  return children;
}
