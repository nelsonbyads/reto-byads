import { Building2, ChevronDown, Dice5, Gift, LifeBuoy, LogOut, Moon, MoreHorizontal, Palette, Shield, ShieldCheck, Sparkles, Sun, Swords, Tag, Trophy, UserRound, UsersRound, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useWorkspace } from '../context/WorkspaceContext';
import { usePlatformAdminStatus } from '../hooks/usePlatformAdminStatus';
import { NotificationBell } from './NotificationBell';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';
import { WorkspaceActionLink } from './WorkspaceActionLink';
import { getWorkspaceNavigation, type WorkspaceNavIcon } from '../lib/workspaceNavigation';

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
  const isPlatformAdmin = usePlatformAdminStatus();
  const location = useLocation();
  const [theme, setTheme] = useState<DadoFitTheme>(readInitialTheme);
  const [themeOpen, setThemeOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  useEffect(() => {
    document.documentElement.dataset.dadofitTheme = theme;
    try { localStorage.setItem(THEME_KEY, theme); } catch { /* ignore */ }
  }, [theme]);

  useEffect(() => { setMoreOpen(false); }, [location.pathname]);

  const cloud = user?.provider === 'supabase';
  const personal = activeWorkspace.kind === 'personal';
  const gym = activeWorkspace.kind === 'gym';
  const ThemeIcon = theme === 'dark' ? Moon : theme === 'pastel' ? Palette : Sun;
  const iconMap: Record<WorkspaceNavIcon, typeof Palette> = {
    building: Building2,
    dice: Dice5,
    gift: Gift,
    shield: Shield,
    sparkles: Sparkles,
    swords: Swords,
    tag: Tag,
    trophy: Trophy,
    users: UsersRound,
  };

  const navItems = useMemo(() => getWorkspaceNavigation(activeWorkspace.kind, activeWorkspace.role), [activeWorkspace.kind, activeWorkspace.role]);
  const directItems = navItems.filter((item) => item.tier === 'primary');
  const secondaryItems = navItems.filter((item) => item.tier === 'secondary');
  const secondaryActive = secondaryItems.some((item) => location.pathname === item.to || location.pathname.startsWith(`${item.to}/`));

  return <header className="topbar topbar-v7 topbar-v122 topbar-v133 topbar-v151" data-workspace-kind={activeWorkspace.kind}>
    <div className="topbar-brand">
      <Link className="brand-home-v133" to={personal ? '/app' : '/workspace'} aria-label="Ir al inicio de DadoFit">
        <div className="brand-mark brand-mark-v7"><Dice5 size={20}/></div>
        <div className="brand-copy-v7"><strong>DadoFit</strong><span>{personal ? 'Entrena. Lanza. Repite.' : gym ? 'Opera. Reta. Compite.' : 'Activa. Patrocina. Mide.'}</span></div>
      </Link>
    </div>

    <nav className="app-nav-v133 app-nav-v151" aria-label="Navegación principal">
      {cloud && directItems.map((item) => {
        const Icon = iconMap[item.icon];
        return <NavLink key={item.to} to={item.to} className={({ isActive }) => `${isActive ? 'active ' : ''}nav-primary-v151`.trim()}><Icon size={15}/><span>{item.label}</span></NavLink>;
      })}
      {cloud && secondaryItems.length > 0 && <div className="nav-more-wrap-v151">
        <button type="button" className={`nav-more-trigger-v151 ${secondaryActive ? 'active' : ''}`} onClick={() => { setMoreOpen((value) => !value); setThemeOpen(false); setUserOpen(false); }} aria-expanded={moreOpen}><MoreHorizontal size={16}/><span>Más</span><ChevronDown size={12}/></button>
        {moreOpen && <div className="nav-more-menu-v151">{secondaryItems.map((item) => { const Icon = iconMap[item.icon]; return <NavLink key={item.to} to={item.to} onClick={() => setMoreOpen(false)}><Icon size={16}/><span>{item.label}</span></NavLink>; })}</div>}
      </div>}
    </nav>

    <div className="header-tools-v133 header-tools-v151">
      <WorkspaceSwitcher/>
      {cloud && <div className="header-icon-slot-v133"><NotificationBell/></div>}
      <div className="header-popover-v133">
        <button type="button" className="header-tool-v133" onClick={() => { setThemeOpen((v) => !v); setUserOpen(false); setMoreOpen(false); }} aria-label="Cambiar apariencia" aria-expanded={themeOpen}><ThemeIcon size={17}/></button>
        {themeOpen && <div className="header-menu-v133 theme-menu-v133"><div className="header-menu-title-v133"><span>Apariencia</span><button type="button" onClick={() => setThemeOpen(false)} aria-label="Cerrar"><X size={14}/></button></div>{THEME_OPTIONS.map((option) => { const Icon = option.icon; const selected = theme === option.id; return <button key={option.id} type="button" className={selected ? 'selected' : ''} onClick={() => { setTheme(option.id); setThemeOpen(false); }}><Icon size={16}/><span>{option.label}</span>{selected && <i/>}</button>; })}</div>}
      </div>
      <div className="header-popover-v133">
        <button type="button" className="user-trigger-v133" onClick={() => { setUserOpen((v) => !v); setThemeOpen(false); setMoreOpen(false); }} aria-expanded={userOpen}><span className="user-avatar-v133"><UserRound size={16}/></span><span className="user-trigger-copy-v133"><strong>{user?.name ?? 'Invitado'}</strong><small>{personal ? 'Perfil personal' : activeWorkspace.label}</small></span>{cloud && <i className="cloud-dot-v9" title="Cuenta cloud"/>}</button>
        {userOpen && <div className="header-menu-v133 user-menu-v133"><div className="user-menu-head-v133"><strong>{user?.name ?? 'Invitado'}</strong><span>{personal ? 'Perfil personal' : `${activeWorkspace.label} · ${activeWorkspace.role ?? 'member'}`}</span></div>{isPlatformAdmin && <Link to="/admin" onClick={() => setUserOpen(false)}><ShieldCheck size={16}/><span>Administración DadoFit</span></Link>}<WorkspaceActionLink to="/profile" workspaceId="personal" onClick={() => setUserOpen(false)}><UserRound size={16}/><span>Mi perfil</span></WorkspaceActionLink><Link to="/contact" onClick={() => setUserOpen(false)}><LifeBuoy size={16}/><span>Soporte / Contáctanos</span></Link><button type="button" className="logout-v133" onClick={() => { setUserOpen(false); void logout(); }}><LogOut size={16}/><span>Cerrar sesión</span></button></div>}
      </div>
    </div>
  </header>;
}
