import { describe, expect, it } from 'vitest';
import { calculatePenalty, createPenaltyState, rollPenalty, rollPenaltyDice } from '../../src/game/penalty';
import type { DecisiveRound } from '../../src/game/penalty';
import type { RandomSource } from '../../src/game/randomSource';
import type { DieResult, DieValue } from '../../src/game/types';
import type { RoundPlayer } from '../../src/game/suddenDeath';
import { assertPlayerTurn } from '../../src/game/rollResolver';

class SequenceRandom implements RandomSource {
  calls = 0;
  constructor(private readonly values: readonly number[]) {}
  next(): number {
    const value = this.values[this.calls++];
    if (value === undefined) throw new Error('Unexpected random draw.');
    return value;
  }
}
const safe = (value: DieValue): DieResult => ({ status: 'safe', value });
const safeDice = (...values: DieValue[]) => values.map(safe);
// Every SAFE penalty die consumes an OUT check followed by its face draw.
const sourceFor = (...values: DieValue[]) => new SequenceRandom(values.flatMap((value) => [0.9, (value - 0.5) / 6]));
function player(id: string, score: number, remaining: number, stranded = 0): RoundPlayer {
  const result = {
    id, score, activeDice: remaining - stranded, strandedDice: stranded,
    removedDice: 7 - remaining, completed: remaining === 0, turnFinished: true,
  };
  assertPlayerTurn(result);
  return result;
}
function round(loser: RoundPlayer, totalCompletionCount = 1): DecisiveRound {
  return {
    participants: [{ id: 'winner', name: '勝者' }, { id: loser.id, name: '敗者' }],
    players: [player('winner', 350, 0), loser], totalCompletionCount, diceMode: 7,
  };
}

describe('SPEC §77 cases 31–33: penalty dice and calculation', () => {
  it.each([1, 7])('uses remainingDice=%i and draws OUT then face per SAFE die', (count) => {
    const loser = player('loser', (7 - count) * 100, count);
    const initial = createPenaltyState(round(loser), 'test-penalty');
    const random = sourceFor(...Array<DieValue>(count).fill(1));
    const next = rollPenalty(initial, 'loser', random, 'test-penalty');
    expect(next.penalties[0]).toEqual({
      playerId: 'loser', diceCount: count, status: 'resolved',
      penaltyRoll: Array<DieResult>(count).fill(safe(1)), basePenalty: count, multiplier: 2, finalPenalty: count * 2,
    });
    expect(random.calls).toBe(count * 2);
  });
  it('31: includes stranded dice in the decisive-round remaining count', () => {
    const initial = createPenaltyState(round(player('loser', 150, 5, 2)), 'test-penalty');
    const random = sourceFor(6, 4, 5, 2, 6);
    const next = rollPenalty(initial, 'loser', random, 'test-penalty');
    expect(next.penalties[0]).toMatchObject({ diceCount: 5, penaltyRoll: safeDice(6, 4, 5, 2, 6), basePenalty: 23, finalPenalty: 46 });
    expect(random.calls).toBe(5 * 2);
  });
  it('31/32: even an all-OUT loser rolls seven fresh SAFE dice with no carried OUT state', () => {
    const initial = createPenaltyState(round(player('loser', 0, 7, 7)), 'test-penalty');
    const random = sourceFor(1, 1, 1, 1, 1, 1, 1);
    expect(rollPenalty(initial, 'loser', random, 'test-penalty').penalties[0]).toMatchObject({ penaltyRoll: safeDice(1, 1, 1, 1, 1, 1, 1), basePenalty: 7 });
    expect(random.calls).toBe(7 * 2);
  });
  it('33: 1 and 5 are summed with no scoring/removal/reroll effects (§36)', () => {
    const initial = createPenaltyState(round(player('loser', 150, 4)), 'test-penalty');
    const random = sourceFor(1, 5, 5, 6);
    expect(rollPenalty(initial, 'loser', random, 'test-penalty').penalties[0]).toMatchObject({
      status: 'resolved', diceCount: 4, penaltyRoll: safeDice(1, 5, 5, 6), basePenalty: 17, multiplier: 2, finalPenalty: 34,
    });
    expect(random.calls).toBe(4 * 2);
  });
  it.each([[0, 1], [1, 2], [9, 10]])('committed completion count %i gives multiplier %i', (count, multiplier) => {
    expect(calculatePenalty(safeDice(1, 5, 5, 6), count!)).toEqual({
      penaltyRoll: safeDice(1, 5, 5, 6), basePenalty: 17, multiplier, finalPenalty: 17 * multiplier!,
    });
  });
  it.each([1, 2, 3, 4, 5, 6, 7])('basePenalty ranges from %i to six times that dice count', (count) => {
    expect(calculatePenalty(Array<DieResult>(count).fill(safe(1)), 0).basePenalty).toBe(count);
    expect(calculatePenalty(Array<DieResult>(count).fill(safe(6)), 0).basePenalty).toBe(count * 6);
  });
  it('32: careful OUT checks still consume draws and face boundaries produce one through six', () => {
    const random = new SequenceRandom([0, 1 / 6, 2 / 6, 3 / 6, 4 / 6, 1 - Number.EPSILON].flatMap((face) => [0, face]));
    expect(rollPenaltyDice(6, random, 7, 'careful')).toEqual(safeDice(1, 2, 3, 4, 5, 6));
    expect(random.calls).toBe(6 * 2);
  });
});

