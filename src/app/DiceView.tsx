import type { CSSProperties } from 'react';
import type { DiceMode, DieResult, DieValue } from '../game/types';
import type { DicePresentationKind } from '../dice/types';
import { getDiceGridLayout } from './diceLayout';

const pipPositions: Readonly<Record<DieValue, readonly string[]>> = {
  1: ['center'],
  2: ['top-left', 'bottom-right'],
  3: ['top-left', 'center', 'bottom-right'],
  4: ['top-left', 'top-right', 'bottom-left', 'bottom-right'],
  5: ['top-left', 'top-right', 'center', 'bottom-left', 'bottom-right'],
  6: ['top-left', 'middle-left', 'bottom-left', 'top-right', 'middle-right', 'bottom-right'],
};

function DiceFace({ value }: { value: DieValue }) {
  const accent = value === 1 || value === 5;
  return <span className={`die-face${accent ? ' die-face-accent' : ''}`} aria-hidden="true">
    {pipPositions[value].map((position) => <i key={position} className={`die-pip die-pip-${position}`} />)}
  </span>;
}

/** Presentation only. A future renderer can consume these same committed results. */
export function DiceView({ dice, diceMode, kind, removing = false }: {
  dice: readonly DieResult[];
  diceMode: DiceMode;
  kind: DicePresentationKind;
  removing?: boolean;
}) {
  const layout = getDiceGridLayout(diceMode, dice.length);
  const style = {
    '--dice-track-count': layout.trackColumns,
    '--dice-card-span': layout.cardSpan,
    '--dice-track-max': layout.cardSpan === 2 ? '34px' : '68px',
  } as CSSProperties;
  return <ol className="dice" aria-label="確定したダイスの出目" data-dice-mode={diceMode}
    data-columns={layout.columns} data-rows={layout.rows.join(',')} style={style}>
    {dice.map((die, index) => {
      // Red 1/5 is face styling shared with Penalty; GET status belongs only to normal scoring.
      const scored = kind === 'normal' && die.status === 'safe' && (die.value === 1 || die.value === 5);
      const status = die.status === 'out' ? 'OUT' : scored ? 'GET' : kind === 'normal' ? 'SAFE' : undefined;
      const ariaLabel = die.status === 'out' ? 'OUT' : `出目 ${die.value}${status ? `、${status}` : ''}`;
      const secondRowStyle = index === layout.rows[0] && layout.secondRowStart
        ? { gridColumn: `${layout.secondRowStart} / span ${layout.cardSpan}` } : undefined;
      return <li key={index} aria-label={ariaLabel} style={secondRowStyle}
        className={`die ${die.status === 'out' ? 'out' : scored ? `scored${removing ? ' removing' : ''}` : ''}`}>
        {die.status === 'out' ? <strong className="die-out-label">OUT</strong> : <DiceFace value={die.value} />}
        {status && die.status === 'safe' && <span className="die-status">{status}</span>}
        {scored && <b className="die-points">+{die.value === 1 ? 100 : 50}</b>}
      </li>;
    })}
  </ol>;
}

export function ReadyDice({ count, diceMode }: { count: number; diceMode?: DiceMode }) {
  return <div className="ready-dice" data-dice-mode={diceMode} aria-label={`ROLL可能なダイス ${count}個`}>
    {Array.from({ length: count }, (_, index) => <span key={index} aria-hidden="true">?</span>)}
  </div>;
}
