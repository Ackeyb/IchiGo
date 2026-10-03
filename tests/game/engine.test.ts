import { describe, expect, it } from 'vitest';
import { continueTurn, createTurn, rollTurn } from '../../src/game/gameEngine';
import type { RandomSource } from '../../src/game/randomSource';
import { OUT_PROBABILITIES, rollGameDice } from '../../src/game/rollGenerator';
import { assertPlayerTurn, getRemainingDice, resolveRoll } from '../../src/game/rollResolver';
import type { DieResult, DieValue, PlayerTurn, ThrowStyle } from '../../src/game/types';

class SequenceRandom implements RandomSource {
  calls = 0;
  constructor(private readonly values: readonly number[]) {}
  next(): number {
    const value = this.values[this.calls++];
    if (value === undefined) throw new Error('Unexpected random draw.');
    return value;
  }
}

const out: DieResult = { status: 'out', value: null };
const safe = (value: DieValue): DieResult => ({ status: 'safe', value });
const results = (...values: (DieValue | 'out')[]) => values.map((v) => v === 'out' ? out : safe(v));
// Match rollGameDice consumption: OUT uses its check draw; SAFE uses that draw plus a face draw.
const sourceFor = (...values: (DieValue | 'out')[]) => new SequenceRandom(
  values.flatMap((v) => v === 'out' ? [0] : [0.9, (v - 0.5) / 6]),
);

