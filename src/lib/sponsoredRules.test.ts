import { describe, expect, it } from 'vitest';
import { canEditSponsorCampaign, canManageBrandRole, clampSponsoredReward, sponsoredChallengeEditMode, SPONSORED_LIMITS } from './sponsoredRules';

describe('canManageBrandRole', () => {
  it('allows owners', () => expect(canManageBrandRole('owner')).toBe(true));
  it('allows admins', () => expect(canManageBrandRole('admin')).toBe(true));
  it('does not grant campaign management to coaches', () => expect(canManageBrandRole('coach')).toBe(false));
  it('does not grant campaign management to members', () => expect(canManageBrandRole('member')).toBe(false));
});

describe('clampSponsoredReward', () => {
  it('never returns negative rewards', () => expect(clampSponsoredReward(-10, 50)).toBe(0));
  it('caps DC at the sponsored economy limit', () => expect(clampSponsoredReward(999, SPONSORED_LIMITS.maxCoinsPerApproval)).toBe(50));
  it('caps SP at the brand-scoped Sponsor Points limit', () => expect(clampSponsoredReward(9999, SPONSORED_LIMITS.maxSpPerApproval)).toBe(500));
});

describe('sponsored editing policy', () => {
  it('allows campaign editing before closure', () => {
    expect(canEditSponsorCampaign('draft')).toBe(true);
    expect(canEditSponsorCampaign('active')).toBe(true);
    expect(canEditSponsorCampaign('paused')).toBe(true);
  });

  it('locks completed and cancelled campaigns', () => {
    expect(canEditSponsorCampaign('completed')).toBe(false);
    expect(canEditSponsorCampaign('cancelled')).toBe(false);
  });

  it('allows full challenge editing before the first participant joins', () => {
    expect(sponsoredChallengeEditMode('active', 0)).toBe('full');
  });

  it('limits challenge editing after participation starts', () => {
    expect(sponsoredChallengeEditMode('active', 1)).toBe('limited');
    expect(sponsoredChallengeEditMode('completed', 0)).toBe('none');
  });
});
