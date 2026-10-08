import { Building2, Shield, Sparkles, Swords, Trophy } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { useWorkspace } from '../context/WorkspaceContext';
import { CHALLENGE_NAVIGATION, type WorkspaceNavIcon } from '../lib/workspaceNavigation';

const icons: Record<WorkspaceNavIcon, typeof Swords> = {
  building: Building2, dice: Swords, gift: Swords, shield: Shield,
  sparkles: Sparkles, swords: Swords, tag: Swords, trophy: Trophy, users: Swords,
};

export function ChallengeCenterNav() {
  const { activeWorkspace } = useWorkspace();
  if (activeWorkspace.kind !== 'personal') return null;
  return <nav className="challenge-center-nav-v157" aria-label="Tipos de reto">
    {CHALLENGE_NAVIGATION.map(({ to, label, icon }) => { const Icon = icons[icon]; return <NavLink key={to} to={to} end={to === '/challenges'} className={({ isActive }) => isActive ? 'active' : ''}><Icon size={15}/><span>{label}</span></NavLink>; })}
  </nav>;
}
