export interface RandomSource {
  /** A finite value in [0, 1). */
  next(): number;
}

/** Production adapter; the engine always receives its source explicitly. */
export const mathRandomSource: RandomSource = {
  next: () => Math.random(),
};

export function nextRandom(source: RandomSource): number {
  const value = source.next();
  if (!Number.isFinite(value) || value < 0 || value >= 1) {
    throw new RangeError('RandomSource must return a finite value in [0, 1).');
  }
  return value;
}
