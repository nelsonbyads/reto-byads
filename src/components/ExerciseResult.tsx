import { Check, ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { bodyPartLabel, equipmentLabel } from '../lib/translations';
import type { AppExercise, DiceLevel } from '../types/exercise';
import { ChallengeGymbroButton } from './ChallengeGymbroButton';
import { EvidencePanel } from './EvidencePanel';
import { ExerciseMedia } from './ExerciseMedia';

interface Props {
  exercise: AppExercise;
  reps: number;
  rollId: string;
  diceLevel: DiceLevel;
  onDone: () => void;
}

export function ExerciseResult({ exercise, reps, rollId, diceLevel, onDone }: Props) {
  const [completed, setCompleted] = useState(false);
  const [instructionsOpen, setInstructionsOpen] = useState(false);
  const steps = exercise.instructionStepsEs.length ? exercise.instructionStepsEs : [exercise.instructionsEs].filter(Boolean);
  const markDone = () => {
    if (completed) return;
    setCompleted(true);
    onDone();
    window.setTimeout(() => setCompleted(false), 1800);
  };

  return (
    <section className="result-card result-card-v7" aria-live="polite">
      <div className="result-header-v7">
        <div><span className="eyebrow">RESULTADO</span><h2>{exercise.name}</h2></div>
        <span className="result-roll-badge-v7">{reps} REP</span>
      </div>

      <div className="result-dashboard-v7">
        <div className="result-visual-v7">
          <div className="result-reps-v7">
            <strong>{reps}</strong>
            <span>REPETICIONES</span>
          </div>
          <ExerciseMedia exercise={exercise} />
        </div>

        <div className="result-details-v7">
          <dl className="metadata-grid metadata-grid-v7">
            <div><dt>Equipo</dt><dd>{equipmentLabel(exercise.equipment)}</dd></div>
            <div><dt>Zona</dt><dd>{bodyPartLabel(exercise.bodyPart)}</dd></div>
            <div><dt>Objetivo</dt><dd>{exercise.target}</dd></div>
            <div><dt>Grupo muscular</dt><dd>{exercise.muscleGroup || '—'}</dd></div>
          </dl>

          {exercise.secondaryMuscles.length > 0 && <p className="secondary-muscles"><strong>Secundarios:</strong> {exercise.secondaryMuscles.join(', ')}</p>}
          {exercise.attribution && <p className="attribution">Media: {exercise.attribution}</p>}

          <div className={`instructions instructions-v7 ${instructionsOpen ? 'open' : ''}`}>
            <button type="button" className="instructions-toggle" onClick={() => setInstructionsOpen((value) => !value)} aria-expanded={instructionsOpen}>
              <span><strong>Cómo hacerlo</strong><small>{steps.length} {steps.length === 1 ? 'paso' : 'pasos'}</small></span><ChevronDown size={19}/>
            </button>
            {instructionsOpen && <ol>{steps.map((step, index) => <li key={`${exercise.id}-${index}`}>{step}</li>)}</ol>}
          </div>

          <div className="result-completion-v7">
            <div><strong>¿Listo para cerrar esta ronda?</strong><span>La evidencia es opcional para tu entrenamiento personal.</span></div>
            <button className={`done-btn ${completed ? 'completed' : ''}`} onClick={markDone}>
              {completed ? <><Check/> ¡Completado!</> : <><Check/> Marcar como completado</>}
            </button>
            <ChallengeGymbroButton exercise={exercise} reps={reps} diceLevel={diceLevel}/>
          </div>
        </div>

        <EvidencePanel rollId={rollId} exercise={exercise} reps={reps}/>
      </div>

      <p className="safety-note">Entrena con técnica adecuada y dentro de tus capacidades.</p>
    </section>
  );
}
