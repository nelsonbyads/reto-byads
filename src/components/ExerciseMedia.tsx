import { useEffect, useState } from 'react';
import type { AppExercise } from '../types/exercise';

export function ExerciseMedia({ exercise }: { exercise: AppExercise }) {
  const [mode, setMode] = useState<'gif' | 'image' | 'placeholder'>('gif');
  useEffect(() => setMode('gif'), [exercise.id]);
  return (
    <div className="media-frame">
      {mode === 'placeholder' ? (
        <div className="media-placeholder">Multimedia no disponible</div>
      ) : (
        <img
          src={mode === 'gif' ? exercise.gifUrl : exercise.image}
          alt={`Demostración de ${exercise.name}`}
          loading="lazy"
          onError={() => setMode((current) => current === 'gif' ? 'image' : 'placeholder')}
        />
      )}
    </div>
  );
}
