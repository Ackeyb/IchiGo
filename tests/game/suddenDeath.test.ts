import { describe, expect, it } from 'vitest';
import { createTurn, rollTurn } from '../../src/game/gameEngine';
import { calculateFinalRanking, calculateProvisionalRanking } from '../../src/game/ranking';
import { OUT_PROBABILITIES } from '../../src/game/rollGenerator';
import { assertPlayerTurn } from '../../src/game/rollResolver';
import { shouldStartSuddenDeath, startSuddenDeath } from '../../src/game/suddenDeath';
import type { RoundPlayer, SuddenDeathState } from '../../src/game/suddenDeath';

function player(id: string, score: number, remaining: number, stranded = 0): RoundPlayer {
  const result = {
    id, score, activeDice: remaining - stranded, strandedDice: stranded,
    removedDice: 7 - remaining, completed: remaining === 0, turnFinished: true,
  };
  assertPlayerTurn(result);
  return result;
}

function round(players: readonly RoundPlayer[]): SuddenDeathState {
  return {
    rollLimit: null,
    participants: players.map(({ id }) => ({ id, name: `名前${id}` })),
    players,
    currentPlayerIndex: players.length - 1,
    throwStyle: 'normal',
    diceMode: 7,
    totalCompletionCount: players.filter((p) => p.completed).length,
    suddenDeathCount: 0,
  };
}

describe('SPEC §77 cases 23–24: sudden death eligibility', () => {
  it('23: two completers qualify regardless of score', () => {
    expect(shouldStartSuddenDeath([player('a', 350, 0), player('b', 700, 0)])).toBe(true);
  });
  it('23: ten completers qualify', () => {
    const players = Array.from({ length: 10 }, (_, i) => player(String(i), 350 + (i % 8) * 50, 0));
    expect(shouldStartSuddenDeath(players)).toBe(true);
    expect(startSuddenDeath(round(players), 0).players).toHaveLength(10);
  });
  it('24: all non-completers tied on score and remaining dice qualify', () => {
    expect(shouldStartSuddenDeath([player('a', 200, 3), player('b', 200, 3)])).toBe(true);
  });
  it('24: OUT/active breakdown does not affect the tie', () => {
    expect(shouldStartSuddenDeath([player('a', 200, 3, 3), player('b', 200, 3)])).toBe(true);
  });
  it.each([
    ['different remaining dice', [player('a', 200, 3), player('b', 200, 5)]],
    ['different scores', [player('a', 200, 3), player('b', 300, 3)]],
    ['only some completed', [player('a', 350, 0), player('b', 350, 1)]],
    ['only the bottom players tie', [player('a', 300, 3), player('b', 200, 3), player('c', 200, 3)]],
  ] as const)('does not qualify with %s', (_label, players) => {
    expect(shouldStartSuddenDeath(players)).toBe(false);
    const state = round(players);
    expect(startSuddenDeath(state, 0)).toBe(state);
  });
  it('does not treat initial zero-score states or in-progress turns as completed ties', () => {
    const initial = createTurn({ turnId: 'test-turn', totalCompletionCount: 0 }).player;
    expect(shouldStartSuddenDeath([initial, initial])).toBe(false);
    const state = round([player('a', 0, 7), { ...initial, id: 'b' }]);
    expect(shouldStartSuddenDeath(state.players)).toBe(false);
    expect(startSuddenDeath(state, 0)).toBe(state);
  });
  it.each([0, 1, 11])('does not qualify with %i players', (count) => {
    expect(shouldStartSuddenDeath(Array.from({ length: count }, (_, i) => player(String(i), 350, 0)))).toBe(false);
  });
});

