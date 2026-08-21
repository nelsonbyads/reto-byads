import type { AppExercise } from '../types/exercise';

export function secureRandomInt(min: number, max: number): number {
  if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) {
    throw new RangeError('Invalid integer range');
  }
  const range = max - min + 1;
  const maxUint = 0x100000000;
  const limit = maxUint - (maxUint % range);

  if (globalThis.crypto?.getRandomValues) {
    const buffer = new Uint32Array(1);
    do {
      globalThis.crypto.getRandomValues(buffer);
    } while (buffer[0] >= limit);
    return min + (buffer[0] % range);
  }

  return min + Math.floor(Math.random() * range);
}

export function rollReps(minimum: number, maximum: number): number {
  return secureRandomInt(minimum, maximum);
}

export function rollD20(): number {
  return rollReps(9, 20);
}

export function pickRandomExercise(
  exercises: AppExercise[],
  previousExerciseId?: string,
): AppExercise {
  if (exercises.length === 0) throw new Error('No exercises available');
  if (exercises.length === 1) return exercises[0];

  const candidates = previousExerciseId
    ? exercises.filter((exercise) => exercise.id !== previousExerciseId)
    : exercises;
  const pool = candidates.length > 0 ? candidates : exercises;
  return pool[secureRandomInt(0, pool.length - 1)];
}
