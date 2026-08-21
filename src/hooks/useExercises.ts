import { useCallback, useEffect, useMemo, useState } from 'react';
import { filterExercises } from '../lib/filters';
import type { AppExercise, ExerciseFilters } from '../types/exercise';

export function useExercises(filters: ExerciseFilters) {
  const [exercises, setExercises] = useState<AppExercise[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryToken, setRetryToken] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetch('/data/exercises.min.json', { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json() as AppExercise[];
        if (!Array.isArray(data) || data.length === 0) throw new Error('Dataset vacío');
        setExercises(data);
      })
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === 'AbortError') return;
        console.error('Could not load exercises', reason);
        setError('No pudimos cargar los ejercicios.');
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [retryToken]);

  const filtered = useMemo(() => filterExercises(exercises, filters), [exercises, filters]);
  const equipment = useMemo(() => [...new Set(exercises.map((x) => x.equipment))].sort(), [exercises]);
  const bodyParts = useMemo(() => [...new Set(exercises.map((x) => x.bodyPart))].sort(), [exercises]);
  const targets = useMemo(() => [...new Set(exercises.map((x) => x.target))].sort(), [exercises]);
  const retry = useCallback(() => setRetryToken((value) => value + 1), []);

  return { exercises, filtered, equipment, bodyParts, targets, loading, error, retry };
}
