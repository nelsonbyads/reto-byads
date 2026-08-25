import { Check, ChevronDown, ShieldAlert } from 'lucide-react';
import { useState } from 'react';
import { bodyPartLabel, equipmentLabel } from '../lib/translations';
import type { AppExercise, DiceLevel } from '../types/exercise';
import { ChallengeGymbroButton } from './ChallengeGymbroButton';
import { EvidencePanel } from './EvidencePanel';
import { ExerciseMedia } from './ExerciseMedia';
import { SquadChallengeButton } from './SquadChallengeButton';

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
  const [evidenceCount, setEvidenceCount] = useState(0);
  const steps = exercise.instructionStepsEs.length ? exercise.instructionStepsEs : [exercise.instructionsEs].filter(Boolean);
  const canComplete = evidenceCount > 0;

  const markDone = () => {
    if (completed || !canComplete) return;
    setCompleted(true);
    onDone();
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

          <div className="result-completion-v7 result-completion-v113">
            <div>
              <strong>¿Listo para cerrar esta ronda?</strong>
              <span>{completed ? 'Ronda cerrada. Esta tirada ya no puede contarse dos veces.' : canComplete ? `${evidenceCount} evidencia${evidenceCount === 1 ? '' : 's'} lista${evidenceCount === 1 ? '' : 's'} para validar la ronda.` : 'Sube al menos una foto o video antes de marcarla como completada.'}</span>
            </div>
            <button className={`done-btn ${completed ? 'completed' : ''}`} onClick={markDone} disabled={!canComplete || completed}>
              {completed ? <><Check/> ¡Completado!</> : <><Check/> Marcar como completado</>}
            </button>
            {!canComplete && !completed && <p className="completion-evidence-guard-v113"><ShieldAlert size={14}/> Evidencia obligatoria para cerrar la ronda.</p>}
            <div className="social-challenge-actions-v11">
              <ChallengeGymbroButton exercise={exercise} reps={reps} diceLevel={diceLevel}/>
              <SquadChallengeButton exercise={exercise} reps={reps} diceLevel={diceLevel}/>
            </div>
          </div>
        </div>

        <EvidencePanel rollId={rollId} exercise={exercise} reps={reps} onCountChange={setEvidenceCount} locked={completed}/>
      </div>

      <p className="safety-note">Entrena con técnica adecuada y dentro de tus capacidades.</p>
    </section>
  );
}