describe('SPEC §77 cases 25–28: explicit round reset', () => {
  it('25/26: rebuilds every player in original order and drops previous round results', () => {
    const base = round([player('z', 200, 3, 1), player('a', 200, 3, 2), player('m', 200, 3)]);
    const state = {
      ...base,
      players: [...base.players].reverse().map((p) => ({ ...p, rank: 1, lastRoll: ['out'] })),
      rankings: calculateFinalRanking(base.players).rankings,
      loserIds: ['z', 'a', 'm'],
      totalCompletionCount: 6,
    };
    const next = startSuddenDeath(state, 0);
    expect(next.participants).toEqual(base.participants);
    expect(next.players.map((p) => p.id)).toEqual(['z', 'a', 'm']);
    expect(next.currentPlayerIndex).toBe(0);
    for (const p of next.players) {
      expect(p).toEqual({ id: p.id, score: 0, activeDice: 7, strandedDice: 0, removedDice: 0, completed: false, turnFinished: false });
      assertPlayerTurn(p);
      expect(p).not.toHaveProperty('rank');
      expect(p).not.toHaveProperty('lastRoll');
    }
    expect(next).not.toHaveProperty('rankings');
    expect(next).not.toHaveProperty('loserIds');
    expect(calculateProvisionalRanking(next.players)).toEqual({ rankings: [], bottomIds: [] });
    expect(shouldStartSuddenDeath(next.players)).toBe(false);
  });
  it('resets completion flags after an all-complete round', () => {
    const next = startSuddenDeath(round([player('a', 350, 0), player('b', 700, 0)]), 0);
    expect(next.players.every((p) => !p.completed && !p.turnFinished && p.activeDice === 7)).toBe(true);
    expect(next.totalCompletionCount).toBe(2);
  });
  it.each([0, 2, 10, 27])('27: preserves committed completion count %i without adding again', (count) => {
    const state = { ...round([player('a', 200, 3), player('b', 200, 3)]), totalCompletionCount: count };
    expect(startSuddenDeath(state, 0).totalCompletionCount).toBe(count);
  });
  it.each(['careful', 'normal', 'rough'] as const)('preserves %s and its OUT probability', (throwStyle) => {
    const state = { ...round([player('a', 350, 0), player('b', 700, 0)]), throwStyle };
    const next = startSuddenDeath(state, 0);
    expect(next.throwStyle).toBe(throwStyle);
    expect(OUT_PROBABILITIES[next.throwStyle]).toBe(OUT_PROBABILITIES[throwStyle]);
    expect(next).not.toHaveProperty('outProbability');
  });
  it('28: supports repeated rounds without losing players, order or cumulative completions', () => {
    let state = round([player('b', 350, 0), player('a', 700, 0)]);
    for (let count = 0; count < 5; count++) {
      const next = startSuddenDeath(state, count);
      expect(next.suddenDeathCount).toBe(count + 1);
      expect(next.totalCompletionCount).toBe(2);
      expect(next.players.map((p) => p.id)).toEqual(['b', 'a']);
      // Resolve a round where every player ends on an all-OUT, no-score turn.
      state = {
        ...next,
        players: next.players.map(({ id }) => ({ id, ...rollTurn(createTurn({ turnId: 'test-turn', totalCompletionCount: 0 }, next.throwStyle), 1, { next: () => 0 }, 'test-turn').player })),
        currentPlayerIndex: 1,
      };
    }
    expect(state.suddenDeathCount).toBe(5);
  });
  it('starts counting from the supplied count instead of resetting to one', () => {
    const state = { ...round([player('a', 0, 7), player('b', 0, 7)]), suddenDeathCount: 12 };
    expect(startSuddenDeath(state, 12).suddenDeathCount).toBe(13);
  });
  it('rejects duplicate and stale start commands', () => {
    const state = round([player('a', 0, 7), player('b', 0, 7)]);
    expect(startSuddenDeath(state, 1)).toBe(state);
    const next = startSuddenDeath(state, 0);
    expect(startSuddenDeath(next, 0)).toBe(next);
    expect(startSuddenDeath(next, 1)).toBe(next);
    const ended = { ...next, players: state.players };
    expect(startSuddenDeath(ended, 0)).toBe(ended);
    expect(startSuddenDeath(ended, 1).suddenDeathCount).toBe(2);
  });
  it('is deterministic and leaves frozen inputs untouched', () => {
    const base = round([player('a', 200, 3, 1), player('b', 200, 3, 2)]);
    const state = Object.freeze({ ...base,
      participants: Object.freeze(base.participants.map((p) => Object.freeze(p))),
      players: Object.freeze(base.players.map((p) => Object.freeze(p))),
    });
    const snapshot = structuredClone(state);
    const next = startSuddenDeath(state, 0);
    expect(next).toEqual(startSuddenDeath(state, 0));
    expect(state).toEqual(snapshot);
    expect(next.players[0]).not.toBe(state.players[0]);
    expect(next.participants[0]).not.toBe(state.participants[0]);
  });
  it('does not carry old ranking into the next finished round', () => {
    const state = round([player('a', 700, 0), player('b', 350, 0)]);
    const next = startSuddenDeath(state, 0);
    const first = next.players[0]!;
    const second = next.players[1]!;
    const ranking = calculateFinalRanking([
      { ...first, ...rollTurn(createTurn({ turnId: 'test-turn', totalCompletionCount: 0 }), 1, { next: () => 0 }, 'test-turn').player },
      { ...second, ...player(second.id, 350, 0) },
    ]);
    expect(ranking.rankings).toEqual([{ playerId: 'b', rank: 1 }, { playerId: 'a', rank: 2 }]);
  });
});

describe('round input integrity', () => {
  const state = round([player('a', 0, 7), player('b', 0, 7)]);
  it('rejects omitted, duplicate or foreign players rather than resetting a subset', () => {
    for (const players of [[state.players[0]!], [state.players[0]!, state.players[0]!], [state.players[0]!, player('other', 0, 7)]]) {
      expect(() => startSuddenDeath({ ...state, players }, 0)).toThrow('every original participant');
    }
  });
  it('rejects duplicate roster IDs', () => {
    expect(() => startSuddenDeath({ ...state, participants: [state.participants[0]!, state.participants[0]!] }, 0)).toThrow();
  });
  it.each([-1, 0.5, NaN, Infinity])('rejects invalid counters %s', (count) => {
    expect(() => startSuddenDeath({ ...state, totalCompletionCount: count }, 0)).toThrow(RangeError);
    expect(() => startSuddenDeath({ ...state, suddenDeathCount: count }, count)).toThrow(RangeError);
  });
  it('rejects inconsistent player dice state', () => {
    expect(() => shouldStartSuddenDeath([{ ...state.players[0]!, activeDice: 6 }, state.players[1]!])).toThrow(RangeError);
  });
});
