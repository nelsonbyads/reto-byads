import { describe, expect, it } from 'vitest';
import { filterExercises } from './filters';
import type { AppExercise } from '../types/exercise';

const base = (id: string, equipment: string, bodyPart: string, target: string): AppExercise => ({
  id, name: id, equipment, bodyPart, target, muscleGroup: '', secondaryMuscles: [], instructionsEs: '', instructionStepsEs: [], image: '', gifUrl: '', attribution: '',
});
const exercises = [
  base('1','body weight','chest','pectorals'),
  base('2','dumbbell','upper arms','biceps'),
  base('3','body weight','upper legs','quads'),
  base('4','barbell','upper arms','triceps'),
];

describe('filterExercises', () => {
  it('returns all without filters', () => expect(filterExercises(exercises,{equipment:[],bodyPart:[],target:[]})).toHaveLength(4));
  it('uses OR inside equipment', () => expect(filterExercises(exercises,{equipment:['dumbbell','barbell'],bodyPart:[],target:[]})).toHaveLength(2));
  it('uses OR inside bodyPart', () => expect(filterExercises(exercises,{equipment:[],bodyPart:['chest','upper legs'],target:[]})).toHaveLength(2));
  it('uses OR inside target', () => expect(filterExercises(exercises,{equipment:[],bodyPart:[],target:['biceps','triceps']})).toHaveLength(2));
  it('uses AND across categories', () => expect(filterExercises(exercises,{equipment:['body weight'],bodyPart:['chest'],target:['pectorals']})[0].id).toBe('1'));
  it('returns empty when no result matches', () => expect(filterExercises(exercises,{equipment:['barbell'],bodyPart:['chest'],target:[]})).toEqual([]));
});
