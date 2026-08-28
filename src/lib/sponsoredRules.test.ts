import { describe, expect, it } from 'vitest';
import { canManageBrandRole, clampSponsoredReward, SPONSORED_LIMITS } from './sponsoredRules';

describe('canManageBrandRole', () => {
  it('allows owners', () => expect(canManageBrandRole('owner')).toBe(true));
  it('allows admins', () => expect(canManageBrandRole('admin')).toBe(true));
  it('does not grant campaign management to coaches', () => expect(canManageBrandRole('coach')).toBe(false));
  it('does not grant campaign management to members', () => expect(canManageBrandRole('member')).toBe(false));
});

describe('clampSponsoredReward', () => {
  it('never returns negative rewards', () => expect(clampSponsoredReward(-10, 50)).toBe(0));
  it('caps rewards at the sponsored economy limit', () => expect(clampSponsoredReward(999, SPONSORED_LIMITS.maxCoinsPerApproval)).toBe(50));
});
