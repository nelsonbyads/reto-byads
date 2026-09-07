import { describe, expect, it } from 'vitest';
import { getWorkspaceNavigation, workspaceCanAccessPath } from './workspaceNavigation';

const destinations = (kind: 'personal' | 'gym' | 'brand', role: 'owner' | 'admin' | 'coach' | 'member' | null) =>
  getWorkspaceNavigation(kind, role).map((item) => item.to);

describe('workspace navigation audit', () => {
  it('keeps every visible navigation item inside the workspace route contract', () => {
    for (const [kind, role] of [
      ['personal', null],
      ['gym', 'owner'],
      ['gym', 'admin'],
      ['gym', 'coach'],
      ['gym', 'member'],
      ['brand', 'owner'],
      ['brand', 'admin'],
      ['brand', 'member'],
    ] as const) {
      for (const item of getWorkspaceNavigation(kind, role)) {
        expect(workspaceCanAccessPath(kind, item.to), `${kind}/${role ?? 'personal'} -> ${item.to}`).toBe(true);
      }
    }
  });

  it('gives Gym managers a direct path to institutional training and seasons', () => {
    const owner = destinations('gym', 'owner');
    expect(owner).toContain('/app');
    expect(owner).toContain('/seasons');
  });

  it('does not send Gym members or coaches to reward administration without permission', () => {
    expect(destinations('gym', 'member')).not.toContain('/rewards/manage');
    expect(destinations('gym', 'coach')).not.toContain('/rewards/manage');
  });

  it('exposes sponsored Gym competitions from the Brand navigation', () => {
    expect(destinations('brand', 'owner')).toContain('/brand-competitions');
    expect(destinations('brand', 'member')).toContain('/brand-competitions');
  });

  it('hides management-only Brand tools from ordinary members', () => {
    const member = destinations('brand', 'member');
    expect(member).not.toContain('/rewards/manage');
    expect(member).not.toContain('/brand-audit');
  });
});
