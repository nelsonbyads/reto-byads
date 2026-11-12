import type { OrganizationRole, WorkspaceKind } from '../context/WorkspaceContext';

export type WorkspaceNavIcon = 'building' | 'dice' | 'gift' | 'shield' | 'sparkles' | 'swords' | 'tag' | 'trophy' | 'users';
export type WorkspaceNavTier = 'primary' | 'secondary';

export interface WorkspaceNavItem {
  to: string;
  label: string;
  icon: WorkspaceNavIcon;
  tier: WorkspaceNavTier;
  roles?: readonly OrganizationRole[];
}

const MANAGERS: readonly OrganizationRole[] = ['owner', 'admin'];
const GYM_CREATORS: readonly OrganizationRole[] = ['owner', 'admin', 'coach'];

export const CHALLENGE_NAVIGATION = [
  { to: '/challenges', label: '1 vs 1', icon: 'swords' },
  { to: '/organization-challenges', label: 'Del Gym', icon: 'building' },
  { to: '/squads', label: 'Squads', icon: 'shield' },
  { to: '/sponsored-challenges', label: 'Patrocinados', icon: 'sparkles' },
  { to: '/seasons', label: 'Temporadas', icon: 'trophy' },
] as const satisfies readonly Pick<WorkspaceNavItem, 'to' | 'label' | 'icon'>[];

const NAVIGATION: Record<WorkspaceKind, readonly WorkspaceNavItem[]> = {
  personal: [
    { to: '/app', label: 'Entrenar', icon: 'dice', tier: 'primary' },
    { ...CHALLENGE_NAVIGATION[0], label: 'Retos', tier: 'primary' },
    { to: '/rewards', label: 'Premios', icon: 'gift', tier: 'primary' },
    { to: '/gymbros', label: 'Gymbros', icon: 'users', tier: 'secondary' },
    { to: '/organizations', label: 'Organizaciones', icon: 'building', tier: 'secondary' },
  ],
  gym: [
    { to: '/workspace', label: 'Dashboard', icon: 'trophy', tier: 'primary' },
    { to: '/app', label: 'Entrenar', icon: 'dice', tier: 'primary', roles: GYM_CREATORS },
    { to: '/organization-challenges', label: 'Retos', icon: 'swords', tier: 'primary' },
    { to: '/rewards/manage', label: 'Ofertas', icon: 'gift', tier: 'primary', roles: MANAGERS },
    { to: '/gym-battles', label: 'Gym vs Gym', icon: 'trophy', tier: 'secondary' },
    { to: '/seasons', label: 'Temporadas', icon: 'trophy', tier: 'secondary' },
    { to: '/organizations', label: 'Equipo', icon: 'building', tier: 'secondary' },
  ],
  brand: [
    { to: '/workspace', label: 'Dashboard', icon: 'tag', tier: 'primary' },
    { to: '/rewards/manage', label: 'Ofertas', icon: 'gift', tier: 'primary', roles: MANAGERS },
    { to: '/brand-campaigns', label: 'Campañas', icon: 'sparkles', tier: 'primary' },
    { to: '/brand-competitions', label: 'Competencias', icon: 'trophy', tier: 'primary' },
    { to: '/brand-audit', label: 'Control', icon: 'shield', tier: 'secondary', roles: MANAGERS },
    { to: '/organizations', label: 'Equipo', icon: 'building', tier: 'secondary' },
  ],
};

export const WORKSPACE_ROUTE_ACCESS: Record<string, readonly WorkspaceKind[]> = {
  '/app': ['personal', 'gym'],
  '/workspace': ['gym', 'brand'],
  '/gymbros': ['personal'],
  '/challenges': ['personal'],
  '/squads': ['personal'],
  '/sponsored-challenges': ['personal'],
  '/seasons': ['personal', 'gym'],
  '/rewards': ['personal'],
  '/rewards/manage': ['gym', 'brand'],
  '/rewards/analytics': ['gym', 'brand'],
  '/rewards/validate': ['gym', 'brand'],
  '/organizations': ['personal', 'gym', 'brand'],
  '/organization-challenges': ['personal', 'gym'],
  '/gym-battles': ['gym'],
  '/brand-campaigns': ['brand'],
  '/brand-competitions': ['brand'],
  '/brand-audit': ['brand'],
};

export function getWorkspaceNavigation(kind: WorkspaceKind, role: OrganizationRole | null): WorkspaceNavItem[] {
  return NAVIGATION[kind].filter((item) => !item.roles || (role !== null && item.roles.includes(role)));
}

export function workspaceCanAccessPath(kind: WorkspaceKind, path: string): boolean {
  const allow = WORKSPACE_ROUTE_ACCESS[path];
  return !allow || allow.includes(kind);
}
