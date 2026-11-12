interface Props { exercises: number; reps: number; onReset: () => void; }
export function SessionSummary({ exercises, reps, onReset }: Props) {
  return <div className="session-summary"><div><span>Sesión</span><strong>{exercises} ejercicios · {reps} reps</strong></div>{exercises > 0 && <button onClick={onReset}>Reiniciar</button>}</div>;
}