describe('SPEC §77 case 34: independent ordered loser processing', () => {
  const input: DecisiveRound = {
    diceMode: 7,
    participants: [{ id: 'z', name: '同名' }, { id: 'winner', name: '勝者' }, { id: 'a', name: '同名' }],
    players: [player('a', 200, 3, 1), player('winner', 300, 3), player('z', 200, 3, 3)],
    totalCompletionCount: 9,
  };
  it('includes every tied loser in original order, not ranking-input or alphabetical order', () => {
    expect(createPenaltyState(input, 'test-penalty')).toEqual({ penaltyId: 'test-penalty', totalCompletionCount: 9, penalties: [
      { playerId: 'z', diceCount: 3, status: 'pending' },
      { playerId: 'a', diceCount: 3, status: 'pending' },
    ] });
  });
  it('rolls each loser separately, keeps different results and preserves the fixed multiplier', () => {
    const initial = createPenaltyState(input, 'test-penalty');
    const random = sourceFor(1, 2, 3, 4, 5, 6);
    const first = rollPenalty(initial, 'z', random, 'test-penalty');
    expect(random.calls).toBe(3 * 2);
    expect(first.penalties[1]?.status).toBe('pending');
    const last = rollPenalty(first, 'a', random, 'test-penalty');
    expect(random.calls).toBe(6 * 2);
    expect(last.penalties).toEqual([
      { playerId: 'z', diceCount: 3, status: 'resolved', penaltyRoll: safeDice(1, 2, 3), basePenalty: 6, multiplier: 10, finalPenalty: 60 },
      { playerId: 'a', diceCount: 3, status: 'resolved', penaltyRoll: safeDice(4, 5, 6), basePenalty: 15, multiplier: 10, finalPenalty: 150 },
    ]);
    expect(last.totalCompletionCount).toBe(9);
  });
  it('rejects duplicate, winner, unknown and out-of-order requests without random draws', () => {
    const initial = createPenaltyState(input, 'test-penalty');
    const forbidden = new SequenceRandom([]);
    for (const id of ['a', 'winner', 'unknown']) expect(rollPenalty(initial, id, forbidden, 'test-penalty')).toBe(initial);
    const first = rollPenalty(initial, 'z', sourceFor(1, 1, 1), 'test-penalty');
    expect(rollPenalty(first, 'z', forbidden, 'test-penalty')).toBe(first);
    const last = rollPenalty(first, 'a', sourceFor(6, 6, 6), 'test-penalty');
    for (const id of ['z', 'a']) expect(rollPenalty(last, id, forbidden, 'test-penalty')).toBe(last);
    expect(forbidden.calls).toBe(0);
  });
  it('does not mutate the decisive round or pending state and is deterministic', () => {
    const frozen = Object.freeze({ ...input,
      participants: Object.freeze(input.participants.map((p) => Object.freeze({ ...p }))),
      players: Object.freeze(input.players.map((p) => Object.freeze({ ...p }))),
    });
    const snapshot = structuredClone(frozen);
    const base = createPenaltyState(frozen, 'test-penalty');
    const initial = Object.freeze({ ...base, penalties: Object.freeze(base.penalties.map((p) => Object.freeze(p))) });
    const before = structuredClone(initial);
    expect(rollPenalty(initial, 'z', sourceFor(1, 5, 6), 'test-penalty')).toEqual(rollPenalty(initial, 'z', sourceFor(1, 5, 6), 'test-penalty'));
    expect(frozen).toEqual(snapshot);
    expect(initial).toEqual(before);
  });
  it('snapshots counts and completion total, with no shared reference to later round changes', () => {
    const mutable = { ...input, players: input.players.map((p) => ({ ...p })) };
    const initial = createPenaltyState(mutable, 'test-penalty');
    mutable.totalCompletionCount = 20;
    mutable.players[0]!.activeDice = 7;
    const first = rollPenalty(initial, 'z', sourceFor(1, 2, 3), 'test-penalty');
    const last = rollPenalty(first, 'a', sourceFor(1, 2, 3), 'test-penalty');
    expect(last.totalCompletionCount).toBe(9);
    expect(last.penalties[1]).toMatchObject({ diceCount: 3, multiplier: 10 });
  });
});

