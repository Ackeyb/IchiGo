import type { CSSProperties } from 'react';
import type { DieResult } from '../game/types';

/** Presentation only. A future renderer can consume these same committed results. */
export function DiceView({ dice, scoring = true, removing = false }: {
  dice: readonly DieResult[];
  scoring?: boolean;
  removing?: boolean;
}) {
  return <ol className="dice" aria-label="確定したダイスの出目" style={{ '--dice-count': dice.length } as CSSProperties}>
    {dice.map((die, index) => {
      const scored = scoring && die.status === 'safe' && (die.value === 1 || die.value === 5);
      return <li key={index} className={`die ${die.status === 'out' ? 'out' : scored ? `scored${removing ? ' removing' : ''}` : ''}`}>
        <strong>{die.status === 'out' ? 'OUT' : die.value}</strong>
        {die.status === 'safe' && <span>{scored ? 'GET' : 'SAFE'}</span>}
        {scored && <b className="die-points">+{die.value === 1 ? 100 : 50}</b>}
      </li>;
    })}
  </ol>;
}

export function ReadyDice({ count }: { count: number }) {
  return <div className="ready-dice" aria-label={`ROLL可能なダイス ${count}個`}>
    {Array.from({ length: count }, (_, index) => <span key={index} aria-hidden="true">?</span>)}
  </div>;
}
