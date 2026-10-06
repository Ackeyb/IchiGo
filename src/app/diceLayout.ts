import type { DiceMode } from '../game/types';

export type DiceGridLayout = Readonly<{
  columns: number;
  rows: readonly number[];
  trackColumns: number;
  cardSpan: number;
  secondRowStart?: number;
}>;

/**
 * Owns strict 2D result-card rows selected from mode and displayed count.
 * Three.js settle positions are separate and must not inherit these row rules.
 */
export function getDiceGridLayout(diceMode: DiceMode, displayedCount: number): DiceGridLayout {
  if (!Number.isInteger(displayedCount) || displayedCount < 1 || displayedCount > diceMode) {
    throw new RangeError('displayed dice count must be within the selected Dice Mode');
  }

  const rowCapacity = diceMode === 10 ? 5 : diceMode === 14 ? 7 : diceMode;
  return resultRows(rowCapacity, displayedCount);
}

/** Series chunks are independent of the original game's Dice Mode. */
export function getSeriesChunkGridLayout(displayedCount: number): DiceGridLayout {
  if (!Number.isInteger(displayedCount) || displayedCount < 1 || displayedCount > 10) {
    throw new RangeError('Series chunk requires 1 to 10 displayed dice');
  }
  return resultRows(5, displayedCount);
}

function resultRows(rowCapacity: number, displayedCount: number): DiceGridLayout {
  if (displayedCount > rowCapacity) {
    const secondRowCount = displayedCount - rowCapacity;
    // Center the short visual row without reordering the committed dice array.
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