describe('SPEC §77 cases 01–17: normal roll resolution', () => {
  it.each([
    ['01 initial no-score', results(2, 2, 3, 4, 4, 6, 6), 0, 7, 0, 0, 'turnEnd'],
    ['02 one', results(1, 2, 3, 4, 6, 2, 3), 100, 6, 0, 1, 'continue'],
    ['03 five', results(5, 2, 3, 4, 6, 2, 3), 50, 6, 0, 1, 'continue'],
    ['04 multiple scoring', results(1, 1, 5, 5, 2, 3, 6), 300, 3, 0, 4, 'continue'],
    ['07/09 one OUT without scoring', results(2, 3, 4, 6, 'out', 2, 3), 0, 6, 1, 0, 'turnEnd'],
    ['08 multiple OUT', results(1, 5, 3, 6, 2, 'out', 'out'), 150, 3, 2, 2, 'continue'],
    ['10 OUT plus one', results(1, 3, 4, 6, 'out', 2, 3), 100, 5, 1, 1, 'continue'],
    ['11 OUT plus five', results(5, 3, 4, 6, 'out', 2, 3), 50, 5, 1, 1, 'continue'],
    ['12 OUT plus one and five', results(1, 5, 4, 6, 'out', 2, 3), 150, 4, 1, 2, 'continue'],
    ['16/17 all OUT', results('out', 'out', 'out', 'out', 'out', 'out', 'out'), 0, 0, 7, 0, 'turnEnd'],
    ['all ones', results(1, 1, 1, 1, 1, 1, 1), 700, 0, 0, 7, 'complete'],
    ['all fives', results(5, 5, 5, 5, 5, 5, 5), 350, 0, 0, 7, 'complete'],
  ] as const)('%s', (_label, dice, score, activeDice, strandedDice, removedDice, outcome) => {
    const initial = Object.freeze(createTurn({ turnId: 'test-turn', totalCompletionCount: 0 }).player);
    const resolved = resolveRoll(initial, Object.freeze(dice));
    expect(resolved.player).toEqual({
      score, activeDice, strandedDice, removedDice,
      completed: outcome === 'complete', turnFinished: outcome !== 'continue',
    });
    expect(resolved.outcome).toBe(outcome);
    expect(resolved.gainedScore).toBe(score);
    expect(resolved.scoringCount).toBe(removedDice);
    expect(resolved.outCount).toBe(strandedDice);
    expect(getRemainingDice(resolved.player)).toBe(activeDice + strandedDice);
    expect(initial).toEqual(createTurn({ turnId: 'test-turn', totalCompletionCount: 0 }).player);
    assertPlayerTurn(resolved.player);
  });

  it.each([1, 5] as const)('05/06 last %i completes after previous scoring', (value) => {
    const first = resolveRoll(createTurn({ turnId: 'test-turn', totalCompletionCount: 0 }).player, results(1, 1, 1, 1, 1, 1, 2));
    const last = resolveRoll(first.player, [safe(value)]);
    expect(last.outcome).toBe('complete');
    expect(last.player).toEqual({
      score: value === 1 ? 700 : 650, activeDice: 0, strandedDice: 0,
      removedDice: 7, completed: true, turnFinished: true,
    });
  });

  it('13 last die OUT ends without completion and preserves accumulated score', () => {
    const first = resolveRoll(createTurn({ turnId: 'test-turn', totalCompletionCount: 0 }).player, results(1, 1, 1, 1, 1, 1, 2));
    const last = resolveRoll(first.player, [out]);
    expect(last.player).toEqual({
      score: 600, activeDice: 0, strandedDice: 1, removedDice: 6,
      completed: false, turnFinished: true,
    });
    expect(last.outcome).toBe('turnEnd');
    expect(getRemainingDice(last.player)).toBe(1);
  });

  it('14 last two dice five + OUT end without completion', () => {
    const first = resolveRoll(createTurn({ turnId: 'test-turn', totalCompletionCount: 0 }).player, results(1, 1, 1, 1, 1, 2, 2));
    const last = resolveRoll(first.player, results(5, 'out'));
    expect(last.player).toMatchObject({ score: 550, activeDice: 0, strandedDice: 1, removedDice: 6, completed: false, turnFinished: true });
    expect(last.outcome).toBe('turnEnd');
  });

  it('15 rerolls only active dice; earlier OUT prevents completion', () => {
    const first = rollTurn(createTurn({ turnId: 'test-turn', totalCompletionCount: 0 }), 1, sourceFor(1, 5, 3, 6, 2, 'out', 'out'), 'test-turn');
    const random = sourceFor(1, 1, 5);
    const last = rollTurn(continueTurn(first, 1, 'test-turn'), 2, random, 'test-turn');
    expect(random.calls).toBe(6);
    expect(last.player).toEqual({
      score: 400, activeDice: 0, strandedDice: 2, removedDice: 5,
      completed: false, turnFinished: true,
    });
    expect(getRemainingDice(last.player)).toBe(2);
  });

  it('a later no-score roll ends the turn without losing earlier points', () => {
    const first = resolveRoll(createTurn({ turnId: 'test-turn', totalCompletionCount: 0 }).player, results(1, 5, 2, 2, 2, 2, 2));
    const last = resolveRoll(first.player, results(2, 3, 4, 6, 'out'));
    expect(last.player).toMatchObject({ score: 150, activeDice: 4, strandedDice: 1, removedDice: 2, turnFinished: true });
    expect(last.gainedScore).toBe(0);
  });
});

