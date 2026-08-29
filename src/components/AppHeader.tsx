import { Building2, Dice5, LogOut, Moon, Palette, Shield, Sparkles, Sun, Swords, Tag, Trophy, UserRound, UsersRound, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useWorkspace } from '../context/WorkspaceContext';
import { canManageBrandRole } from '../lib/sponsoredRules';
import { NotificationBell } from './NotificationBell';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';

type DadoFitTheme = 'pastel' | 'light' | 'dark';
const THEME_KEY = 'dadofit:theme:v7';
const THEME_OPTIONS: Array<{ id: DadoFitTheme; label: string; icon: typeof Palette }> = [
  { id: 'pastel', label: 'Pastel', icon: Palette },
  { id: 'light', label: 'Claro', icon: Sun },
  { id: 'dark', label: 'Oscuro', icon: Moon },
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
  const [themeOpen, setThemeOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);

  useEffect(() => {
    document.documentElement.dataset.dadofitTheme = theme;
    try { localStorage.setItem(THEME_KEY, theme); } catch { /* ignore */ }
  }, [theme]);

  const cloud = user?.provider === 'supabase';
  const personal = activeWorkspace.kind === 'personal';
  const gym = activeWorkspace.kind === 'gym';
  const brand = activeWorkspace.kind === 'brand';
  const brandManager = canManageBrandRole(activeWorkspace.role);
  const ThemeIcon = theme === 'dark' ? Moon : theme === 'pastel' ? Palette : Sun;

  const navItems = personal
    ? [
        { to: '/app', label: 'Entrenar', icon: Dice5 },
        { to: '/challenges', label: 'Retos', icon: Swords },
        { to: '/gymbros', label: 'Gymbros', icon: UsersRound },
        { to: '/squads', label: 'Squads', icon: Shield },
        { to: '/organizations', label: 'Organizaciones', icon: Building2 },
        { to: '/sponsored-challenges', label: 'Patrocinados', icon: Sparkles },
      ]
    : gym
      ? [
          { to: '/workspace', label: 'Dashboard', icon: Trophy },
          { to: '/organization-challenges', label: 'Retos', icon: Swords },
          { to: '/gym-battles', label: 'Gym vs Gym', icon: Trophy },
          { to: '/organizations', label: 'Equipo', icon: Building2 },
        ]
      : [
          { to: '/workspace', label: 'Dashboard', icon: Tag },
          { to: '/brand-campaigns', label: 'Campañas', icon: Sparkles },
          ...(brandManager ? [{ to: '/brand-audit', label: 'Control', icon: Shield }] : []),
          { to: '/organizations', label: 'Equipo', icon: Building2 },
        ];

  return (
    <header className="topbar topbar-v7 topbar-v122 topbar-v133" data-workspace-kind={activeWorkspace.kind}>
      <div className="topbar-brand">
        <Link className="brand-home-v133" to={personal ? '/app' : '/workspace'} aria-label="Ir al inicio de DadoFit">
          <div className="brand-mark brand-mark-v7"><Dice5 size={20}/></div>
          <div className="brand-copy-v7">
            <strong>DadoFit</strong>
            <span>{personal ? 'Entrena. Lanza. Repite.' : gym ? 'Opera. Reta. Compite.' : 'Activa. Patrocina. Mide.'}</span>
          </div>
        </Link>
      </div>

      <nav className="app-nav-v133" aria-label="Navegación principal">
        {cloud && navItems.map((item) => {
          const Icon = item.icon;
          return <NavLink key={item.to} to={item.to} className={({ isActive }) => isActive ? 'active' : ''}><Icon size={15}/><span>{item.label}</span></NavLink>;
        })}
      </nav>

      <div className="header-tools-v133">
        <WorkspaceSwitcher/>
        {cloud && <div className="header-icon-slot-v133"><NotificationBell/></div>}

        <div className="header-popover-v133">
          <button type="button" className="header-tool-v133" onClick={() => { setThemeOpen((value) => !value); setUserOpen(false); }} aria-label="Cambiar apariencia" aria-expanded={themeOpen}>
            <ThemeIcon size={17}/>
          </button>
          {themeOpen && <div className="header-menu-v133 theme-menu-v133">
            <div className="header-menu-title-v133"><span>Apariencia</span><button type="button" onClick={() => setThemeOpen(false)} aria-label="Cerrar"><X size={14}/></button></div>
            {THEME_OPTIONS.map((option) => { const Icon = option.icon; const selected = theme === option.id; return <button key={option.id} type="button" className={selected ? 'selected' : ''} onClick={() => { setTheme(option.id); setThemeOpen(false); }}><Icon size={16}/><span>{option.label}</span>{selected && <i/>}</button>; })}
          </div>}
        </div>

        <div className="header-popover-v133">
          <button type="button" className="user-trigger-v133" onClick={() => { setUserOpen((value) => !value); setThemeOpen(false); }} aria-expanded={userOpen}>
            <span className="user-avatar-v133"><UserRound size={16}/></span>
            <span className="user-trigger-copy-v133"><strong>{user?.name ?? 'Invitado'}</strong><small>{personal ? 'Perfil personal' : activeWorkspace.label}</small></span>
            {cloud && <i className="cloud-dot-v9" title="Cuenta cloud"/>}
          </button>
          {userOpen && <div className="header-menu-v133 user-menu-v133">
            <div className="user-menu-head-v133"><strong>{user?.name ?? 'Invitado'}</strong><span>{personal ? 'Perfil personal' : `${activeWorkspace.label} · ${activeWorkspace.role ?? 'member'}`}</span></div>
            <Link to="/profile" onClick={() => setUserOpen(false)}><UserRound size={16}/><span>Mi perfil</span></Link>
            <button type="button" className="logout-v133" onClick={() => { setUserOpen(false); void logout(); }}><LogOut size={16}/><span>Cerrar sesión</span></button>
          </div>}
        </div>
      </div>
    </header>
  );
}
