import { describe, expect, it } from 'vitest';
import { formatSponsoredGoal } from './sponsoredGoals';

describe('V13.4.1 sponsored goal grammar', () => {
  it('uses singular time units', () => {
    expect(formatSponsoredGoal({ type: 'time', value: 1, unit: 'minutes' })).toBe('1 minuto');
    expect(formatSponsoredGoal({ type: 'time', value: 1, unit: 'hours' })).toBe('1 hora');
  });

  it('keeps plural units and invariant km', () => {
    expect(formatSponsoredGoal({ type: 'time', value: 2, unit: 'minutes' })).toBe('2 minutos');
    expect(formatSponsoredGoal({ type: 'distance', value: 20, unit: 'km' })).toBe('20 km');
  });

  it('uses singular repetitions and quantities', () => {
    expect(formatSponsoredGoal({ type: 'repetitions', value: 1, unit: 'reps' })).toBe('1 repetición');
    expect(formatSponsoredGoal({ type: 'quantity', value: 1, unit: 'steps' })).toBe('1 paso');
    expect(formatSponsoredGoal({ type: 'quantity', value: 1, unit: 'times' })).toBe('1 vez');
  });
});
