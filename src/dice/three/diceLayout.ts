export type DiceSettlePosition = Readonly<{ x: number; z: number }>;

const MAX_DICE = 14;
const ROW_CAPACITY = 5;
const COLUMN_GAP = 1.6;
const ROW_DEPTH = 1.15;

/**
 * Animated 3D staging positions; these differ from the strict 2D result grid.
 * Larger sets are balanced to stay visible in the tray and camera frame.
 */
export function getDiceSettlePositions(count: number): readonly DiceSettlePosition[] {
  if (!Number.isInteger(count) || count < 0 || count > MAX_DICE) {
    throw new RangeError('3D dice count must be an integer from 0 to 14');
  }
  if (count === 0) return [];

  // Larger sets share the existing tray between balanced rows, rather than a 5 + 9 row.
  const firstRowCount = count > 10 ? Math.ceil(count / 2) : Math.min(count, ROW_CAPACITY);
  const columnGap = count > 10 ? 1.7 : COLUMN_GAP;
  return Array.from({ length: count }, (_, index) => {
    const secondRow = index >= firstRowCount;
    const rowCount = secondRow ? count - firstRowCount : firstRowCount;
    const rowIndex = secondRow ? index - firstRowCount : index;
    return {
      x: (rowIndex - (rowCount - 1) / 2) * columnGap,
      z: count > ROW_CAPACITY ? (secondRow ? ROW_DEPTH : -ROW_DEPTH) : -0.2,
    };
  });
}
