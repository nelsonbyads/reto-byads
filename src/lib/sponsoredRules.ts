export type OrganizationRole = 'owner' | 'admin' | 'coach' | 'member' | null;

export const SPONSORED_LIMITS = {
  maxCoinsPerApproval: 50,
  maxXpPerApproval: 100,
  maxRewardsPer24h: 3,
} as const;

export function canManageBrandRole(role: OrganizationRole): boolean {
  return role === 'owner' || role === 'admin';
}

export function clampSponsoredReward(value: number, max: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(max, Math.max(0, Math.floor(value)));
}
