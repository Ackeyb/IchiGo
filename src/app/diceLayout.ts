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

  const rowCapacity = diceMode === 10 ? 5 : diceMode === 14 ? 7 : diceMode;
  if (displayedCount > rowCapacity) {
    const secondRowCount = displayedCount - rowCapacity;
    return {
      columns: rowCapacity,
      rows: [rowCapacity, secondRowCount],
      trackColumns: rowCapacity * 2,
      cardSpan: 2,
      secondRowStart: rowCapacity + 1 - secondRowCount,
    };
  }

  return {
    columns: displayedCount,
    rows: [displayedCount],
    trackColumns: displayedCount,
    cardSpan: 1,
  };
}
