import { Search, SlidersHorizontal, X } from 'lucide-react';
import { useMemo, useState, type MouseEvent } from 'react';
import { bodyPartLabel, equipmentLabel } from '../lib/translations';
import type { ExerciseFilters } from '../types/exercise';

interface Props {
  open: boolean;
  onClose: () => void;
  filters: ExerciseFilters;
  onChange: (filters: ExerciseFilters) => void;
  equipment: string[];
  bodyParts: string[];
  targets: string[];
  count: number;
}

type FilterKey = keyof ExerciseFilters;

function toggleValue(filters: ExerciseFilters, key: FilterKey, value: string): ExerciseFilters {
  const current = filters[key];
  const next = current.includes(value) ? current.filter((item) => item !== value) : [...current, value];
  return { ...filters, [key]: next };
}

interface GroupProps {
  title: string;
  filterKey: FilterKey;
  values: string[];
  selected: string[];
  label: (value: string) => string;
  filters: ExerciseFilters;
  onChange: (filters: ExerciseFilters) => void;
  search: string;
}

function FilterGroup({ title, filterKey, values, selected, label, filters, onChange, search }: GroupProps) {
  const visible = useMemo(() => values.filter((value) => label(value).toLowerCase().includes(search.toLowerCase())), [label, search, values]);
  return (
    <fieldset className="filter-group">
      <legend><span>{title}</span>{selected.length > 0 && <b>{selected.length}</b>}</legend>
      <div className="filter-options">
        {visible.map((value) => {
          const checked = selected.includes(value);
          return <button key={value} type="button" className={`filter-chip ${checked ? 'selected' : ''}`} onClick={() => onChange(toggleValue(filters, filterKey, value))}>{checked && <span>✓</span>}{label(value)}</button>;
        })}
      </div>
    </fieldset>
  );
}

export function FilterPanel({ open, onClose, filters, onChange, equipment, bodyParts, targets, count }: Props) {
  const [search, setSearch] = useState('');
  if (!open) return null;
  return (
    <div className="filter-backdrop" role="presentation" onMouseDown={(e: MouseEvent<HTMLDivElement>) => e.target === e.currentTarget && onClose()}>
      <aside className="filter-panel" role="dialog" aria-modal="true" aria-label="Filtros de ejercicios">
        <div className="filter-heading"><div><SlidersHorizontal size={18}/><div><strong>Filtros</strong><span>{count} ejercicios disponibles</span></div></div><button className="icon-btn" onClick={onClose} aria-label="Cerrar filtros"><X /></button></div>
        <label className="filter-search"><Search size={17}/><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar opción..." /></label>
        <div className="filter-scroll">
          <FilterGroup title="Equipo" filterKey="equipment" values={equipment} selected={filters.equipment} label={equipmentLabel} filters={filters} onChange={onChange} search={search}/>
          <FilterGroup title="Zona corporal" filterKey="bodyPart" values={bodyParts} selected={filters.bodyPart} label={bodyPartLabel} filters={filters} onChange={onChange} search={search}/>
          <FilterGroup title="Objetivo" filterKey="target" values={targets} selected={filters.target} label={(value) => value} filters={filters} onChange={onChange} search={search}/>
        </div>
        <div className="filter-actions"><button className="secondary-btn" onClick={() => onChange({ equipment: [], bodyPart: [], target: [] })}>Limpiar todo</button><button className="primary-small" onClick={onClose}>Ver {count}</button></div>
      </aside>
    </div>
  );
}
