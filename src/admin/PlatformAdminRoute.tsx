import { useEffect, useState, type ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthContext';

export function PlatformAdminRoute({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    let active = true;
    const check = async () => {
      if (!user || user.provider !== 'supabase' || !supabase) {
        if (active) { setAllowed(false); setLoading(false); }
        return;
      }
      const { data, error } = await supabase.rpc('is_platform_admin', { p_user_id: user.id });
      if (active) { setAllowed(!error && data === true); setLoading(false); }
    };
    void check();
    return () => { active = false; };
  }, [user]);

  if (loading) return <main className="auth-loading">Validando permisos de plataforma…</main>;
  if (!allowed) return <Navigate to="/" replace />;
  return children;
}
