interface ExerciseDiceProps { name?: string; rolling: boolean; }
export function ExerciseDice({ name, rolling }: ExerciseDiceProps) {
  return (
    <section className={`dice-card exercise-dice ${rolling ? 'is-rolling' : ''}`} aria-label={`Dado de ejercicio: ${name ?? 'sin lanzar'}`}>
      <span className="eyebrow">DADO DE EJERCICIO</span>
      <div className="exercise-cube"><strong>{name ?? 'LISTO'}</strong></div>
      <span className="dice-caption">EJERCICIO</span>
    </section>
  );
}
