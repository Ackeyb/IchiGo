import { describe, expect, it } from 'vitest';
import { continueTurn, createTurn, rollTurn } from '../../src/game/gameEngine';
import { calculatePenalty, createPenaltyState, rollPenalty } from '../../src/game/penalty';
import { calculateFinalRanking, calculateProvisionalRanking } from '../../src/game/ranking';
import { assertPlayerTurn, getRemainingDice, resolveRoll } from '../../src/game/rollResolver';
import { shouldStartSuddenDeath, startSuddenDeath } from '../../src/game/suddenDeath';
import type { SuddenDeathState } from '../../src/game/suddenDeath';
import type { DieValue, TurnState } from '../../src/game/types';

function initial(turnId = 'game/round/player'): TurnState {
  return {
    turnId, totalCompletionCount: 2, phase: 'ready', throwStyle: 'normal', nextRollNumber: 1,
    player: { score: 0, activeDice: 7, strandedDice: 0, removedDice: 0, completed: false, turnFinished: false },
  };
}

describe('STEP 7 audit regressions', () => {
  it('SPEC 77/29: commits a decisive-round completion to the cumulative count exactly once', () => {
    const state = initial();
    let draws = 0;
    const result = rollTurn(state, 1, { next: () => draws++ % 2 === 0 ? 0.9 : 0 }, state.turnId);
    expect(result.player.completed).toBe(true);
    expect(result.totalCompletionCount).toBe(3);
    expect(rollTurn(result, 1, { next: () => { throw new Error('Duplicate draw'); } }, state.turnId)).toBe(result);
    expect(state.totalCompletionCount).toBe(2);
  });

  it('rejects an old turn request even when its roll number matches the current turn', () => {
    const state = initial('game/round/next-player');
    let draws = 0;
    expect(rollTurn(state, 1, { next: () => { draws++; return 0; } }, 'game/round/old-player')).toBe(state);
    expect(draws).toBe(0);
  });

  it('rejects a stale penalty request for the same player in a different penalty phase', () => {
    const state = {
      penaltyId: 'new-game/penalty', totalCompletionCount: 0,
      penalties: [{ playerId: 'a', diceCount: 7, status: 'pending' as const }],
    };
    let draws = 0;
    expect(rollPenalty(state, 'a', { next: () => { draws++; return 0; } }, 'old-game/penalty')).toBe(state);
    expect(draws).toBe(0);
  });

  it('rejects a stale continuation request with a matching roll number', () => {
    const state = initial('new-turn');
    let draws = 0;
    const result = rollTurn(state, 1, { next: () => {
      const index = draws++;
      return index % 2 === 0 ? 0.9 : index === 1 ? 0 : 0.3;
    } }, state.turnId);
    expect(result.phase).toBe('result');
    expect(continueTurn(result, 1, 'old-turn')).toBe(result);
  });

  it('rejects missing penalty faces instead of accepting a zero-point penalty', () => {
    expect(() => calculatePenalty(new Array<DieValue>(1), 0)).toThrow(RangeError);
  });
});

