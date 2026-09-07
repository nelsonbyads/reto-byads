import { Building2, Shield, Sparkles, Swords, Trophy } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { useWorkspace } from '../context/WorkspaceContext';

const items = [
  { to: '/challenges', label: '1 vs 1', icon: Swords },
  { to: '/organization-challenges', label: 'Del Gym', icon: Building2 },
  { to: '/squads', label: 'Squads', icon: Shield },
  { to: '/sponsored-challenges', label: 'Patrocinados', icon: Sparkles },
  { to: '/seasons', label: 'Temporadas', icon: Trophy },
] as const;

export function ChallengeCenterNav() {
  const { activeWorkspace } = useWorkspace();
  if (activeWorkspace.kind !== 'personal') return null;
  return <nav className="challenge-center-nav-v157" aria-label="Tipos de reto">
    {items.map(({ to, label, icon: Icon }) => <NavLink key={to} to={to} end={to === '/challenges'} className={({ isActive }) => isActive ? 'active' : ''}><Icon size={15}/><span>{label}</span></NavLink>)}
  </nav>;
}
