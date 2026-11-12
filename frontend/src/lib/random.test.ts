import { describe, expect, it } from 'vitest';
import { pickRandomExercise, rollReps } from './random';
import type { AppExercise } from '../types/exercise';

const makeExercise = (id: string): AppExercise => ({
  id, name: `Exercise ${id}`, bodyPart: 'chest', equipment: 'body weight', target: 'pectorals',
  muscleGroup: 'chest', secondaryMuscles: [], instructionsEs: '', instructionStepsEs: [],
  image: '/images/test.jpg', gifUrl: '/videos/test.gif', attribution: 'test',
});

const ranges = [
  [9, 20],
  [11, 30],
  [16, 50],
  [21, 100],
] as const;

describe('rollReps', () => {
  for (const [minimum, maximum] of ranges) {
    it(`returns integers between ${minimum} and ${maximum}`, () => {
      for (let index = 0; index < 1000; index += 1) {
        const value = rollReps(minimum, maximum);
        expect(Number.isInteger(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(minimum);
        expect(value).toBeLessThanOrEqual(maximum);
      }
    });
  }
});

describe('pickRandomExercise', () => {
  it('returns the only exercise when there is one', () => {
    const only = makeExercise('1');
    expect(pickRandomExercise([only])).toBe(only);
  });
  it('avoids the previous exercise when alternatives exist', () => {
    const list = [makeExercise('1'), makeExercise('2')];
    for (let i = 0; i < 20; i += 1) expect(pickRandomExercise(list, '1').id).toBe('2');
  });
  it('does not modify the input array', () => {
    const list = [makeExercise('1'), makeExercise('2'), makeExercise('3')];
    const before = [...list];
    pickRandomExercise(list, '1');
    expect(list).toEqual(before);
  });
  it('throws on an empty pool', () => {
    expect(() => pickRandomExercise([])).toThrow('No exercises available');
  });
});
