export interface AppExercise {
  id: string;
  name: string;
  bodyPart: string;
  equipment: string;
  target: string;
  muscleGroup: string;
  secondaryMuscles: string[];
  instructionsEs: string;
  instructionStepsEs: string[];
  image: string;
  gifUrl: string;
  attribution: string;
}

export interface ExerciseFilters {
  equipment: string[];
  bodyPart: string[];
  target: string[];
}

export type DiceLevel = 'amateur' | 'beginner' | 'intermediate' | 'advanced';

export interface DiceLevelConfig {
  id: DiceLevel;
  label: string;
  shortLabel: string;
  sides: number;
  minimum: number;
  maximum: number;
}

export interface RollRecord {
  id: string;
  exerciseId: string;
  exerciseName: string;
  reps: number;
  timestamp: number;
  diceLevel?: DiceLevel;
}

export interface EvidenceRecord {
  id: string;
  rollId: string;
  exerciseId: string;
  exerciseName: string;
  reps: number;
  kind: 'image' | 'video';
  fileName: string;
  mimeType: string;
  size: number;
  blob: Blob;
  createdAt: number;
}
