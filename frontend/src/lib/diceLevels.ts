import type { DiceLevel, DiceLevelConfig } from '../types/exercise';

export const DICE_LEVELS: DiceLevelConfig[] = [
  { id: 'amateur', label: 'Amateur', shortLabel: 'D20', sides: 20, minimum: 9, maximum: 20 },
  { id: 'beginner', label: 'Principiante', shortLabel: 'D30', sides: 30, minimum: 11, maximum: 30 },
  { id: 'intermediate', label: 'Intermedio', shortLabel: 'D50', sides: 50, minimum: 16, maximum: 50 },
  { id: 'advanced', label: 'Avanzado', shortLabel: 'D100', sides: 100, minimum: 21, maximum: 100 },
];

export function getDiceLevel(level: DiceLevel): DiceLevelConfig {
  return DICE_LEVELS.find((item) => item.id === level) ?? DICE_LEVELS[0];
}
