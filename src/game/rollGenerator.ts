import { nextRandom } from './randomSource';
import type { RandomSource } from './randomSource';
import { DEFAULT_DICE_MODE, isDiceMode } from './types';
import type { DiceMode, DieResult, DieValue, ThrowStyle } from './types';

export const DEFAULT_THROW_STYLE: ThrowStyle = 'normal';
export const OUT_PROBABILITIES: Readonly<Record<ThrowStyle, number>> = Object.freeze({
  rough: 0.03,
  normal: 0.01,
  careful: 0,
});

export function rollGameDice(
  count: number,
  throwStyle: ThrowStyle,
  random: RandomSource,
  diceMode: DiceMode = DEFAULT_DICE_MODE,
): readonly DieResult[] {
  if (!isDiceMode(diceMode)) throw new RangeError('Unknown dice mode.');
  if (!Number.isInteger(count) || count < 1 || count > diceMode) {
    throw new RangeError(`A normal roll requires 1 to ${diceMode} active dice.`);
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
