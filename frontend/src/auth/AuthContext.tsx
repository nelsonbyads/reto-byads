import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { readAuthLinkToken } from '../lib/authLinkToken';
import { backend, type BackendUser } from '../lib/backend';
import { readStorage, writeStorage } from '../lib/storage';

export type SignupIntent = 'personal' | 'gym' | 'brand';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: 'user' | 'admin' | 'guest';
  provider: 'cloud' | 'guest' | 'local';
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
  requestPasswordReset: (email: string) => Promise<void>;
  completePasswordRecovery: (newPassword: string) => Promise<void>;
  cancelPasswordRecovery: () => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  confirmEmail: (token: string) => Promise<void>;
  resendConfirmation: (email: string) => Promise<void>;
  recoveryMode: boolean;
}

const USERS_KEY = 'dadofit:local-auth:users';
const SESSION_KEY = 'dadofit:local-auth:session';
const RECOVERY_TOKEN_KEY = 'dadofit:auth:recovery-token';

// Offline local accounts (and the demo admin) exist only in development builds
// (SEC-07). Production only offers cloud accounts and the guest mode.
const LOCAL_ACCOUNTS_ENABLED = import.meta.env.DEV;

/** The recovery e-mail links to /reset-password#token=… (legacy: ?token=…); the
 *  token is moved to sessionStorage and removed from the address bar right away. */
function captureRecoveryToken(): string | null {
  try {
    if (window.location.pathname === '/reset-password') {
      const { token, cleanedUrl } = readAuthLinkToken(window.location.href, 'token');
      if (token) {
        sessionStorage.setItem(RECOVERY_TOKEN_KEY, token);
        window.history.replaceState(window.history.state, '', cleanedUrl);
        return token;
      }
    }
    return sessionStorage.getItem(RECOVERY_TOKEN_KEY);
  } catch {
    return null;
  }
}

function clearRecoveryToken() {
  try { sessionStorage.removeItem(RECOVERY_TOKEN_KEY); } catch { /* ignore */ }
}

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
  if (!LOCAL_ACCOUNTS_ENABLED) return [];
  const users = readStorage<StoredUser[]>(USERS_KEY, []);
  return users.some((item) => item.email === DEMO_USER.email) ? users : [DEMO_USER, ...users];
}

function localPublicUser(user: StoredUser): AuthUser {
  return { id: user.id, email: user.email, name: user.name, role: user.role, provider: 'local', signupIntent: 'personal' };
}

function readFallbackSession(): AuthUser | null {
  const stored = readStorage<AuthUser | null>(SESSION_KEY, null);
  if (!stored) return null;
  if (stored.provider === 'guest') return stored;
  if (stored.provider === 'local' && LOCAL_ACCOUNTS_ENABLED) return stored;
  return null;
}

