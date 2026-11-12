import type { AppExercise, ExerciseFilters } from '../types/exercise';

export const EMPTY_FILTERS: ExerciseFilters = { equipment: [], bodyPart: [], target: [] };

function matchesAny(value: string, selected: string[]): boolean {
  return selected.length === 0 || selected.includes(value);
}

export function filterExercises(exercises: AppExercise[], filters: ExerciseFilters): AppExercise[] {
  return exercises.filter((exercise) =>
    matchesAny(exercise.equipment, filters.equipment) &&
    matchesAny(exercise.bodyPart, filters.bodyPart) &&
    matchesAny(exercise.target, filters.target),
  );
}

export function countActiveFilters(filters: ExerciseFilters): number {
  return filters.equipment.length + filters.bodyPart.length + filters.target.length;
}
