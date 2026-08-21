interface RepDiceProps { value: number; rolling: boolean; sides: number; minimum: number; maximum: number; }
export function RepDice({ value, rolling, sides, minimum, maximum }: RepDiceProps) {
  return (
    <section className={`dice-card rep-dice ${rolling ? 'is-rolling' : ''}`} aria-label={`Dado D${sides} de repeticiones: ${value}`}>
      <div className="dice-card-top"><span className="eyebrow">REPETICIONES</span><span className="dice-range">{minimum}–{maximum}</span></div>
      <div className="d20-shape"><strong>{value}</strong></div>
      <span className="dice-caption">D{sides}</span>
    </section>
  );
}
