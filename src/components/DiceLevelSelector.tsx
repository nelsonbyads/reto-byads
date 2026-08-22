import { Check, Trophy } from 'lucide-react';
import { DICE_LEVELS } from '../lib/diceLevels';
import type { DiceLevel } from '../types/exercise';

interface Props { value: DiceLevel; onChange: (level: DiceLevel) => void; }

export function DiceLevelSelector({ value, onChange }: Props) {
  return (
    <section className="level-section" aria-label="Nivel de entrenamiento">
      <div className="section-heading-inline">
        <div><span className="eyebrow">INTENSIDAD</span><h2>¿Qué tan duro entrenas hoy?</h2></div>
        <p>El dado define tus repeticiones.</p>
      </div>
      <div className="level-grid level-grid-v7">
        {DICE_LEVELS.map((level) => {
          const selected = value === level.id;
          return (
            <button
              key={level.id}
              type="button"
              data-level={level.id}
              className={`level-card level-card-v7 ${selected ? 'selected' : ''}`}
              onClick={() => onChange(level.id)}
              aria-pressed={selected}
            >
              <Trophy className="level-icon-v7" size={24} />
              <span>{level.label}</span>
              <strong>{level.shortLabel}</strong>
              <small>{level.minimum}–{level.maximum} reps</small>
              <i className="level-check-v7" aria-hidden="true">{selected && <Check size={17}/>}</i>
            </button>
          );
        })}
      </div>
    </section>
  );
}
