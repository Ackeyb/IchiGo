export type DiceSettlePosition = Readonly<{ x: number; z: number }>;

const MAX_DICE = 10;
const ROW_CAPACITY = 5;
const COLUMN_GAP = 1.6;
const ROW_DEPTH = 1.15;

/** Presentation-only settle positions. Logical Dice Mode remains owned by the game state. */
export function getDiceSettlePositions(count: number): readonly DiceSettlePosition[] {
  if (!Number.isInteger(count) || count < 0 || count > MAX_DICE) {
    throw new RangeError('3D dice count must be an integer from 0 to 10');
  }
  if (count === 0) return [];

  const firstRowCount = count > ROW_CAPACITY ? ROW_CAPACITY : count;
  return Array.from({ length: count }, (_, index) => {
    const secondRow = index >= firstRowCount;
    const rowCount = secondRow ? count - firstRowCount : firstRowCount;
    const rowIndex = secondRow ? index - firstRowCount : index;
    return {
      x: (rowIndex - (rowCount - 1) / 2) * COLUMN_GAP,
      z: count > ROW_CAPACITY ? (secondRow ? ROW_DEPTH : -ROW_DEPTH) : -0.2,
    };
  });
}