function clearFallbackSession() {
  try { localStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
}

function cloudPublicUser(user: BackendUser): AuthUser {
  const fallbackName =
    user.user_metadata?.display_name?.trim?.() ||
    user.user_metadata?.full_name?.trim?.() ||
    user.email?.split('@')[0] ||
    'Gymbro';
  const profileIntent = user.profile?.signup_intent;
  const metadataIntent = user.user_metadata?.account_type;
  const signupIntent: SignupIntent = profileIntent === 'gym' || profileIntent === 'brand'
    ? profileIntent
    : metadataIntent === 'gym' || metadataIntent === 'brand'
      ? metadataIntent
      : 'personal';
  return {
    id: user.id,
    email: user.email ?? '',
    name: user.profile?.display_name?.trim() || fallbackName,
    username: user.profile?.username ?? null,
    avatarUrl: user.profile?.avatar_url ?? null,
    role: user.app_metadata?.role === 'admin' ? 'admin' : 'user',
    provider: 'cloud',
    signupIntent,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(() => readFallbackSession());
  const [loading, setLoading] = useState(true);
  const [recoveryToken, setRecoveryToken] = useState<string | null>(() => captureRecoveryToken());

  useEffect(() => {
    let mounted = true;
    const unsubscribe = backend.auth.onChange((next) => {
      if (!mounted) return;
      if (next) {
        setUser(cloudPublicUser(next));
        clearFallbackSession();
      } else {
        setUser(readFallbackSession());
      }
    });
    void backend.auth.restore().then((restored) => {
      if (!mounted) return;
      if (restored) {
        setUser(cloudPublicUser(restored));
        clearFallbackSession();
      }
      setLoading(false);
    });
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  const login = async (email: string, password: string) => {
    const normalized = email.trim().toLowerCase();

    if (LOCAL_ACCOUNTS_ENABLED) {
      const localMatch = getStoredUsers().find((item) => item.email.toLowerCase() === normalized && item.password === password);
      if (localMatch) {
        const next = localPublicUser(localMatch);
        setUser(next);
        writeStorage(SESSION_KEY, next);
        return;
      }
    }

    const result = await backend.auth.login(normalized, password);
    if (!result.ok) throw new Error(result.error?.message ?? 'No pudimos iniciar sesión.');
    setUser(cloudPublicUser(result.body.session.user));
    clearFallbackSession();
  };

  const register = async (name: string, email: string, password: string, signupIntent: SignupIntent = 'personal'): Promise<RegisterResult> => {
    const result = await backend.auth.register({
      email: email.trim().toLowerCase(),
      password,
      display_name: name.trim(),
      account_type: signupIntent,
    });
    if (!result.ok) throw new Error(result.error?.message ?? 'No pudimos crear la cuenta.');
    if (result.body.session) {
      setUser(cloudPublicUser(result.body.session.user));
      clearFallbackSession();
      return { requiresEmailConfirmation: false };
    }
    return { requiresEmailConfirmation: true };
  };

  const requestPasswordReset = async (email: string) => {
    const result = await backend.auth.forgotPassword(email.trim().toLowerCase());
    if (!result.ok) throw new Error(result.error?.message ?? 'No pudimos enviar el enlace de recuperación.');
  };

  const completePasswordRecovery = async (newPassword: string) => {
    if (!recoveryToken) throw new Error('El enlace de recuperación no es válido o ya expiró.');
    const result = await backend.auth.resetPassword(recoveryToken, newPassword);
    if (!result.ok) throw new Error(result.error?.message ?? 'No pudimos actualizar la contraseña.');
    clearRecoveryToken();
    setRecoveryToken(null);
    await backend.auth.logout();
    setUser(null);
  };

  const cancelPasswordRecovery = async () => {
    clearRecoveryToken();
    setRecoveryToken(null);
  };

  const changePassword = async (currentPassword: string, newPassword: string) => {
    if (!user || user.provider !== 'cloud') throw new Error('Esta acción requiere una cuenta cloud.');
    const result = await backend.auth.changePassword(currentPassword, newPassword);
    if (!result.ok) throw new Error(result.error?.message ?? 'No pudimos actualizar la contraseña.');
  };

  const confirmEmail = async (token: string) => {
    const result = await backend.auth.confirmEmail(token);
    if (!result.ok) throw new Error(result.error?.message ?? 'No pudimos confirmar el correo.');
  };

  const resendConfirmation = async (email: string) => {
    await backend.auth.resendConfirmation(email.trim().toLowerCase());
  };

  const loginAsGuest = () => {
    const next: AuthUser = { id: 'guest', email: '', name: 'Invitado', role: 'guest', provider: 'guest', signupIntent: 'personal' };
    setUser(next);
    writeStorage(SESSION_KEY, next);
  };

  const logout = async () => {
    if (user?.provider === 'cloud') await backend.auth.logout();
    setUser(null);
    clearFallbackSession();
  };

  const recoveryMode = Boolean(recoveryToken);

  const value = useMemo<AuthContextValue>(
    () => ({ user, loading, login, register, loginAsGuest, logout, requestPasswordReset, completePasswordRecovery, cancelPasswordRecovery, changePassword, confirmEmail, resendConfirmation, recoveryMode }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [user, loading, recoveryToken],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}
