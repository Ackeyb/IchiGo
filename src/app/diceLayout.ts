import type { DiceMode } from '../game/types';

export type DiceGridLayout = Readonly<{
  columns: number;
  rows: readonly number[];
  trackColumns: number;
  cardSpan: number;
  secondRowStart?: number;
}>;

/** Result-card layout is selected from the authoritative mode as well as the displayed count. */
export function getDiceGridLayout(diceMode: DiceMode, displayedCount: number): DiceGridLayout {
  if (!Number.isInteger(displayedCount) || displayedCount < 1 || displayedCount > diceMode) {
    throw new RangeError('displayed dice count must be within the selected Dice Mode');
  }

  if (diceMode === 10 && displayedCount > 5) {
    const secondRowCount = displayedCount - 5;
    return {
      columns: 5,
      rows: [5, secondRowCount],
      trackColumns: 10,
      cardSpan: 2,
      secondRowStart: 6 - secondRowCount,
    };
  }

  return {
    columns: displayedCount,
    rows: [displayedCount],
    trackColumns: displayedCount,
    cardSpan: 1,
  };
}
