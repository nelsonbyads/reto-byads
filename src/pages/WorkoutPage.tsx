import { Dice5, RefreshCw, RotateCw, SlidersHorizontal, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { AdRail } from '../components/AdRail';
import { AppHeader } from '../components/AppHeader';
import { DiceLevelSelector } from '../components/DiceLevelSelector';
import { ExerciseDice } from '../components/ExerciseDice';
import { ExerciseResult } from '../components/ExerciseResult';
import { FilterPanel } from '../components/FilterPanel';
import { RepDice } from '../components/RepDice';
import { RollHistory } from '../components/RollHistory';
import { SessionSummary } from '../components/SessionSummary';
import { SocialSummaryBar } from '../components/SocialSummaryBar';
import { useExercises } from '../hooks/useExercises';
import { usePersistentState } from '../hooks/usePersistentState';
import { useWorkoutRoll } from '../hooks/useWorkoutRoll';
import { getDiceLevel } from '../lib/diceLevels';
import { countActiveFilters, EMPTY_FILTERS } from '../lib/filters';
import { bodyPartLabel, equipmentLabel } from '../lib/translations';
import type { DiceLevel, ExerciseFilters } from '../types/exercise';

interface SessionState { exercises: number; reps: number; }
type FilterKey = keyof ExerciseFilters;

export function WorkoutPage() {
  const [filters, setFilters] = usePersistentState<ExerciseFilters>('dadofit:filters:v2', EMPTY_FILTERS);
  const [diceLevel, setDiceLevel] = usePersistentState<DiceLevel>('dadofit:dice-level', 'amateur');
  const [session, setSession] = usePersistentState<SessionState>('dadofit:session', { exercises: 0, reps: 0 });
  const [filtersOpen, setFiltersOpen] = useState(false);
  const dice = getDiceLevel(diceLevel);
  const { filtered, equipment, bodyParts, targets, loading, error, retry } = useExercises(filters);
  const { reps, exercise, previewReps, previewExercise, history, currentRollId, rolling, rollBoth, rollRepsOnly, rollExerciseOnly } = useWorkoutRoll(filtered, dice);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      const tag = (event.target as HTMLElement | null)?.tagName;
      if (event.code === 'Space' && !['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(tag ?? '')) {
        event.preventDefault(); void rollBoth();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [rollBoth]);

  const activeFilters = useMemo(() => countActiveFilters(filters), [filters]);
  const markDone = () => setSession((current) => ({ exercises: current.exercises + 1, reps: current.reps + reps }));
  const resetSession = () => { if (window.confirm('¿Reiniciar la sesión actual?')) setSession({ exercises: 0, reps: 0 }); };
  const removeFilter = (key: FilterKey, value: string) => setFilters((current) => ({ ...current, [key]: current[key].filter((item) => item !== value) }));
  const filterChips = [
    ...filters.equipment.map((value) => ({ key: 'equipment' as const, value, label: equipmentLabel(value) })),
    ...filters.bodyPart.map((value) => ({ key: 'bodyPart' as const, value, label: bodyPartLabel(value) })),
    ...filters.target.map((value) => ({ key: 'target' as const, value, label: value })),
  ];

  if (loading) return <main className="state-screen"><div className="loader"/><h1>DadoFit</h1><p>Cargando ejercicios...</p></main>;
  if (error) return <main className="state-screen"><h1>DadoFit</h1><p>{error}</p><button className="primary-small" onClick={retry}>Reintentar</button></main>;

  return (
    <div className="workout-layout workout-layout-v7">
      <div className="monetized-page-v8">
        <AdRail side="left" />
        <div className="workout-center-v8">
          <AppHeader/>
          <div className="app-shell">
            <SocialSummaryBar/>
            <SessionSummary exercises={session.exercises} reps={session.reps} onReset={resetSession}/>
            <main className="workout-main-v7">
              <DiceLevelSelector value={diceLevel} onChange={setDiceLevel}/>

              <div className="toolbar toolbar-v7">
                <div className="toolbar-left-v7">
                  <button className="filter-btn" onClick={() => setFiltersOpen(true)}><SlidersHorizontal size={18}/> Filtros {activeFilters > 0 && <span>{activeFilters}</span>}</button>
                  {filterChips.length > 0 && <div className="active-filter-chips">{filterChips.map((chip) => <button key={`${chip.key}-${chip.value}`} type="button" onClick={() => removeFilter(chip.key, chip.value)}>{chip.label}<X size={13}/></button>)}</div>}
                </div>
                <p><strong>{filtered.length}</strong> ejercicios disponibles</p>
              </div>

              {filtered.length === 0 ? (
                <section className="empty-state"><h2>No hay ejercicios con estos filtros.</h2><p>Quita una condición o limpia la selección para ampliar el pool.</p><button className="primary-small" onClick={() => setFilters(EMPTY_FILTERS)}>Limpiar filtros</button></section>
              ) : <>
                <div className="dice-grid dice-grid-v7">
                  <RepDice value={previewReps} rolling={rolling} sides={dice.sides} minimum={dice.minimum} maximum={dice.maximum}/>
                  <ExerciseDice name={previewExercise?.name} rolling={rolling}/>
                </div>

                <div className="roll-controls-v7">
                  <button className="roll-button" onClick={() => void rollBoth()} disabled={rolling}><Dice5 size={22}/>{rolling ? 'LANZANDO...' : 'LANZAR DADOS'}</button>
                  <div className="secondary-roll-actions">
                    <button type="button" onClick={() => void rollRepsOnly()} disabled={rolling}><RotateCw size={16}/> Solo repeticiones</button>
                    <button type="button" onClick={() => void rollExerciseOnly()} disabled={rolling}><RefreshCw size={16}/> Cambiar ejercicio</button>
                  </div>
                  <p className="keyboard-hint">Tip: en escritorio puedes lanzar ambos con la barra espaciadora.</p>
                </div>

                {exercise && <ExerciseResult key={`${currentRollId}-${exercise.id}-${reps}`} rollId={currentRollId || `current-${exercise.id}-${reps}`} exercise={exercise} reps={reps} diceLevel={diceLevel} onDone={markDone}/>} 
                <RollHistory history={history}/>
              </>}
            </main>
            <FilterPanel open={filtersOpen} onClose={() => setFiltersOpen(false)} filters={filters} onChange={setFilters} equipment={equipment} bodyParts={bodyParts} targets={targets} count={filtered.length}/>
          </div>
        </div>
        <AdRail side="right" />
      </div>
    </div>
  );
}