describe('SPEC §77 cases 35–38: deterministic random generation', () => {
  it.each([['normal', 0.01], ['rough', 0.03]] as const)('%s uses an independent strict OUT threshold per die', (style, probability) => {
    expect(OUT_PROBABILITIES[style]).toBe(probability);
    // The generator compares with <, so just-below is OUT and the exact threshold is SAFE.
    const random = new SequenceRandom([probability - 0.000001, probability, 0, probability + 0.000001, 1 - Number.EPSILON]);
    expect(rollGameDice(3, style, random)).toEqual([out, safe(1), safe(6)]);
    expect(random.calls).toBe(5);
  });

  it('careful uses 0% OUT and still draws a D6 face for every die', () => {
    const random = new SequenceRandom(Array(14).fill(0));
    expect(OUT_PROBABILITIES.careful).toBe(0);
    expect(rollGameDice(7, 'careful', random)).toEqual(Array(7).fill(safe(1)));
    expect(random.calls).toBe(14);
  });

  it('38 defaults to normal / 1%', () => {
    expect(createTurn({ turnId: 'test-turn', totalCompletionCount: 0 }).throwStyle).toBe('normal');
    expect(rollTurn(createTurn({ turnId: 'test-turn', totalCompletionCount: 0 }), 1, new SequenceRandom(Array(7).fill(0.005)), 'test-turn').player.strandedDice).toBe(7);
  });

  it.each([0, 1, 2, 3, 4, 5])('maps the lower boundary of D6 bucket %i', (bucket) => {
    expect(rollGameDice(1, 'normal', new SequenceRandom([0.5, bucket / 6]))).toEqual([safe((bucket + 1) as DieValue)]);
  });

  it.each([1, 2, 3, 4, 5, 6])('maps just below D6 boundary %i', (boundary) => {
    expect(rollGameDice(1, 'normal', new SequenceRandom([0.5, boundary / 6 - Number.EPSILON]))).toEqual([safe(boundary as DieValue)]);
  });

  it.each([-0.01, 1, NaN, Infinity, -Infinity])('rejects invalid random input %s for OUT and D6', (value) => {
    expect(() => rollGameDice(1, 'normal', new SequenceRandom([value]))).toThrow(RangeError);
    expect(() => rollGameDice(1, 'normal', new SequenceRandom([0.5, value]))).toThrow(RangeError);
  });

  it('produces the same state from identical state and random input', () => {
    const input = createTurn({ turnId: 'test-turn', totalCompletionCount: 0 }, 'normal');
    expect(rollTurn(input, 1, sourceFor(1, 5, 2, 'out', 3, 4, 6), 'test-turn'))
      .toEqual(rollTurn(input, 1, sourceFor(1, 5, 2, 'out', 3, 4, 6), 'test-turn'));
  });
});

describe('SPEC §77 case 39: explicit, atomic turn transitions', () => {
  it('rejects duplicate rolls and stale roll numbers without drawing randomness', () => {
    const initial = Object.freeze(createTurn({ turnId: 'test-turn', totalCompletionCount: 0 }));
    const first = rollTurn(initial, 1, sourceFor(1, 2, 2, 2, 2, 2, 2), 'test-turn');
    const forbidden = new SequenceRandom([]);
    expect(first.phase).toBe('result');
    expect(rollTurn(first, 1, forbidden, 'test-turn')).toBe(first);
    expect(rollTurn(first, 2, forbidden, 'test-turn')).toBe(first);
    expect(continueTurn(first, 99, 'test-turn')).toBe(first);
    const ready = continueTurn(first, 1, 'test-turn');
    expect(ready.phase).toBe('ready');
    expect(continueTurn(ready, 1, 'test-turn')).toBe(ready);
    expect(rollTurn(ready, 1, forbidden, 'test-turn')).toBe(ready);
    expect(rollTurn(ready, 3, forbidden, 'test-turn')).toBe(ready);
    expect(forbidden.calls).toBe(0);
    const second = rollTurn(ready, 2, sourceFor(5, 2, 2, 2, 2, 2), 'test-turn');
    expect(second.player.score).toBe(150);
    expect(continueTurn(second, 1, 'test-turn')).toBe(second);
    expect(initial).toEqual(createTurn({ turnId: 'test-turn', totalCompletionCount: 0 }));
  });

  it.each([1, 2, 'out'] as const)('cannot resume or reroll a finished turn (%s)', (value) => {
    const finished = rollTurn(createTurn({ turnId: 'test-turn', totalCompletionCount: 0 }), 1, sourceFor(...Array<DieValue | 'out'>(7).fill(value)), 'test-turn');
    const forbidden = new SequenceRandom([]);
    expect(finished.player.turnFinished).toBe(true);
    expect(continueTurn(finished, 1, 'test-turn')).toBe(finished);
    expect(rollTurn(finished, 2, forbidden, 'test-turn')).toBe(finished);
    expect(forbidden.calls).toBe(0);
    expect(() => resolveRoll(finished.player, [])).toThrow();
  });

  it('keeps the input state unchanged when the random source fails mid-roll', () => {
    const initial = createTurn({ turnId: 'test-turn', totalCompletionCount: 0 });
    expect(() => rollTurn(initial, 1, sourceFor(1), 'test-turn')).toThrow('Unexpected random draw');
    expect(initial).toEqual(createTurn({ turnId: 'test-turn', totalCompletionCount: 0 }));
  });
});

