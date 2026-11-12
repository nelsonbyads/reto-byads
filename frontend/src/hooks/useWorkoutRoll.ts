import { useCallback, useState } from 'react';
import { pickRandomExercise, rollReps, secureRandomInt } from '../lib/random';
import type { AppExercise, DiceLevelConfig, RollRecord } from '../types/exercise';
import { usePersistentState } from './usePersistentState';

export function useWorkoutRoll(exercises: AppExercise[], dice: DiceLevelConfig) {
  const [reps, setReps] = usePersistentState('dadofit:lastReps', dice.minimum);
  const [exercise, setExercise] = usePersistentState<AppExercise | null>('dadofit:lastExercise', null);
  const [history, setHistory] = usePersistentState<RollRecord[]>('dadofit:history', []);
  const [currentRollId, setCurrentRollId] = usePersistentState('dadofit:currentRollId:v2', '');
  const [rolling, setRolling] = useState(false);
  const [previewReps, setPreviewReps] = useState(reps);
  const [previewExercise, setPreviewExercise] = useState<AppExercise | null>(exercise);

  const animate = useCallback(async (animateReps: boolean, animateExercise: boolean) => {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const duration = reducedMotion ? 100 : 680;
    const interval = reducedMotion ? 100 : 75;
    const started = performance.now();

    await new Promise<void>((resolve) => {
      const timer = window.setInterval(() => {
        if (animateReps) setPreviewReps(secureRandomInt(dice.minimum, dice.maximum));
        if (animateExercise && exercises.length > 0) setPreviewExercise(exercises[secureRandomInt(0, exercises.length - 1)]);
        if (performance.now() - started >= duration) {
          window.clearInterval(timer);
          resolve();
        }
      }, interval);
    });
  }, [dice.maximum, dice.minimum, exercises]);

  const addHistory = useCallback((nextExercise: AppExercise, nextReps: number) => {
    const record: RollRecord = {
      id: `${Date.now()}-${nextExercise.id}`,
      exerciseId: nextExercise.id,
      exerciseName: nextExercise.name,
      reps: nextReps,
      timestamp: Date.now(),
      diceLevel: dice.id,
    };
    setHistory((current) => [record, ...current].slice(0, 10));
    setCurrentRollId(record.id);
    return record.id;
  }, [dice.id, setCurrentRollId, setHistory]);

  const rollBoth = useCallback(async () => {
    if (rolling || exercises.length === 0) return;
    setRolling(true);
    const finalReps = rollReps(dice.minimum, dice.maximum);
    const finalExercise = pickRandomExercise(exercises, exercise?.id);
    await animate(true, true);
    setReps(finalReps);
    setExercise(finalExercise);
    setPreviewReps(finalReps);
    setPreviewExercise(finalExercise);
    addHistory(finalExercise, finalReps);
    navigator.vibrate?.(30);
    setRolling(false);
  }, [addHistory, animate, dice.maximum, dice.minimum, exercise?.id, exercises, rolling, setExercise, setReps]);

  const rollRepsOnly = useCallback(async () => {
    if (rolling) return;
    setRolling(true);
    const finalReps = rollReps(dice.minimum, dice.maximum);
    await animate(true, false);
    setReps(finalReps);
    setPreviewReps(finalReps);
    if (exercise) addHistory(exercise, finalReps);
    navigator.vibrate?.(20);
    setRolling(false);
  }, [addHistory, animate, dice.maximum, dice.minimum, exercise, rolling, setReps]);

  const rollExerciseOnly = useCallback(async () => {
    if (rolling || exercises.length === 0) return;
    setRolling(true);
    const finalExercise = pickRandomExercise(exercises, exercise?.id);
    await animate(false, true);
    setExercise(finalExercise);
    setPreviewExercise(finalExercise);
    addHistory(finalExercise, reps);
    navigator.vibrate?.(20);
    setRolling(false);
  }, [addHistory, animate, exercise?.id, exercises, reps, rolling, setExercise]);

  return {
    reps,
    exercise,
    previewReps,
    previewExercise,
    history,
    currentRollId,
    rolling,
    rollBoth,
    rollRepsOnly,
    rollExerciseOnly,
  };
}
