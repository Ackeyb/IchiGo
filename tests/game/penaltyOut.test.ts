import { describe, expect, it } from 'vitest';
import { advanceFlow, initialFlow } from '../../src/game/gameFlow';
import type { FlowAction } from '../../src/game/gameFlow';
import { calculatePenalty, getPenaltyDieValue, rollPenalty, rollPenaltyDice } from '../../src/game/penalty';
import type { PenaltyState } from '../../src/game/penalty';
import { rollGameDice } from '../../src/game/rollGenerator';
import { initialSetup } from '../../src/game/setup';
import type { DieResult, DieValue, ThrowStyle } from '../../src/game/types';

const out: DieResult = { status: 'out', value: null };
const safe = (value: DieValue): DieResult => ({ status: 'safe', value });
class Sequence {
  calls = 0;
  constructor(private readonly values: readonly number[]) {}
  next() {
    const value = this.values[this.calls++];
    if (value === undefined) throw new Error('Unexpected random draw');
    return value;
  }
}
const normal = (...faces: number[]) => faces.flatMap((face) => [0.9, (face - 0.5) / 6]);

describe('Penalty OUT random semantics', () => {
  it.each([['rough', 0.03], ['normal', 0.01]] as const)('%s tests OUT first and draws faces only for SAFE', (style, threshold) => {
    const values = [threshold - 0.000001, threshold, 0, 0.9, 1 - Number.EPSILON];
    const random = new Sequence(values);
    expect(rollPenaltyDice(3, random, 7, style)).toEqual([out, safe(1), safe(6)]);
    expect(random.calls).toBe(5);
    expect(rollGameDice(3, style, new Sequence(values))).toEqual([out, safe(1), safe(6)]);
  });
  it('careful consumes both draws even when OUT checks are zero', () => {
    const random = new Sequence([0, 0, 0, 0.99]);
    expect(rollPenaltyDice(2, random, 7, 'careful')).toEqual([safe(1), safe(6)]);
    expect(random.calls).toBe(4);
  });
  it.each([5, 7, 10, 14] as const)('generates all OUT in %i DICE with exactly one draw per die', (diceMode) => {
    const random = new Sequence(Array<number>(diceMode).fill(0));
    const result = rollPenaltyDice(diceMode, random, diceMode, 'normal');
    expect(result).toEqual(Array<DieResult>(diceMode).fill(out));
    expect(calculatePenalty(result, 0, diceMode).basePenalty).toBe(diceMode * 6);
    expect(random.calls).toBe(diceMode);
  });
  it('rejects a fifteenth die and unknown throw style before drawing', () => {
    const random = new Sequence([]);
    expect(() => rollPenaltyDice(15, random, 14, 'normal')).toThrow(RangeError);
    expect(() => rollPenaltyDice(1, random, 7, 'invalid' as ThrowStyle)).toThrow(RangeError);
    expect(random.calls).toBe(0);
  });
});

describe('Penalty OUT calculation', () => {
  it.each([
    { dice: [out], base: 6 },
    { dice: [out, out], base: 12 },
    { dice: [out, safe(2), safe(5), out], base: 19 },
    { dice: [safe(1), safe(5), safe(6)], base: 12 },
  ])('calculates BASE $base without converting authoritative OUT', ({ dice, base }) => {
    const result = calculatePenalty(dice, 0);
    expect(result).toEqual({ penaltyRoll: dice, basePenalty: base, multiplier: 1, finalPenalty: base });
    expect(result.penaltyRoll).not.toBe(dice);
    expect(result.penaltyRoll[0]).not.toBe(dice[0]);
  });
  it('applies multiplier after OUT conversion and preserves dice order', () => {
    const dice = Object.freeze([safe(2), out, safe(5)]);
    expect(calculatePenalty(dice, 2)).toEqual({ penaltyRoll: dice, basePenalty: 13, multiplier: 3, finalPenalty: 39 });
    expect(dice.map(getPenaltyDieValue)).toEqual([2, 6, 5]);
    expect(dice[1]).toEqual({ status: 'out', value: null });
  });
  it.each([{ status: 'out', value: 6 }, { status: 'safe', value: null }, { status: 'safe', value: 7 }, { status: 'out' }, 6, undefined])('rejects malformed die %j', (die) => {
    expect(() => getPenaltyDieValue(die as DieResult)).toThrow(RangeError);
    expect(() => calculatePenalty([die as DieResult], 0)).toThrow(RangeError);
  });
});

describe('Flow throw style and independent losers', () => {
  it.each(['rough', 'normal', 'careful'] as const)('passes authoritative %s to penalties independently of rollLimit', (throwStyle) => {
    let state = initialFlow();
    const random = new Sequence([...normal(1, 1, 1, 1, 1), ...normal(2, 2, 2, 2, 2), ...Array<number>(10).fill(0)]);
    const perform = (action: FlowAction) => { state = advanceFlow(state, state.revision, action, random); };
    perform({ type: 'start', setup: { ...initialSetup(), diceMode: 5, throwStyle, rollLimit: 1,
      participants: [{ id: 'w', name: 'W' }, { id: 'l', name: 'L' }] } });
    for (const type of ['roll', 'next', 'roll', 'ranking', 'reveal', 'penalty', 'rollPenalty'] as const) perform({ type });
    if (state.phase !== 'penalty') throw new Error('Expected penalty');
    expect(state.penalty.penalties[0]).toMatchObject({ penaltyRoll: Array<DieResult>(5).fill(throwStyle === 'careful' ? safe(1) : out),
      basePenalty: throwStyle === 'careful' ? 5 : 30, multiplier: 2 });
    expect(state.penalty).not.toHaveProperty('rollLimit');
    expect(random.calls).toBe(throwStyle === 'careful' ? 30 : 25);
    const before = state;
    perform({ type: 'rollPenalty' });
    expect(state).toBe(before);
    expect(random.calls).toBe(throwStyle === 'careful' ? 30 : 25);
  });
  it('keeps losers in original order with separate OUT results and rejects invalid operations without draws', () => {
    const initial: PenaltyState = { penaltyId: 'penalty', totalCompletionCount: 2, penalties: [
      { playerId: 'z', diceCount: 3, status: 'pending' }, { playerId: 'a', diceCount: 3, status: 'pending' },
    ] };
    const random = new Sequence([0, ...normal(2, 5), ...normal(4), 0, 0]);
    const forbidden = new Sequence([]);
    expect(rollPenalty(initial, 'a', forbidden, 'penalty', 7, 'rough')).toBe(initial);
    expect(rollPenalty(initial, 'z', forbidden, 'stale', 7, 'rough')).toBe(initial);
    const first = rollPenalty(initial, 'z', random, 'penalty', 7, 'rough');
    expect(first.penalties[0]).toMatchObject({ penaltyRoll: [out, safe(2), safe(5)], basePenalty: 13, finalPenalty: 39 });
    expect(first.penalties[1]?.status).toBe('pending');
    const last = rollPenalty(first, 'a', random, 'penalty', 7, 'rough');
    expect(last.penalties[1]).toMatchObject({ penaltyRoll: [safe(4), out, out], basePenalty: 16, finalPenalty: 48 });
    expect(last.penalties.map((entry) => entry.playerId)).toEqual(['z', 'a']);
    expect(rollPenalty(last, 'a', forbidden, 'penalty', 7, 'rough')).toBe(last);
    expect(forbidden.calls).toBe(0);
    expect(random.calls).toBe(9);
  });
});