describe('invalid input and invariants', () => {
  it.each([0, -1, 8, 1.5, NaN])('rejects an invalid roll count %s before drawing', (count) => {
    const random = new SequenceRandom([]);
    expect(() => rollGameDice(count, 'normal', random)).toThrow(RangeError);
    expect(random.calls).toBe(0);
  });

  it('rejects unknown throw styles', () => {
    expect(() => createTurn({ turnId: 'test-turn', totalCompletionCount: 0 }, 'invalid' as ThrowStyle)).toThrow(RangeError);
    expect(() => rollGameDice(7, 'invalid' as ThrowStyle, new SequenceRandom([]))).toThrow(RangeError);
  });

  it.each([
    { activeDice: -1 }, { activeDice: 6 }, { activeDice: 6.5, strandedDice: 0.5 },
    { score: 50 }, { completed: true },
    { activeDice: 0, removedDice: 7, score: 700, completed: true },
  ])('rejects inconsistent player state %j', (patch) => {
    const player = { ...createTurn({ turnId: 'test-turn', totalCompletionCount: 0 }).player, ...patch };
    const random = new SequenceRandom([]);
    expect(() => rollTurn({ ...createTurn({ turnId: 'test-turn', totalCompletionCount: 0 }), player }, 1, random, 'test-turn')).toThrow(RangeError);
    expect(random.calls).toBe(0);
  });

  it('rejects mismatched result counts and invalid result values', () => {
    expect(() => resolveRoll(createTurn({ turnId: 'test-turn', totalCompletionCount: 0 }).player, [safe(1)])).toThrow(RangeError);
    const invalid = { status: 'out', value: 1 } as unknown as DieResult;
    expect(() => resolveRoll(createTurn({ turnId: 'test-turn', totalCompletionCount: 0 }).player, [invalid, ...results(2, 2, 2, 2, 2, 2)])).toThrow(RangeError);
    const invalidSafe = { status: 'safe', value: 7 } as unknown as DieResult;
    expect(() => resolveRoll(createTurn({ turnId: 'test-turn', totalCompletionCount: 0 }).player, [invalidSafe, ...results(2, 2, 2, 2, 2, 2)])).toThrow(RangeError);
  });

  it('preserves invariants for all seven-die combinations of OUT, one, five and non-scoring', () => {
    // Exhaust four scoring-equivalent categories for seven dice only; keep 14-die checks representative instead of scaling this Cartesian loop.
    const choices = [out, safe(1), safe(5), safe(2)] as const;
    for (let code = 0; code < 4 ** 7; code++) {
      const dice = Array.from({ length: 7 }, (_, index) => choices[Math.floor(code / 4 ** index) % 4]!);
      const { player } = resolveRoll(createTurn({ turnId: 'test-turn', totalCompletionCount: 0 }).player, dice);
      assertPlayerTurn(player);
      if (player.strandedDice > 0 && player.completed) throw new Error('OUT must prevent completion');
    }
  });

  it('does not share mutable result objects with caller input', () => {
    const dice = results(1, 2, 2, 2, 2, 2, 2);
    const resolved = resolveRoll(createTurn({ turnId: 'test-turn', totalCompletionCount: 0 }).player, dice);
    expect(resolved.dice).not.toBe(dice);
    expect(resolved.dice[0]).not.toBe(dice[0]);
  });

  it('derives remaining dice instead of storing them independently', () => {
    const player: PlayerTurn = { score: 150, activeDice: 3, strandedDice: 2, removedDice: 2, completed: false, turnFinished: false };
    expect(getRemainingDice(player)).toBe(5);
    expect(player).not.toHaveProperty('remainingDice');
  });
});
