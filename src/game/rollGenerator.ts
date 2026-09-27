import { nextRandom } from './randomSource';
import type { RandomSource } from './randomSource';
import type { DieResult, DieValue, ThrowStyle } from './types';

export const INITIAL_DICE = 7;
export const DEFAULT_THROW_STYLE: ThrowStyle = 'normal';
export const OUT_PROBABILITIES: Readonly<Record<ThrowStyle, number>> = Object.freeze({
  rough: 0.05,
  normal: 0.03,
  careful: 0.01,
});

export function rollGameDice(
  count: number,
  throwStyle: ThrowStyle,
  random: RandomSource,
): readonly DieResult[] {
  if (!Number.isInteger(count) || count < 1 || count > INITIAL_DICE) {
    throw new RangeError('A normal roll requires 1 to 7 active dice.');
  }
  if (!Object.hasOwn(OUT_PROBABILITIES, throwStyle)) {
    throw new RangeError('Unknown throw style.');
  }

  return Array.from({ length: count }, (): DieResult => {
    // SPEC §9: OUT is decided first; OUT consumes no D6 draw.
    if (nextRandom(random) < OUT_PROBABILITIES[throwStyle]) {
      return { status: 'out', value: null };
    }
    return {
      status: 'safe',
      value: (Math.floor(nextRandom(random) * 6) + 1) as DieValue,
    };
  });
}
