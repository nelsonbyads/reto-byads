import { Dumbbell, Plus, Search, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useExercises } from '../hooks/useExercises';
import { EMPTY_FILTERS } from '../lib/filters';
import { bodyPartLabel, equipmentLabel } from '../lib/translations';
import type { AppExercise } from '../types/exercise';

interface Props {
  selected: AppExercise | null;
  customMode: boolean;
  customValue: string;
  onSelect: (exercise: AppExercise | null) => void;
  onCustomMode: (enabled: boolean) => void;
  onCustomValue: (value: string) => void;
}

function normalize(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export function ExerciseCatalogPicker({ selected, customMode, customValue, onSelect, onCustomMode, onCustomValue }: Props) {
  const { exercises, loading, error } = useExercises(EMPTY_FILTERS);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);

  const matches = useMemo(() => {
    const needle = normalize(query);
    if (!needle) return [];
    return exercises
      .filter((exercise) => normalize(`${exercise.name} ${exercise.bodyPart} ${exercise.target} ${exercise.equipment}`).includes(needle))
      .slice(0, 8);
  }, [exercises, query]);

  const suggestions = useMemo(() => {
    const keywords = ['burpee', 'push up', 'squat', 'plank', 'jumping jack'];
    const selectedSuggestions: AppExercise[] = [];
    for (const keyword of keywords) {
      const match = exercises.find((exercise) => normalize(exercise.name).includes(keyword));
      if (match && !selectedSuggestions.some((item) => item.id === match.id)) selectedSuggestions.push(match);
    }
    return selectedSuggestions.slice(0, 5);
  }, [exercises]);

  const choose = (exercise: AppExercise) => {
    onSelect(exercise);
    onCustomMode(false);
    onCustomValue('');
    setQuery('');
    setOpen(false);
  };

  if (customMode) {
    return <div className="exercise-picker-v131">
      <div className="exercise-picker-title-v131"><span>Actividad personalizada</span><button type="button" onClick={() => { onCustomMode(false); onCustomValue(''); }}><Search size={14}/> Usar catálogo</button></div>
      <label className="exercise-custom-v131">Nombre de la actividad<input value={customValue} onChange={(event) => onCustomValue(event.target.value)} minLength={2} maxLength={160} placeholder="Ej: Caminata ecológica" required/></label>
      <small>Úsala solo cuando la actividad no exista en el catálogo de DadoFit.</small>
    </div>;
  }

  if (selected) {
    return <div className="exercise-picker-v131">
      <div className="exercise-selected-v131">
        <div className="exercise-selected-media-v131">{selected.image ? <img src={selected.image} alt=""/> : <Dumbbell size={23}/>}</div>
        <div><span>Ejercicio DadoFit</span><strong>{selected.name}</strong><small>{bodyPartLabel(selected.bodyPart)} · {equipmentLabel(selected.equipment)}</small></div>
        <button type="button" aria-label="Cambiar ejercicio" title="Cambiar ejercicio" onClick={() => onSelect(null)}><X size={16}/></button>
      </div>
    </div>;
  }

  return <div className="exercise-picker-v131">
    <label className="exercise-search-v131">
      <span>Ejercicio</span>
      <div><Search size={17}/><input value={query} onFocus={() => setOpen(true)} onChange={(event) => { setQuery(event.target.value); setOpen(true); }} placeholder="Buscar en 1324 ejercicios…" autoComplete="off"/></div>
    </label>

    {loading && <small>Cargando catálogo DadoFit…</small>}
    {error && <small>No pudimos cargar el catálogo. Puedes usar una actividad personalizada.</small>}

    {!query && suggestions.length > 0 && <div className="exercise-suggestions-v131"><span>Sugeridos</span><div>{suggestions.map((exercise) => <button key={exercise.id} type="button" onClick={() => choose(exercise)}>{exercise.name}</button>)}</div></div>}

    {open && query.trim() && <div className="exercise-results-v131">
      {matches.length === 0 ? <p>No encontramos “{query}”.</p> : matches.map((exercise) => <button key={exercise.id} type="button" onClick={() => choose(exercise)}><Dumbbell size={17}/><span><strong>{exercise.name}</strong><small>{bodyPartLabel(exercise.bodyPart)} · {equipmentLabel(exercise.equipment)}</small></span></button>)}
    </div>}

    <button className="exercise-custom-toggle-v131" type="button" onClick={() => { onCustomMode(true); onSelect(null); setQuery(''); setOpen(false); }}><Plus size={15}/> Crear actividad personalizada</button>
  </div>;
}
