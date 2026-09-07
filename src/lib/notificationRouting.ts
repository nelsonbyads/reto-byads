import type { WorkspaceOption } from '../context/WorkspaceContext';

export interface RoutableNotification {
  notification_type: string;
  data: Record<string, unknown> | null;
}

function dataString(item: RoutableNotification, key: string): string | null {
  const value = item.data?.[key];
  return typeof value === 'string' && value ? value : null;
}

function safeRoute(item: RoutableNotification): string | null {
  const route = dataString(item, 'route');
  return route && route.startsWith('/') && !route.startsWith('//') ? route : null;
}

export function notificationTarget(item: RoutableNotification): string {
  const explicit = safeRoute(item);
  if (explicit) return explicit;

  const type = item.notification_type;
  if (type === 'sponsored_audit_required') return '/brand-audit';
  if (type === 'sponsored_evidence_submitted') return '/brand-campaigns';
  if (type === 'sponsored_gym_competition_response') return '/brand-competitions';
  if (type.startsWith('sponsored_gym_competition_')) return '/seasons';
  if (type === 'gym_reward_published' || type.startsWith('reward_')) return '/rewards';
  if (type.startsWith('sponsored_')) return '/sponsored-challenges';
  if (type.startsWith('gym_battle_') || item.data?.organization_battle_id) return '/gym-battles';
  if (type.startsWith('organization_challenge_')) return '/organization-challenges';
  if (type.startsWith('organization_') || item.data?.organization_id) return '/organizations';
  if (type.startsWith('squad_') || item.data?.battle_id || item.data?.group_id) return '/squads';
  if (type.startsWith('challenge_') || item.data?.challenge_id) return '/challenges';
  if (type.startsWith('friend')) return '/gymbros';
  return '/profile';
}

function orgWorkspaceId(organizationId: string | null): string | null {
  return organizationId ? `org:${organizationId}` : null;
}

export function notificationWorkspaceId(item: RoutableNotification, workspaces: readonly WorkspaceOption[]): string | null {
  const type = item.notification_type;

  if (type === 'sponsored_evidence_submitted' || type === 'sponsored_audit_required') {
    return orgWorkspaceId(dataString(item, 'organization_id'));
  }
  if (type === 'sponsored_gym_competition_response') {
    return orgWorkspaceId(dataString(item, 'sponsor_organization_id'));
  }
  if (type.startsWith('sponsored_gym_competition_')) {
    return orgWorkspaceId(dataString(item, 'organization_id'));
  }
  if (type.startsWith('organization_challenge_')) {
    return orgWorkspaceId(dataString(item, 'organization_id')) ?? workspaces.find((workspace) => workspace.kind === 'gym')?.id ?? null;
  }
  if (type.startsWith('gym_battle_') || item.data?.organization_battle_id) {
    return orgWorkspaceId(
      dataString(item, 'organization_id') ??
      dataString(item, 'challenged_organization_id') ??
      dataString(item, 'challenger_organization_id')
    ) ?? workspaces.find((workspace) => workspace.kind === 'gym')?.id ?? null;
  }
  if (
    type === 'gym_reward_published' ||
    type.startsWith('reward_') ||
    type.startsWith('sponsored_') ||
    type.startsWith('squad_') ||
    type.startsWith('challenge_') ||
    type.startsWith('friend')
  ) return 'personal';

  return null;
}
