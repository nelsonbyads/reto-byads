import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { User as SupabaseUser } from '@supabase/supabase-js';
import { isSupabaseConfigured, supabase } from '../lib/supabase';
import { readStorage, writeStorage } from '../lib/storage';

export type SignupIntent = 'personal' | 'gym' | 'brand';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: 'user' | 'admin' | 'guest';
  provider: 'supabase' | 'guest' | 'local';
  username?: string | null;
  avatarUrl?: string | null;
  signupIntent?: SignupIntent | null;
}

interface StoredUser extends Omit<AuthUser, 'provider'> {
  password: string;
}

export interface RegisterResult {
  requiresEmailConfirmation: boolean;
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string, signupIntent?: SignupIntent) => Promise<RegisterResult>;
  loginAsGuest: () => void;
  logout: () => Promise<void>;
}

const USERS_KEY = 'dadofit:local-auth:users';
const SESSION_KEY = 'dadofit:local-auth:session';
const DEMO_USER: StoredUser = {
  id: 'demo-admin',
  email: 'admin@dadofit.local',
  name: 'Admin DadoFit',
  role: 'admin',
  password: 'admin123',
  signupIntent: 'personal',
};

const AuthContext = createContext<AuthContextValue | null>(null);

function getStoredUsers(): StoredUser[] {
  const users = readStorage<StoredUser[]>(USERS_KEY, []);
  return users.some((item) => item.email === DEMO_USER.email) ? users : [DEMO_USER, ...users];
}

function localPublicUser(user: StoredUser): AuthUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    provider: 'local',
    signupIntent: 'personal',
  };
}

function readFallbackSession(): AuthUser | null {
  const stored = readStorage<AuthUser | null>(SESSION_KEY, null);
  if (!stored) return null;
  if (stored.provider === 'guest' || stored.provider === 'local') return stored;
  return null;
}

async function cloudPublicUser(user: SupabaseUser): Promise<AuthUser> {
  const fallbackName =
    user.user_metadata?.display_name?.trim?.() ||
    user.user_metadata?.full_name?.trim?.() ||
    user.email?.split('@')[0] ||
    'Gymbro';

  let profile: { display_name?: string | null; username?: string | null; avatar_url?: string | null; signup_intent?: string | null } | null = null;

  if (supabase) {
    const { data } = await supabase
      .from('profiles')
      .select('display_name, username, avatar_url, signup_intent')
      .eq('id', user.id)
      .maybeSingle();
    profile = data;
  }

  const profileIntent = profile?.signup_intent;
  const metadataIntent = user.user_metadata?.account_type;
  const signupIntent: SignupIntent = profileIntent === 'gym' || profileIntent === 'brand'
    ? profileIntent
    : metadataIntent === 'gym' || metadataIntent === 'brand'
      ? metadataIntent
      : 'personal';

  return {
    id: user.id,
    email: user.email ?? '',
    name: profile?.display_name?.trim() || fallbackName,
    username: profile?.username ?? null,
    avatarUrl: profile?.avatar_url ?? null,
    role: user.app_metadata?.role === 'admin' ? 'admin' : 'user',
    provider: 'supabase',
    signupIntent,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(() => readFallbackSession());
  const [loading, setLoading] = useState(isSupabaseConfigured);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }

    let mounted = true;

    const hydrate = async (supabaseUser: SupabaseUser | null) => {
      if (!mounted) return;
      if (!supabaseUser) {
        setUser(readFallbackSession());
        setLoading(false);
        return;
      }

      const next = await cloudPublicUser(supabaseUser);
      if (!mounted) return;
      setUser(next);
      setLoading(false);
      try { localStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
    };

    void supabase.auth.getSession().then(({ data }) => hydrate(data.session?.user ?? null));

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      window.setTimeout(() => { void hydrate(session?.user ?? null); }, 0);
    });

    return () => {
      mounted = false;
      authListener.subscription.unsubscribe();
    };
  }, []);

  const login = async (email: string, password: string) => {
    const normalized = email.trim().toLowerCase();

    if (normalized === DEMO_USER.email && password === DEMO_USER.password) {
      if (supabase) await supabase.auth.signOut({ scope: 'local' });
      const next = localPublicUser(DEMO_USER);
      setUser(next);
      writeStorage(SESSION_KEY, next);
      return;
    }

    if (supabase) {
      const { data, error } = await supabase.auth.signInWithPassword({ email: normalized, password });
      if (!error && data.user) {
        const next = await cloudPublicUser(data.user);
        setUser(next);
        try { localStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
        return;
      }

      const localMatch = getStoredUsers().find(
        (item) => item.email.toLowerCase() === normalized && item.password === password,
      );
      if (localMatch) {
        const next = localPublicUser(localMatch);
        setUser(next);
        writeStorage(SESSION_KEY, next);
        return;
      }

      throw new Error(error?.message === 'Invalid login credentials' ? 'Correo o contraseña incorrectos.' : (error?.message ?? 'No pudimos iniciar sesión.'));
    }

    const match = getStoredUsers().find(
      (item) => item.email.toLowerCase() === normalized && item.password === password,
    );
    if (!match) throw new Error('Correo o contraseña incorrectos.');
    const next = localPublicUser(match);
    setUser(next);
    writeStorage(SESSION_KEY, next);
  };

  const register = async (name: string, email: string, password: string, signupIntent: SignupIntent = 'personal'): Promise<RegisterResult> => {
    const normalized = email.trim().toLowerCase();
    const cleanName = name.trim();

    if (supabase) {
      const { data, error } = await supabase.auth.signUp({
        email: normalized,
        password,
        options: { data: { display_name: cleanName, account_type: signupIntent } },
      });
      if (error) throw new Error(error.message);

      if (data.session && data.user) {
        const next = await cloudPublicUser(data.user);
        setUser(next);
        return { requiresEmailConfirmation: false };
      }

      return { requiresEmailConfirmation: true };
    }

    const users = getStoredUsers();
    if (users.some((item) => item.email.toLowerCase() === normalized)) {
      throw new Error('Ya existe una cuenta con ese correo.');
    }

    const nextStored: StoredUser = {
      id: `local-${Date.now()}`,
      email: normalized,
      name: cleanName,
      role: 'user',
      password,
      signupIntent: 'personal',
    };
    writeStorage(USERS_KEY, [...users, nextStored]);
    const next = localPublicUser(nextStored);
    setUser(next);
    writeStorage(SESSION_KEY, next);
    return { requiresEmailConfirmation: false };
  };

  const loginAsGuest = () => {
    const next: AuthUser = {
      id: 'guest',
      email: '',
      name: 'Invitado',
      role: 'guest',
      provider: 'guest',
      signupIntent: 'personal',
    };
    setUser(next);
    writeStorage(SESSION_KEY, next);
  };

  const logout = async () => {
    if (user?.provider === 'supabase' && supabase) {
      await supabase.auth.signOut({ scope: 'local' });
    }
    setUser(null);
    try { localStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
  };

  const value = useMemo<AuthContextValue>(
    () => ({ user, loading, login, register, loginAsGuest, logout }),
    [user, loading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}
