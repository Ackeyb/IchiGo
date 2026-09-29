import { describe, expect, it } from 'vitest';
import { getD6FaceNormal, getD6TargetQuaternion, getDisplayedTopValue } from '../../src/dice/d6Orientation';
import { toPresentedDice } from '../../src/dice/presentationDice';
import { ACCENT_PIP_COLOR, getD6PipColor, STANDARD_PIP_COLOR } from '../../src/dice/three/ThreeDiceRenderer';
import type { DieResult, DieValue } from '../../src/game/types';

describe('predetermined D6 presentation', () => {
  it.each([1, 2, 3, 4, 5, 6] as const)('places requested face %i on top', (value) => {
    const orientation = getD6TargetQuaternion(value, value * 0.37);
    expect(getDisplayedTopValue(orientation)).toBe(value);
    expect(getD6FaceNormal(value).applyQuaternion(orientation).y).toBeCloseTo(1, 10);
  });

  it('preserves the committed input order for multiple SAFE dice', () => {
    const values: readonly DieValue[] = [1, 5, 3, 6, 2, 4, 1];
    const dice: readonly DieResult[] = values.map((value) => ({ status: 'safe', value }));
    const shown = toPresentedDice(dice, 'normal');
    expect(shown.map((die) => die.index)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(shown.map((die) => die.status === 'safe' ? die.value : null)).toEqual(values);
  });

  it('keeps OUT distinct and never supplies it with a numeric result', () => {
    const shown = toPresentedDice([
      { status: 'safe', value: 1 },
      { status: 'out', value: null },
      { status: 'safe', value: 6 },
    ], 'normal');
    expect(shown).toEqual([
      { index: 0, status: 'safe', value: 1, scoring: true },
      { index: 1, status: 'out' },
      { index: 2, status: 'safe', value: 6, scoring: false },
    ]);
    expect(shown[1]).not.toHaveProperty('value');
  });

  it.each([5, 6, 7, 8, 9, 10])('supports a committed roll containing %i dice', (count) => {
    const shown = toPresentedDice(Array.from({ length: count }, () => ({ status: 'safe' as const, value: 4 as const })), 'normal');
    expect(shown).toHaveLength(count);
  });

  it.each([1, 5] as const)('uses the red texture pip color for face %i', (value) => {
    expect(getD6PipColor(value)).toBe(ACCENT_PIP_COLOR);
  });

  it.each([2, 3, 4, 6] as const)('keeps the standard texture pip color for face %i', (value) => {
    expect(getD6PipColor(value)).toBe(STANDARD_PIP_COLOR);
  });

  it.each(['normal', 'penalty'] as const)('uses the same red face design for %s presentation', (kind) => {
    const shown = toPresentedDice([
      { status: 'safe', value: 1 },
      { status: 'safe', value: 5 },
    ], kind);
    expect(shown.map((die) => die.status === 'safe' ? getD6PipColor(die.value) : null))
      .toEqual([ACCENT_PIP_COLOR, ACCENT_PIP_COLOR]);
  });

  it('presents penalty dice as ordinary D6 values without 1/5 scoring markers', () => {
    expect(toPresentedDice([
      { status: 'safe', value: 1 },
      { status: 'safe', value: 5 },
      { status: 'safe', value: 6 },
    ], 'penalty')).toEqual([
      { index: 0, status: 'safe', value: 1, scoring: false },
      { index: 1, status: 'safe', value: 5, scoring: false },
      { index: 2, status: 'safe', value: 6, scoring: false },
    ]);
  });
});
