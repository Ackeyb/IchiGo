import { describe, expect, it } from 'vitest';
import { createTurn } from '../../src/game/gameEngine';
import { advanceFlow, initialFlow } from '../../src/game/gameFlow';
import { calculatePenalty, createPenaltyState, rollPenaltyDice } from '../../src/game/penalty';
import { calculateFinalRanking } from '../../src/game/ranking';
import type { RandomSource } from '../../src/game/randomSource';
import { assertPlayerTurn, resolveRoll } from '../../src/game/rollResolver';
import { rollGameDice } from '../../src/game/rollGenerator';
import { startSuddenDeath } from '../../src/game/suddenDeath';
import type { SuddenDeathState } from '../../src/game/suddenDeath';
import { DEFAULT_DICE_MODE, isDiceMode } from '../../src/game/types';
import type { DiceMode, DieResult, DieValue, PlayerTurn } from '../../src/game/types';

const safe = (value: DieValue): DieResult => ({ status: 'safe', value });
const out: DieResult = { status: 'out', value: null };
const modes = [5, 7, 10, 14] as const;

class SequenceRandom implements RandomSource {
  calls = 0;
  constructor(private readonly values: readonly number[]) {}
  next(): number {
    const value = this.values[this.calls++];
    if (value === undefined) throw new Error('Unexpected random draw.');
    return value;
  }
}

function playerFor(diceMode: DiceMode, patch: Partial<PlayerTurn> = {}): PlayerTurn {
  return { ...createTurn({ turnId: `turn-${diceMode}`, totalCompletionCount: 0, diceMode }).player, ...patch };
}

describe('Dice Mode initialization and invariants', () => {
  it('keeps 7 as the default and recognizes only the four explicit modes', () => {
    expect(DEFAULT_DICE_MODE).toBe(7);
    expect(isDiceMode(14)).toBe(true);
    expect(isDiceMode(15)).toBe(false);
  });

  it.each(modes)('initializes %i active dice from authoritative configuration', (diceMode) => {
    const turn = createTurn({ turnId: `turn-${diceMode}`, totalCompletionCount: 0, diceMode });
    expect(turn.player).toEqual({
      score: 0, activeDice: diceMode, strandedDice: 0, removedDice: 0,
      completed: false, turnFinished: false,
    });
    assertPlayerTurn(turn.player, diceMode);
  });

  it.each(modes)('keeps counts totaling %i after score and OUT resolution', (diceMode) => {
    const dice = [safe(1), safe(5), out, out, ...Array.from({ length: diceMode - 4 }, () => safe(2))];
    const result = resolveRoll(playerFor(diceMode), dice, diceMode);
    expect(result.player.activeDice + result.player.strandedDice + result.player.removedDice).toBe(diceMode);
    expect(result.player).toMatchObject({ score: 150, activeDice: diceMode - 4, strandedDice: 2, removedDice: 2 });
    assertPlayerTurn(result.player, diceMode);
  });

  it.each(modes)('handles representative scoring and no-score rolls for %i dice', (diceMode) => {
    const scoring = resolveRoll(
      playerFor(diceMode),
      [safe(1), safe(5), safe(1), ...Array.from({ length: diceMode - 3 }, () => safe(2))],
      diceMode,
    );
    expect(scoring).toMatchObject({ gainedScore: 250, scoringCount: 3, outcome: 'continue' });
    const noScore = resolveRoll(playerFor(diceMode), Array.from({ length: diceMode }, () => safe(2)), diceMode);
    expect(noScore).toMatchObject({ gainedScore: 0, outcome: 'turnEnd' });
  });

  it.each([[5, 1], [5, 5], [7, 1], [7, 5], [10, 1], [10, 5], [14, 1], [14, 5]] as const)(
    'completes %i DICE when the final active die is %i', (diceMode, value) => {
    const last = playerFor(diceMode, {
      score: (diceMode - 1) * 50, activeDice: 1, removedDice: diceMode - 1,
    });
    expect(resolveRoll(last, [safe(value)], diceMode).outcome).toBe('complete');
    const stranded = playerFor(diceMode, {
      score: (diceMode - 2) * 50, activeDice: 1, strandedDice: 1, removedDice: diceMode - 2,
    });
    const ended = resolveRoll(stranded, [safe(5)], diceMode);
    expect(ended).toMatchObject({ outcome: 'turnEnd', player: { completed: false, activeDice: 0, strandedDice: 1 } });
  });

  it.each([[5, 6], [7, 8], [10, 11], [14, 15]] as const)('rejects %i DICE state totaling %i', (diceMode, total) => {
    expect(() => assertPlayerTurn({
      score: 0, activeDice: total, strandedDice: 0, removedDice: 0,
      completed: false, turnFinished: false,
    }, diceMode)).toThrow(RangeError);
  });

  it('validates ranking players against the explicit mode without adding a mode tiebreaker', () => {
    const tied = [
      { id: 'a', ...playerFor(5, { score: 100, activeDice: 2, strandedDice: 1, removedDice: 2, turnFinished: true }) },
      { id: 'b', ...playerFor(5, { score: 100, activeDice: 3, strandedDice: 0, removedDice: 2, turnFinished: true }) },
    ];
    expect(calculateFinalRanking(tied, 5).rankings).toEqual([
      { playerId: 'a', rank: 1 }, { playerId: 'b', rank: 1 },
    ]);
    expect(() => calculateFinalRanking(tied, 7)).toThrow(RangeError);
  });

  it('accepts 14 DICE ranking state using only the existing ranking fields', () => {
    const players = [
      { id: 'a', ...playerFor(14, { score: 150, activeDice: 10, strandedDice: 1, removedDice: 3, turnFinished: true }) },
      { id: 'b', ...playerFor(14, { score: 150, activeDice: 11, strandedDice: 0, removedDice: 3, turnFinished: true }) },
    ];
    expect(calculateFinalRanking(players, 14).rankings).toEqual([
      { playerId: 'a', rank: 1 }, { playerId: 'b', rank: 1 },
    ]);
  });
});