describe('penalty input boundaries', () => {
  it.each([0, 8, -1, 1.5, NaN])('rejects invalid dice count %s before drawing', (count) => {
    const random = new SequenceRandom([]);
    expect(() => rollPenaltyDice(count, random)).toThrow(RangeError);
    expect(random.calls).toBe(0 * 2);
  });
  it.each([-1, 1, NaN, Infinity])('rejects invalid RandomSource value %s', (value) => {
    expect(() => rollPenaltyDice(1, new SequenceRandom([value]))).toThrow(RangeError);
  });
  it.each([-1, 0.5, NaN, Infinity])('rejects invalid completion count %s', (count) => {
    expect(() => calculatePenalty(safeDice(1), count)).toThrow(RangeError);
    expect(() => createPenaltyState(round(player('loser', 0, 7), count), 'test-penalty')).toThrow(RangeError);
  });
  it('rejects invalid faces and counts rather than accepting numeric legacy results or empty penalties', () => {
    for (const dice of [[], [0], [7], [1.5], [NaN], [null], Array(8).fill(1)]) {
      expect(() => calculatePenalty(dice as unknown as readonly DieResult[], 0)).toThrow(RangeError);
    }
  });
  it('does not partially commit when the random source fails mid-roll', () => {
    const initial = createPenaltyState(round(player('loser', 0, 7)), 'test-penalty');
    const before = structuredClone(initial);
    expect(() => rollPenalty(initial, 'loser', sourceFor(1), 'test-penalty')).toThrow('Unexpected random draw');
    expect(initial).toEqual(before);
  });
  it('copies result dice instead of retaining a caller-mutable array', () => {
    const dice: DieResult[] = safeDice(1, 5);
    const result = calculatePenalty(dice, 0);
    dice[0] = safe(6);
    expect(result.penaltyRoll).toEqual(safeDice(1, 5));
    expect(result.basePenalty).toBe(6);
  });
  it('rejects incomplete rounds and both kinds of sudden-death round', () => {
    const base = round(player('loser', 350, 0));
    expect(() => createPenaltyState(base, 'test-penalty')).toThrow('sudden death');
    const tied = { ...base, players: [player('winner', 0, 7), player('loser', 0, 7, 3)] };
    expect(() => createPenaltyState(tied, 'test-penalty')).toThrow('sudden death');
    expect(() => createPenaltyState({ ...tied, players: tied.players.map((p) => ({ ...p, turnFinished: false })) }, 'test-penalty')).toThrow('all turns');
  });
  it('rejects missing or duplicated roster members', () => {
    const base = round(player('loser', 0, 7));
    expect(() => createPenaltyState({ ...base, participants: [base.participants[0]!] }, 'test-penalty')).toThrow();
    expect(() => createPenaltyState({ ...base, players: [base.players[0]!, base.players[0]!] }, 'test-penalty')).toThrow('unique');
    expect(() => createPenaltyState({ ...base, participants: [base.participants[0]!, base.participants[0]!] }, 'test-penalty')).toThrow();
  });
});
