import { describe, expect, it } from 'vitest';
import { createTurn } from '../../src/game/gameEngine';
import { advanceFlow, initialFlow } from '../../src/game/gameFlow';
import { calculatePenalty, createPenaltyState, rollPenaltyDice } from '../../src/game/penalty';
import { calculateFinalRanking } from '../../src/game/ranking';
import type { RandomSource } from '../../src/game/randomSource';
import { assertPlayerTurn, resolveRoll } from '../../src/game/rollResolver';
import { startSuddenDeath } from '../../src/game/suddenDeath';
import type { SuddenDeathState } from '../../src/game/suddenDeath';
import type { DiceMode, DieResult, DieValue, PlayerTurn } from '../../src/game/types';

const safe = (value: DieValue): DieResult => ({ status: 'safe', value });
const out: DieResult = { status: 'out', value: null };

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
  it.each([5, 7, 10] as const)('initializes %i active dice from authoritative configuration', (diceMode) => {
    const turn = createTurn({ turnId: `turn-${diceMode}`, totalCompletionCount: 0, diceMode });
    expect(turn.player).toEqual({
      score: 0, activeDice: diceMode, strandedDice: 0, removedDice: 0,
      completed: false, turnFinished: false,
    });
    assertPlayerTurn(turn.player, diceMode);
  });

  it.each([5, 7, 10] as const)('keeps counts totaling %i after score and OUT resolution', (diceMode) => {
    const dice = [safe(1), safe(5), out, out, ...Array.from({ length: diceMode - 4 }, () => safe(2))];
    const result = resolveRoll(playerFor(diceMode), dice, diceMode);
    expect(result.player.activeDice + result.player.strandedDice + result.player.removedDice).toBe(diceMode);
    expect(result.player).toMatchObject({ score: 150, activeDice: diceMode - 4, strandedDice: 2, removedDice: 2 });
    assertPlayerTurn(result.player, diceMode);
  });

  it.each([5, 7, 10] as const)('handles representative scoring and no-score rolls for %i dice', (diceMode) => {
    const scoring = resolveRoll(
      playerFor(diceMode),
      [safe(1), safe(5), safe(1), ...Array.from({ length: diceMode - 3 }, () => safe(2))],
      diceMode,
    );
    expect(scoring).toMatchObject({ gainedScore: 250, scoringCount: 3, outcome: 'continue' });
    const noScore = resolveRoll(playerFor(diceMode), Array.from({ length: diceMode }, () => safe(2)), diceMode);
    expect(noScore).toMatchObject({ gainedScore: 0, outcome: 'turnEnd' });
  });

  it.each([[5, 1], [5, 5], [7, 1], [7, 5], [10, 1], [10, 5]] as const)(
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

  it.each([[5, 6], [7, 8], [10, 11]] as const)('rejects %i DICE state totaling %i', (diceMode, total) => {
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
});

describe('Dice Mode round and penalty propagation', () => {
  it.each([5, 7, 10] as const)('carries %i DICE from setup to the next player turn', (diceMode) => {
    const setup = {
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

  it.each([5, 7, 10] as const)('preserves %i DICE through sudden death', (diceMode) => {
    const complete = (id: string) => ({
      id, score: diceMode * 50, activeDice: 0, strandedDice: 0, removedDice: diceMode,
      completed: true, turnFinished: true,
    });
    const state: SuddenDeathState = {
      participants: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }],
      players: [complete('a'), complete('b')], currentPlayerIndex: 1,
      throwStyle: 'rough', diceMode, totalCompletionCount: 2, suddenDeathCount: 0,
    };
    const next = startSuddenDeath(state, 0);
    expect(next.diceMode).toBe(diceMode);
    expect(next.throwStyle).toBe('rough');
    expect(next.players.every((player) => player.activeDice === diceMode)).toBe(true);
  });

  it.each([8, 9, 10] as const)('accepts %i penalty dice in 10 DICE', (count) => {
    const random = new SequenceRandom(Array<number>(count).fill(0));
    expect(rollPenaltyDice(count, random, 10)).toEqual(Array<number>(count).fill(1));
    expect(calculatePenalty(Array<DieValue>(count).fill(6), 0, 10).basePenalty).toBe(count * 6);
    expect(random.calls).toBe(count);
  });

  it.each([[5, 6], [7, 8], [10, 11]] as const)('rejects penalty count %i above mode %i', (diceMode, count) => {
    expect(() => rollPenaltyDice(count, new SequenceRandom([]), diceMode)).toThrow(RangeError);
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
});