describe('cross-phase audit', () => {
  it.each([2, 10])('carries actual completions across repeated sudden death to penalties with %i players', (count) => {
    const participants = Array.from({ length: count }, (_, i) => ({ id: `p${i}`, name: '同名' }));
    let round: SuddenDeathState = {
      participants, players: participants.map(({ id }) => ({ ...initial().player, id })),
      currentPlayerIndex: 0, throwStyle: 'careful', totalCompletionCount: 0, suddenDeathCount: 0,
    };
    const original = structuredClone(round);
    for (let roundIndex = 0; roundIndex < 3; roundIndex++) {
      for (let i = 0; i < count; i++) {
        const id = participants[i]!.id;
        const turnId = `game/${roundIndex}/${id}`;
        const state = createTurn({ turnId, totalCompletionCount: round.totalCompletionCount }, round.throwStyle);
        // Two all-complete rounds, then only the last participant completes.
        const completes = roundIndex < 2 || i === count - 1;
        let draws = 0;
        const resolved = rollTurn(state, 1, { next: () => completes ? (draws++ % 2 === 0 ? 0.9 : 0) : 0 }, turnId);
        round = {
          ...round, currentPlayerIndex: i, totalCompletionCount: resolved.totalCompletionCount,
          players: round.players.map((p) => p.id === id ? { id, ...resolved.player } : p),
        };
        expect(round.totalCompletionCount).toBe(roundIndex < 2 ? roundIndex * count + i + 1 : 2 * count + (completes ? 1 : 0));
      }
      if (roundIndex < 2) {
        expect(shouldStartSuddenDeath(round.players)).toBe(true);
        const next = startSuddenDeath(round, roundIndex);
        expect(next.totalCompletionCount).toBe((roundIndex + 1) * count);
        expect(next.throwStyle).toBe('careful');
        expect(next.players.map((p) => p.id)).toEqual(participants.map((p) => p.id));
        expect(calculateProvisionalRanking(next.players).rankings).toEqual([]);
        expect(startSuddenDeath(next, roundIndex)).toBe(next);
        round = next;
      }
    }
    expect(shouldStartSuddenDeath(round.players)).toBe(false);
    expect(round.totalCompletionCount).toBe(2 * count + 1);
    const loserIds = participants.slice(0, -1).map((p) => p.id);
    expect(calculateFinalRanking(round.players).loserIds).toEqual(loserIds);
    const snapshot = structuredClone(round);
    let penalty = createPenaltyState(round, 'game/penalty');
    for (const [index, id] of loserIds.entries()) {
      let draws = 0;
      penalty = rollPenalty(penalty, id, { next: () => { draws++; return (index % 6 + 0.5) / 6; } }, 'game/penalty');
      expect(draws).toBe(7);
      expect(penalty.penalties[index]).toMatchObject({
        status: 'resolved', basePenalty: 7 * (index % 6 + 1), multiplier: 2 * count + 2,
        finalPenalty: 7 * (index % 6 + 1) * (2 * count + 2),
      });
      expect(rollPenalty(penalty, id, { next: () => { throw new Error('Duplicate draw'); } }, 'game/penalty')).toBe(penalty);
    }
    expect(round).toEqual(snapshot);
    expect(original.totalCompletionCount).toBe(0);
  });

  it('preserves the cumulative count through continuation and non-completion, without mutating frozen input', () => {
    const initialState = Object.freeze({ ...initial(), player: Object.freeze(initial().player) });
    const snapshot = structuredClone(initialState);
    let draws = 0;
    const result = rollTurn(initialState, 1, { next: () => {
      const index = draws++;
      return index % 2 === 0 ? 0.9 : index === 1 ? 0 : 0.3;
    } }, initialState.turnId);
    const ready = continueTurn(result, 1, initialState.turnId);
    const ended = rollTurn(ready, 2, { next: () => 0 }, initialState.turnId);
    expect(ready.totalCompletionCount).toBe(2);
    expect(ended.totalCompletionCount).toBe(2);
    expect(ended.player).toMatchObject({ activeDice: 0, strandedDice: 6, completed: false, turnFinished: true });
    expect(initialState).toEqual(snapshot);
  });

  it.each([-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER])('rejects invalid cumulative count %s before drawing', (totalCompletionCount) => {
    const state = { ...initial(), totalCompletionCount };
    let draws = 0;
    expect(() => createTurn({ turnId: 'turn', totalCompletionCount })).toThrow(RangeError);
    expect(() => rollTurn(state, 1, { next: () => { draws++; return 0; } }, state.turnId)).toThrow(RangeError);
    expect(draws).toBe(0);
  });

  it('requires explicit nonempty operation IDs at initialization', () => {
    expect(() => createTurn({ turnId: '', totalCompletionCount: 0 })).toThrow(RangeError);
    expect(() => createPenaltyState({ participants: [], players: [], totalCompletionCount: 0 }, '')).toThrow(RangeError);
  });

  it('preserves invariants throughout every reachable roll-resolution state', () => {
    const pending = [initial().player];
    const visited = new Set<string>();
    while (pending.length) {
      const state = pending.pop()!;
      const key = JSON.stringify(state);
      if (visited.has(key)) continue;
      visited.add(key);
      assertPlayerTurn(state);
      expect(state.activeDice + state.strandedDice + state.removedDice).toBe(7);
      expect(getRemainingDice(state)).toBe(7 - state.removedDice);
      expect(state.completed).toBe(state.activeDice === 0 && state.strandedDice === 0);
      if (state.turnFinished) continue;
      for (let outs = 0; outs <= state.activeDice; outs++) {
        for (let ones = 0; ones <= state.activeDice - outs; ones++) {
          for (let fives = 0; fives <= state.activeDice - outs - ones; fives++) {
            const dice = [
              ...Array.from({ length: outs }, () => ({ status: 'out' as const, value: null })),
              ...Array.from({ length: ones }, () => ({ status: 'safe' as const, value: 1 as const })),
              ...Array.from({ length: fives }, () => ({ status: 'safe' as const, value: 5 as const })),
              ...Array.from({ length: state.activeDice - outs - ones - fives }, () => ({ status: 'safe' as const, value: 2 as const })),
            ];
            const result = resolveRoll(state, dice);
            if (result.outcome === 'continue') expect(result.player.activeDice).toBeLessThan(state.activeDice);
            pending.push(result.player);
          }
        }
      }
    }
    expect(visited.size).toBeGreaterThan(100);
  });
});
