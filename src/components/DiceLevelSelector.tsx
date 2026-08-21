import { DICE_LEVELS } from '../lib/diceLevels';
import type { DiceLevel } from '../types/exercise';

interface Props { value: DiceLevel; onChange: (level: DiceLevel) => void; }

export function DiceLevelSelector({ value, onChange }: Props) {
  return (
    <section className="level-section" aria-label="Nivel de entrenamiento">
      <div className="section-heading-inline"><div><span className="eyebrow">INTENSIDAD</span><h2>¿Qué tan duro entrenas hoy?</h2></div><p>El dado define tus repeticiones.</p></div>
      <div className="level-grid">
        {DICE_LEVELS.map((level) => (
          <button
            key={level.id}
            type="button"
            className={`level-card ${value === level.id ? 'selected' : ''}`}
            onClick={() => onChange(level.id)}
            aria-pressed={value === level.id}
          >
            <span>{level.label}</span>
            <strong>{level.shortLabel}</strong>
            <small>{level.minimum}–{level.maximum} reps</small>
          </button>
        ))}
      </div>
    </section>
  );
}
