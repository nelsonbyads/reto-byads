import { ChevronRight } from 'lucide-react';
import { getDiceLevel } from '../lib/diceLevels';
import type { RollRecord } from '../types/exercise';

function formatWhen(timestamp: number): string {
  try {
    const date = new Date(timestamp);
    const now = new Date();
    const sameDay = date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
    const time = new Intl.DateTimeFormat('es-CO', { hour: '2-digit', minute: '2-digit' }).format(date);
    if (sameDay) return `Hoy · ${time}`;
    const day = new Intl.DateTimeFormat('es-CO', { day: '2-digit', month: 'short' }).format(date);
    return `${day} · ${time}`;
  } catch {
    return '';
  }
}

export function RollHistory({ history }: { history: RollRecord[] }) {
  if (!history.length) return null;
  return (
    <section className="history-card history-card-v7">
      <div className="history-heading-v7"><div><span className="eyebrow">HISTORIAL</span><h3>Tiradas recientes</h3></div><small>{history.length} registros</small></div>
      <div className="history-list history-list-v7">
        {history.slice(0, 6).map((item) => {
          const dice = item.diceLevel ? getDiceLevel(item.diceLevel) : null;
          return (
            <article key={item.id} className="history-item-v7">
              <strong>{item.reps}</strong>
              <div><b>{item.exerciseName}</b><span>{dice?.shortLabel ?? 'Dado'} · {formatWhen(item.timestamp)}</span></div>
              <ChevronRight size={18}/>
            </article>
          );
        })}
      </div>
    </section>
  );
}
