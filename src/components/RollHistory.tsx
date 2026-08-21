import type { RollRecord } from '../types/exercise';
export function RollHistory({ history }: { history: RollRecord[] }) {
  if (!history.length) return null;
  return <section className="history-card"><h3>Últimas tiradas</h3><div className="history-list">{history.map((item) => <div key={item.id}><strong>{item.reps}×</strong><span>{item.exerciseName}</span></div>)}</div></section>;
}
