import { Dice5, LogOut, Moon, Palette, Sun, UserRound, UsersRound } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

type DadoFitTheme = 'pastel' | 'light' | 'dark';

const THEME_KEY = 'dadofit:theme:v7';
const THEME_OPTIONS: Array<{ id: DadoFitTheme; label: string; icon: typeof Palette }> = [
  { id: 'pastel', label: 'Pastel', icon: Palette },
  { id: 'light', label: 'Light', icon: Sun },
  { id: 'dark', label: 'Dark', icon: Moon },
];

function readInitialTheme(): DadoFitTheme {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === 'pastel' || stored === 'light' || stored === 'dark') return stored;
  } catch {
    // localStorage can be unavailable in hardened/private environments.
  }
  return 'light';
}

export function AppHeader() {
  const { user, logout } = useAuth();
  const [theme, setTheme] = useState<DadoFitTheme>(readInitialTheme);

  useEffect(() => {
    document.documentElement.dataset.dadofitTheme = theme;
    try { localStorage.setItem(THEME_KEY, theme); } catch { /* ignore storage failures */ }
  }, [theme]);

  return (
    <header className="topbar topbar-v7">
      <div className="topbar-brand">
        <div className="brand-mark brand-mark-v7"><Dice5 size={20} /></div>
        <div className="brand-copy-v7">
          <strong>DadoFit</strong>
          <span>Entrena. Lanza. Repite.</span>
          <small>SISTEMA DE ENTRENAMIENTO</small>
        </div>
      </div>

      <div className="topbar-actions-v7">
        <div className="theme-picker-v7" role="group" aria-label="Tema de la aplicación">
          <span className="theme-picker-label-v7">TEMA</span>
          <div className="theme-segments-v7">
            {THEME_OPTIONS.map((option) => {
              const Icon = option.icon;
              const selected = theme === option.id;
              return (
                <button key={option.id} type="button" className={selected ? 'selected' : ''} aria-pressed={selected} onClick={() => setTheme(option.id)}>
                  <Icon size={15} /><span>{option.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="account-chip">
          {user?.provider === 'supabase' && <Link className="account-gymbros-link-v9" to="/gymbros" title="Gymbros" aria-label="Abrir Gymbros"><UsersRound size={16}/></Link>}
          <Link className="account-profile-link-v9" to="/profile" title="Abrir perfil">
            <UserRound size={16}/><span>{user?.name ?? 'Invitado'}</span>
            {user?.provider === 'supabase' && <i className="cloud-dot-v9" title="Cuenta cloud" />}
          </Link>
          <button type="button" onClick={() => { void logout(); }} aria-label="Cerrar sesión"><LogOut size={16}/></button>
        </div>
      </div>
    </header>
  );
}
