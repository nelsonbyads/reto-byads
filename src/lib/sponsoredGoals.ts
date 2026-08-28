export type SponsoredGoalType = 'repetitions' | 'time' | 'distance' | 'quantity';

export interface SponsoredGoal {
  type: SponsoredGoalType;
  value: number;
  unit: string;
}

export const SPONSORED_GOAL_OPTIONS: Array<{ id: SponsoredGoalType; label: string }> = [
  { id: 'repetitions', label: 'Repeticiones' },
  { id: 'time', label: 'Tiempo' },
  { id: 'distance', label: 'Distancia' },
  { id: 'quantity', label: 'Cantidad' },
];

export const SPONSORED_GOAL_UNITS: Record<SponsoredGoalType, Array<{ value: string; label: string }>> = {
  repetitions: [{ value: 'reps', label: 'repeticiones' }],
  time: [{ value: 'minutes', label: 'minutos' }, { value: 'hours', label: 'horas' }],
  distance: [{ value: 'km', label: 'km' }, { value: 'm', label: 'metros' }],
  quantity: [{ value: 'steps', label: 'pasos' }, { value: 'times', label: 'veces' }, { value: 'units', label: 'unidades' }],
};

export function defaultGoalUnit(type: SponsoredGoalType): string {
  return SPONSORED_GOAL_UNITS[type][0].value;
}

export function readSponsoredGoal(metadata: Record<string, unknown> | null | undefined, fallbackReps: number): SponsoredGoal {
  const rawType = metadata?.goal_type;
  const type: SponsoredGoalType = rawType === 'time' || rawType === 'distance' || rawType === 'quantity' || rawType === 'repetitions' ? rawType : 'repetitions';
  const rawValue = Number(metadata?.goal_value);
  const value = Number.isFinite(rawValue) && rawValue > 0 ? rawValue : Math.max(1, Number(fallbackReps) || 1);
  const allowed = SPONSORED_GOAL_UNITS[type];
  const rawUnit = typeof metadata?.goal_unit === 'string' ? metadata.goal_unit : '';
  const unit = allowed.some((item) => item.value === rawUnit) ? rawUnit : defaultGoalUnit(type);
  return { type, value, unit };
}

export function formatSponsoredGoal(goal: SponsoredGoal): string {
  const formatted = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 2 }).format(goal.value);
  const unit = SPONSORED_GOAL_UNITS[goal.type].find((item) => item.value === goal.unit)?.label ?? goal.unit;
  return `${formatted} ${unit}`;
}
