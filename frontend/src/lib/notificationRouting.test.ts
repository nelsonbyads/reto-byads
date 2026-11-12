import { describe, expect, it } from 'vitest';
import { notificationTarget, notificationWorkspaceId } from './notificationRouting';
import type { WorkspaceOption } from '../context/WorkspaceContext';

const workspaces: WorkspaceOption[] = [
  { id: 'personal', kind: 'personal', label: 'Mi perfil', organizationId: null, organizationType: null, role: null, verificationStatus: null },
  { id: 'org:gym-1', kind: 'gym', label: 'Titanes', organizationId: 'gym-1', organizationType: 'gym', role: 'owner', verificationStatus: 'verified' },
  { id: 'org:brand-1', kind: 'brand', label: 'Nike', organizationId: 'brand-1', organizationType: 'brand', role: 'owner', verificationStatus: 'verified' },
];

describe('notification routing audit', () => {
  it('routes audit notifications to Brand governance in the Brand workspace', () => {
    const item = { notification_type: 'sponsored_audit_required', data: { organization_id: 'brand-1' } };
    expect(notificationTarget(item)).toBe('/brand-audit');
    expect(notificationWorkspaceId(item, workspaces)).toBe('org:brand-1');
  });

  it('routes sponsored Gym invitations to seasons in the invited Gym workspace', () => {
    const item = { notification_type: 'sponsored_gym_competition_invited', data: { organization_id: 'gym-1', route: '/seasons' } };
    expect(notificationTarget(item)).toBe('/seasons');
    expect(notificationWorkspaceId(item, workspaces)).toBe('org:gym-1');
  });

  it('routes reward lifecycle notifications to the personal marketplace', () => {
    const item = { notification_type: 'reward_fulfilled', data: { reward_id: 'r1' } };
    expect(notificationTarget(item)).toBe('/rewards');
    expect(notificationWorkspaceId(item, workspaces)).toBe('personal');
  });

  it('can recover legacy Gym battle notifications without an organization id', () => {
    const item = { notification_type: 'gym_battle_declined', data: { organization_battle_id: 'battle-1' } };
    expect(notificationTarget(item)).toBe('/gym-battles');
    expect(notificationWorkspaceId(item, workspaces)).toBe('org:gym-1');
  });
});
