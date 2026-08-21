import { Check, ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { bodyPartLabel, equipmentLabel } from '../lib/translations';
import type { AppExercise } from '../types/exercise';
import { EvidencePanel } from './EvidencePanel';
import { ExerciseMedia } from './ExerciseMedia';

interface Props { exercise: AppExercise; reps: number; rollId: string; onDone: () => void; }
export function ExerciseResult({ exercise, reps, rollId, onDone }: Props) {
  const [completed, setCompleted] = useState(false);
  const [instructionsOpen, setInstructionsOpen] = useState(false);
  const steps = exercise.instructionStepsEs.length ? exercise.instructionStepsEs : [exercise.instructionsEs].filter(Boolean);
  const markDone = () => { if (completed) return; setCompleted(true); onDone(); window.setTimeout(() => setCompleted(false), 1800); };
  return (
    <section className="result-card" aria-live="polite">
      <div className="result-heading">
        <div><span className="eyebrow">RESULTADO</span><div className="reps-line"><strong>{reps}</strong><span>REPETICIONES</span></div><h2>{exercise.name}</h2></div>
      </div>

      <div className="result-main-grid">
        <ExerciseMedia exercise={exercise} />
        <div className="result-info-panel">
          <dl className="metadata-grid">
            <div><dt>Equipo</dt><dd>{equipmentLabel(exercise.equipment)}</dd></div>
            <div><dt>Zona</dt><dd>{bodyPartLabel(exercise.bodyPart)}</dd></div>
            <div><dt>Objetivo</dt><dd>{exercise.target}</dd></div>
            <div><dt>Grupo muscular</dt><dd>{exercise.muscleGroup || '—'}</dd></div>
          </dl>
          {exercise.secondaryMuscles.length > 0 && <p className="secondary-muscles"><strong>Secundarios:</strong> {exercise.secondaryMuscles.join(', ')}</p>}
          {exercise.attribution && <p className="attribution">Media: {exercise.attribution}</p>}
        </div>
      </div>

      <div className={`instructions ${instructionsOpen ? 'open' : ''}`}>
        <button type="button" className="instructions-toggle" onClick={() => setInstructionsOpen((value) => !value)} aria-expanded={instructionsOpen}><span><strong>Cómo hacerlo</strong><small>{steps.length} {steps.length === 1 ? 'paso' : 'pasos'}</small></span><ChevronDown size={19}/></button>
        {instructionsOpen && <ol>{steps.map((step, index) => <li key={`${exercise.id}-${index}`}>{step}</li>)}</ol>}
      </div>

      <EvidencePanel rollId={rollId} exercise={exercise} reps={reps}/>

      <div className="result-footer">
        <button className={`done-btn ${completed ? 'completed' : ''}`} onClick={markDone}>{completed ? <><Check/> ¡Completado!</> : <><Check/> HECHO</>}</button>
        <p className="safety-note">Entrena con técnica adecuada y dentro de tus capacidades.</p>
      </div>
    </section>
  );
}