describe('Dice Mode round and penalty propagation', () => {
  it.each(modes)('carries %i DICE from setup to the next player turn', (diceMode) => {
    const setup = {
      rollLimit: null,
      participants: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }],
      throwStyle: 'careful' as const,
      diceMode,
    };
    const started = advanceFlow(initialFlow(), 0, { type: 'start', setup }, new SequenceRandom([]));
    if (started.phase !== 'turn') throw new Error('Expected turn state.');
    expect(started.game.diceMode).toBe(diceMode);
    expect(started.turn.player.activeDice).toBe(diceMode);
    const rolled = advanceFlow(
      started,
      started.revision,
      { type: 'roll' },
      new SequenceRandom(Array.from({ length: diceMode * 2 }, (_, index) => index % 2 === 0 ? 0.5 : 0.25)),
    );
    const next = advanceFlow(rolled, rolled.revision, { type: 'next' }, new SequenceRandom([]));
    if (next.phase !== 'turn') throw new Error('Expected next turn state.');
    expect(next.turn.player.activeDice).toBe(diceMode);
  });

  it.each(modes)('preserves %i DICE through sudden death', (diceMode) => {
    const complete = (id: string) => ({
      id, score: diceMode * 50, activeDice: 0, strandedDice: 0, removedDice: diceMode,
      completed: true, turnFinished: true,
    });
    const state: SuddenDeathState = {
      rollLimit: null,
      participants: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }],
      players: [complete('a'), complete('b')], currentPlayerIndex: 1,
      throwStyle: 'rough', diceMode, totalCompletionCount: 2, suddenDeathCount: 0,
    };
    const next = startSuddenDeath(state, 0);
    expect(next.diceMode).toBe(diceMode);
    expect(next.throwStyle).toBe('rough');
    expect(next.players.every((player) => player.activeDice === diceMode)).toBe(true);
    expect(next.players.every((player) => player.strandedDice === 0 && player.removedDice === 0)).toBe(true);
    expect(next.totalCompletionCount).toBe(2);
  });

  it.each([8, 9, 10] as const)('accepts %i penalty dice in 10 DICE', (count) => {
    const random = new SequenceRandom(Array.from({ length: count }, () => [0.9, 0]).flat());
    expect(rollPenaltyDice(count, random, 10)).toEqual(Array<DieResult>(count).fill(safe(1)));
    expect(calculatePenalty(Array<DieResult>(count).fill(safe(6)), 0, 10).basePenalty).toBe(count * 6);
    expect(random.calls).toBe(count * 2);
  });

  it.each([[5, 6], [7, 8], [10, 11]] as const)('rejects penalty count %i above mode %i', (diceMode, count) => {
    expect(() => rollPenaltyDice(count, new SequenceRandom([]), diceMode)).toThrow(RangeError);
  });

  it('accepts 14 penalty dice and rejects a fifteenth die', () => {
    const random = new SequenceRandom(Array.from({ length: 14 }, () => [0.9, 0]).flat());
    expect(rollPenaltyDice(14, random, 14)).toEqual(Array<DieResult>(14).fill(safe(1)));
    expect(calculatePenalty(Array<DieResult>(14).fill(safe(6)), 0, 14).basePenalty).toBe(84);
    expect(random.calls).toBe(28);
    expect(() => rollPenaltyDice(15, new SequenceRandom([]), 14)).toThrow(RangeError);
    expect(() => calculatePenalty(Array<DieResult>(15).fill(safe(1)), 0, 14)).toThrow(RangeError);
  });

  it('uses decisive 10 DICE remaining count without inferring the mode', () => {
    const round = {
      participants: [{ id: 'winner', name: 'W' }, { id: 'loser', name: 'L' }],
      players: [
        { id: 'winner', score: 500, activeDice: 0, strandedDice: 0, removedDice: 10, completed: true, turnFinished: true },
        { id: 'loser', score: 0, activeDice: 7, strandedDice: 3, removedDice: 0, completed: false, turnFinished: true },
      ],
      totalCompletionCount: 1,
      diceMode: 10 as const,
    };
    expect(createPenaltyState(round, 'penalty-10').penalties).toEqual([
      { playerId: 'loser', diceCount: 10, status: 'pending' },
    ]);
  });

  it('uses decisive 14 DICE remaining count for penalty dice', () => {
    const round = {
      participants: [{ id: 'winner', name: 'W' }, { id: 'loser', name: 'L' }],
      players: [
        { id: 'winner', score: 700, activeDice: 0, strandedDice: 0, removedDice: 14, completed: true, turnFinished: true },
        { id: 'loser', score: 0, activeDice: 9, strandedDice: 5, removedDice: 0, completed: false, turnFinished: true },
      ],
      totalCompletionCount: 1,
      diceMode: 14 as const,
    };
    expect(createPenaltyState(round, 'penalty-14').penalties).toEqual([
      { playerId: 'loser', diceCount: 14, status: 'pending' },
    ]);
  });

  it('validates 14 DICE roll generation boundary and deterministic OUT/scoring resolution', () => {
    const random = new SequenceRandom(Array.from({ length: 14 }, (_, index) => index === 4 || index === 11
      ? [0]
      : [0.5, (index % 6 + 0.5) / 6]).flat());
    const dice = rollGameDice(14, 'rough', random, 14);
    expect(dice).toHaveLength(14);
    expect(dice.filter((die) => die.status === 'out')).toHaveLength(2);
    expect(() => rollGameDice(15, 'careful', new SequenceRandom([]), 14)).toThrow(RangeError);
    const resolution = resolveRoll(playerFor(14), [safe(1), safe(5), out, out, ...Array.from({ length: 10 }, () => safe(2))], 14);
    expect(resolution).toMatchObject({ gainedScore: 150, scoringCount: 2, outCount: 2, outcome: 'continue' });
    expect(resolution.player).toMatchObject({ score: 150, activeDice: 10, strandedDice: 2, removedDice: 2 });
    expect(resolution.player.activeDice + resolution.player.strandedDice + resolution.player.removedDice).toBe(14);
    assertPlayerTurn(resolution.player, 14);
    const noScore = resolveRoll(playerFor(14), Array.from({ length: 14 }, () => safe(2)), 14);
    expect(noScore).toMatchObject({ gainedScore: 0, outcome: 'turnEnd', player: { activeDice: 14, strandedDice: 0, removedDice: 0 } });
    const complete = resolveRoll(playerFor(14), Array.from({ length: 14 }, () => safe(1)), 14);
    expect(complete).toMatchObject({ gainedScore: 1400, outcome: 'complete', player: { activeDice: 0, strandedDice: 0, removedDice: 14, completed: true } });
    assertPlayerTurn(complete.player, 14);
  });
});
