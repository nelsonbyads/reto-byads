import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { backend } from '../lib/backend';

export function usePlatformAdminStatus() {
  const { user } = useAuth();
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  useEffect(() => {
    let active = true;
    const run = async () => {
      if (!user || user.provider !== 'cloud' || !backend) { if (active) setIsPlatformAdmin(false); return; }
      const { data, error } = await backend.rpc('is_platform_admin', { p_user_id: user.id });
      if (active) setIsPlatformAdmin(!error && data === true);
    };
    void run();
    return () => { active = false; };
  }, [user]);
  return isPlatformAdmin;
}
