import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { readStorage, writeStorage } from '../lib/storage';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: 'user' | 'admin' | 'guest';
}

interface StoredUser extends AuthUser {
  password: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  loginAsGuest: () => void;
  logout: () => void;
}

const USERS_KEY = 'dadofit:local-auth:users';
const SESSION_KEY = 'dadofit:local-auth:session';
const DEMO_USER: StoredUser = {
  id: 'demo-admin',
  email: 'admin@dadofit.local',
  name: 'Admin DadoFit',
  role: 'admin',
  password: 'admin123',
};

const AuthContext = createContext<AuthContextValue | null>(null);

function getStoredUsers(): StoredUser[] {
  const users = readStorage<StoredUser[]>(USERS_KEY, []);
  return users.some((item) => item.email === DEMO_USER.email) ? users : [DEMO_USER, ...users];
}

function publicUser(user: StoredUser): AuthUser {
  const { password: _password, ...safe } = user;
  return safe;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(() => readStorage<AuthUser | null>(SESSION_KEY, null));

  const login = async (email: string, password: string) => {
    const normalized = email.trim().toLowerCase();
    const match = getStoredUsers().find((item) => item.email.toLowerCase() === normalized && item.password === password);
    if (!match) throw new Error('Correo o contraseña incorrectos.');
    const next = publicUser(match);
    setUser(next);
    writeStorage(SESSION_KEY, next);
  };

  const register = async (name: string, email: string, password: string) => {
    const normalized = email.trim().toLowerCase();
    const users = getStoredUsers();
    if (users.some((item) => item.email.toLowerCase() === normalized)) throw new Error('Ya existe una cuenta con ese correo.');
    const nextStored: StoredUser = {
      id: `local-${Date.now()}`,
      email: normalized,
      name: name.trim(),
      role: 'user',
      password,
    };
    const nextUsers = [...users, nextStored];
    writeStorage(USERS_KEY, nextUsers);
    const next = publicUser(nextStored);
    setUser(next);
    writeStorage(SESSION_KEY, next);
  };

  const loginAsGuest = () => {
    const next: AuthUser = { id: 'guest', email: '', name: 'Invitado', role: 'guest' };
    setUser(next);
    writeStorage(SESSION_KEY, next);
  };

  const logout = () => {
    setUser(null);
    try { localStorage.removeItem(SESSION_KEY); } catch { /* localStorage may be blocked */ }
  };

  const value = useMemo<AuthContextValue>(() => ({ user, login, register, loginAsGuest, logout }), [user]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}
