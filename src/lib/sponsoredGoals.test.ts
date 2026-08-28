import { describe, expect, it } from 'vitest';
import { defaultGoalUnit, formatSponsoredGoal, readSponsoredGoal } from './sponsoredGoals';

describe('sponsored goals', () => {
  it('formats distance challenges', () => expect(formatSponsoredGoal({ type: 'distance', value: 20, unit: 'km' })).toBe('20 km'));
  it('formats time challenges', () => expect(formatSponsoredGoal({ type: 'time', value: 30, unit: 'minutes' })).toBe('30 minutos'));
  it('formats quantity challenges', () => expect(formatSponsoredGoal({ type: 'quantity', value: 10000, unit: 'steps' })).toBe('10.000 pasos'));
  it('keeps repetitions compatible with old challenges', () => expect(readSponsoredGoal(null, 25)).toEqual({ type: 'repetitions', value: 25, unit: 'reps' }));
  it('reads goal metadata', () => expect(readSponsoredGoal({ goal_type: 'distance', goal_value: 5.5, goal_unit: 'km' }, 1)).toEqual({ type: 'distance', value: 5.5, unit: 'km' }));
  it('returns the default unit for each type', () => expect(defaultGoalUnit('time')).toBe('minutes'));
});
