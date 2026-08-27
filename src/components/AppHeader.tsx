import { Building2, Dice5, LogOut, Moon, Palette, Shield, Sun, Swords, Tag, Trophy, UserRound, UsersRound } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useWorkspace } from '../context/WorkspaceContext';
import { NotificationBell } from './NotificationBell';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';

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
  } catch { /* ignore */ }
  return 'light';
}

export function AppHeader() {
  const { user, logout } = useAuth();
  const { activeWorkspace } = useWorkspace();
  const [theme, setTheme] = useState<DadoFitTheme>(readInitialTheme);

  useEffect(() => {
    document.documentElement.dataset.dadofitTheme = theme;
    try { localStorage.setItem(THEME_KEY, theme); } catch { /* ignore */ }
  }, [theme]);

  const cloud = user?.provider === 'supabase';
  const personal = activeWorkspace.kind === 'personal';
  const gym = activeWorkspace.kind === 'gym';
  const brand = activeWorkspace.kind === 'brand';

  return (
    <header className="topbar topbar-v7 topbar-v122">
      <div className="topbar-brand">
        <div className="brand-mark brand-mark-v7"><Dice5 size={20}/></div>
        <div className="brand-copy-v7"><strong>DadoFit</strong><span>{personal ? 'Entrena. Lanza. Repite.' : gym ? 'Opera. Reta. Compite.' : 'Activa. Patrocina. Mide.'}</span><small>{personal ? 'PERFIL PERSONAL' : gym ? 'WORKSPACE GYM' : 'WORKSPACE MARCA'}</small></div>
      </div>

      <div className="topbar-actions-v7">
        <WorkspaceSwitcher/>
        <div className="theme-picker-v7" role="group" aria-label="Tema de la aplicación">
          <span className="theme-picker-label-v7">TEMA</span>
          <div className="theme-segments-v7">{THEME_OPTIONS.map((option) => { const Icon = option.icon; const selected = theme === option.id; return <button key={option.id} type="button" className={selected ? 'selected' : ''} aria-pressed={selected} onClick={() => setTheme(option.id)}><Icon size={15}/><span>{option.label}</span></button>; })}</div>
        </div>

        <div className="account-chip">
          <NotificationBell/>
          {cloud && personal && <Link to="/squads" title="Squads" aria-label="Abrir Squads"><Shield size={16}/></Link>}
          {cloud && personal && <Link to="/challenges" title="Retos 1v1" aria-label="Abrir Retos"><Swords size={16}/></Link>}
          {cloud && personal && <Link to="/gymbros" title="Gymbros" aria-label="Abrir Gymbros"><UsersRound size={16}/></Link>}

          {cloud && gym && <Link to="/app" title="Generar reto con dados" aria-label="Generar reto"><Dice5 size={16}/></Link>}
          {cloud && gym && <Link to="/organization-challenges" title="Retos del Gym" aria-label="Retos del Gym"><Swords size={16}/></Link>}
          {cloud && gym && <Link to="/gym-battles" title="Gym vs Gym" aria-label="Gym vs Gym"><Trophy size={16}/></Link>}
          {cloud && gym && <Link to="/organizations" title="Administrar Gym" aria-label="Administrar Gym"><Building2 size={16}/></Link>}

          {cloud && brand && <Link to="/workspace" title="Dashboard Marca" aria-label="Dashboard Marca"><Tag size={16}/></Link>}
          {cloud && brand && <Link to="/organizations" title="Administrar Marca" aria-label="Administrar Marca"><Building2 size={16}/></Link>}

          <Link className="account-profile-link-v9" to="/profile" title="Abrir perfil"><UserRound size={16}/><span>{user?.name ?? 'Invitado'}</span>{cloud && <i className="cloud-dot-v9" title="Cuenta cloud"/>}</Link>
          <button type="button" onClick={() => { void logout(); }} aria-label="Cerrar sesión"><LogOut size={16}/></button>
        </div>
      </div>
    </header>
  );
}
