export type OrganizationRole = 'owner' | 'admin' | 'coach' | 'member' | null;

export const SPONSORED_LIMITS = {
  maxCoinsPerApproval: 50,
  maxXpPerApproval: 100,
  maxSpPerApproval: 500,
  maxRewardsPer24h: 3,
} as const;

export function canManageBrandRole(role: OrganizationRole): boolean {
  return role === 'owner' || role === 'admin';
}

export function clampSponsoredReward(value: number, max: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(max, Math.max(0, Math.floor(value)));
}

export type SponsoredChallengeEditMode = 'full' | 'limited' | 'none';

export function canEditSponsorCampaign(status: string): boolean {
  return status === 'draft' || status === 'active' || status === 'paused';
}

export function sponsoredChallengeEditMode(status: string, participantCount: number): SponsoredChallengeEditMode {
  if (status !== 'active') return 'none';
  return participantCount > 0 ? 'limited' : 'full';
}
