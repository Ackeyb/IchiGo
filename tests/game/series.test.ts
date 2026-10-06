import { describe, expect, it } from 'vitest';
import { advanceFlow, initialFlow } from '../../src/game/gameFlow';
import type { FlowAction, FlowState } from '../../src/game/gameFlow';
import { initialSetup } from '../../src/game/setup';
import type { Setup } from '../../src/game/setup';
import { isSeriesState } from '../../src/game/series';
import { calculateSeriesRanking } from '../../src/game/seriesRanking';
import type { DiceMode, RollLimit, SeriesGameCount } from '../../src/game/types';
import { createGameStore } from '../../src/app/gameStore';
import { SessionRecovery, SESSION_GAME_KEY, validateStoredFlowState } from '../../src/storage/sessionRecovery';

const noDraw = { next: (): number => { throw new Error('Unexpected random draw'); } };
const draft = (gameCount: SeriesGameCount = 2, rollLimit: RollLimit = null, diceMode: DiceMode = 5, count = 2): Setup => ({
  ...initialSetup(), mode: { type: 'series', gameCount }, rollLimit, diceMode,
  participants: Array.from({ length: count }, (_, i) => ({ id: `p${i}`, name: `P${i}` })),
});
const start = (setup = draft()) => advanceFlow(initialFlow(), 0, { type: 'start', setup }, noDraw);
const act = (state: FlowState, action: FlowAction) => advanceFlow(state, state.revision, action, noDraw);
function series(state: FlowState) {
  if (state.phase === 'setup' || state.phase === 'replayPreparation' || !isSeriesState(state.game)) throw new Error('Series expected');
  return state.game;
}
const all = (face: number, count = 5) => Array<number>(count).fill(face);
function roll(state: FlowState, faces: readonly number[]) {
  const draws = faces.flatMap((face) => face === 0 ? [0] : [0.9, (face - 0.5) / 6]);
  let calls = 0;
  const next = advanceFlow(state, state.revision, { type: 'roll' }, { next: () => {
    const draw = draws[calls++]; if (draw === undefined) throw new Error('Extra draw'); return draw;
  } });
  expect(calls).toBe(draws.length);
  return next;
}
function endGame(state: FlowState, face = 2) {
  const count = series(state).participants.length;
  for (let i = 0; i < count; i++) {
    state = roll(state, all(face, series(state).diceMode));
    if (i < count - 1) state = act(state, { type: 'next' });
  }
  return state;
}
function nextGame(state: FlowState) {
  return act(act(state, { type: 'ranking' }), { type: 'nextSeriesGame', currentGameNumber: series(state).currentGameNumber });
}
function storageFor(state: FlowState, version = 4) {
  const values = new Map([[SESSION_GAME_KEY, JSON.stringify({ version, state })]]);
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); } };
  return storage;
}
function restored(state: FlowState) {
  const storage = storageFor(state);
  const recovery = new SessionRecovery(() => storage);
  expect(recovery.loadGame()).toEqual({ state, recovered: true });
  const store = createGameStore(noDraw, recovery);
  expect(store.getSnapshot()).toMatchObject({ state, visibleState: state, busy: false, recovered: true });
  return store;
}

describe('Series progress and atomic contributions', () => {
  it.each([2, 5] as const)('starts %i Games independently of replay game identity', (gameCount) => {
    const state = start(draft(gameCount));
    expect(state).toMatchObject({ phase: 'turn', gameNumber: 1, game: { currentGameNumber: 1, mode: { type: 'series', gameCount },
      cumulative: [{ playerId: 'p0', cumulativeScore: 0, cumulativeRemainingDice: 0 }, { playerId: 'p1', cumulativeScore: 0, cumulativeRemainingDice: 0 }] },
      turn: { turnId: '1/series/1/p0', nextRollNumber: 1 } });
    restored(state);
  });
  it.each([1, 6])('rejects unsupported gameCount %i', (gameCount) => {
    expect(() => start({ ...draft(), mode: { type: 'series', gameCount } } as Setup)).toThrow('設定');
  });
  it.each([null, 1, 2, 3, 4, 5] as const)('accepts rollLimit %s', (rollLimit) => {
    expect(series(start(draft(2, rollLimit))).rollLimit).toBe(rollLimit);
  });
  it.each([2, 3, 4, 5] as const)('plays exactly %i Games with explicit Intermediate boundaries and no SD or per-Game losers', (gameCount) => {
    let state = start(draft(gameCount));
    for (let number = 1; number <= gameCount; number++) {
      state = endGame(state);
      expect(series(state).cumulative.every((p) => p.cumulativeScore === 0 && p.cumulativeRemainingDice === number * 5)).toBe(true);
      for (const type of ['roll', 'reveal', 'suddenDeath', 'startSuddenDeath', 'penalty', 'rollPenalty', 'finish'] as const) expect(act(state, { type })).toBe(state);
      const settled = act(state, { type: 'ranking' });
      restored(settled);
      expect(settled.phase).toBe(number === gameCount ? 'seriesRanking' : 'seriesIntermediate');
      if (number < gameCount) {
        expect(settled).not.toHaveProperty('ranking');
        expect(settled).not.toHaveProperty('penalty');
        state = act(settled, { type: 'nextSeriesGame', currentGameNumber: number });
        expect(series(state).currentGameNumber).toBe(number + 1);
        expect(series(state).cumulative).toBe(series(settled).cumulative);
      } else {
        if (settled.phase !== 'seriesRanking') throw new Error('Ranking expected');
        expect(settled.ranking).toEqual({ rankings: [{ playerId: 'p0', rank: 1 }, { playerId: 'p1', rank: 1 }], loserIds: ['p0', 'p1'] });
        for (const type of ['penalty', 'rollPenalty', 'suddenDeath', 'ranking'] as const) expect(act(settled, { type })).toBe(settled);
      }
    }
  });
  it('commits score and active+stranded once with the last terminal roll and counts repeated completions', () => {
    let state = roll(start(), all(1));
    expect(series(state).totalCompletionCount).toBe(1);
    expect(series(state).cumulative.every((p) => p.cumulativeScore === 0 && p.cumulativeRemainingDice === 0)).toBe(true);
    state = act(state, { type: 'next' });
    state = roll(state, [1, 0, 2, 2, 2]);
    expect(series(state).cumulative[0]!.cumulativeScore).toBe(0);
    const beforeFinal = state;
    state = roll(state, all(2, 3));
    expect(state.phase).toBe('turn');
    expect(series(state).cumulative).toEqual([{ playerId: 'p0', cumulativeScore: 500, cumulativeRemainingDice: 0 },
      { playerId: 'p1', cumulativeScore: 100, cumulativeRemainingDice: 4 }]);
    expect(advanceFlow(state, beforeFinal.revision, { type: 'roll' }, noDraw)).toBe(state);
    expect(act(state, { type: 'roll' })).toBe(state);
    restored(state);
    const intermediate = act(state, { type: 'ranking' });
    const store = restored(intermediate);
    store.dispatch(intermediate.revision, { type: 'nextSeriesGame', currentGameNumber: 99 });
    expect(store.getSnapshot().state).toEqual(intermediate);
    state = nextGame(state);
    expect(series(state).players.every((p) => p.score === 0 && p.activeDice === 5 && p.strandedDice === 0 && p.removedDice === 0 && !p.completed)).toBe(true);
    expect(state).toMatchObject({ gameNumber: 1, turn: { turnId: '1/series/2/p0', nextRollNumber: 1 } });
    expect(advanceFlow(state, intermediate.revision, { type: 'nextSeriesGame', currentGameNumber: 1 }, noDraw)).toBe(state);
    expect(act(state, { type: 'nextSeriesGame', currentGameNumber: 1 })).toBe(state);
    expect(advanceFlow(state, beforeFinal.revision, { type: 'roll' }, noDraw)).toBe(state);
    state = roll(state, all(1));
    expect(series(state).totalCompletionCount).toBe(2);
    state = roll(act(state, { type: 'next' }), all(2));
    expect(series(state).cumulative).toEqual([{ playerId: 'p0', cumulativeScore: 1000, cumulativeRemainingDice: 0 },
      { playerId: 'p1', cumulativeScore: 100, cumulativeRemainingDice: 9 }]);
    restored(act(state, { type: 'ranking' }));
  });
  it.each([5, 7, 10, 14] as const)('uses finite terminal results and resets ROLL numbers for %i DICE', (diceMode) => {
    let state = start(draft(2, 1, diceMode));
    state = roll(state, [1, 0, ...all(2, diceMode - 2)]);
    expect(state).toMatchObject({ turn: { result: { outcome: 'turnEnd', reason: 'rollLimit' }, nextRollNumber: 2 } });
    state = roll(act(state, { type: 'next' }), all(5, diceMode));
    expect(series(state).cumulative).toEqual([{ playerId: 'p0', cumulativeScore: 100, cumulativeRemainingDice: diceMode - 1 },
      { playerId: 'p1', cumulativeScore: 50 * diceMode, cumulativeRemainingDice: 0 }]);
    restored(state);
    const next = nextGame(state);
    expect(next).toMatchObject({ turn: { phase: 'ready', nextRollNumber: 1 }, game: { rollLimit: 1, totalCompletionCount: 1 } });
    restored(next);
  });
  it('replays with only fixed configuration and resets Series progress', () => {
    const final = act(endGame(nextGame(endGame(start(draft(2, 3, 14, 3))))), { type: 'ranking' });
    const replay = act(final, { type: 'replay' });
    expect(replay).toMatchObject({ phase: 'replayPreparation', draft: draft(2, 3, 14, 3), replaySource: draft(2, 3, 14, 3) });
    expect(replay).not.toHaveProperty('game');
    restored(replay);
    const reordered = act(replay, { type: 'reorderReplay', participantIds: ['p2', 'p0', 'p1'] });
    const restarted = act(reordered, { type: 'startReplay' });
    expect(restarted).toMatchObject({ gameNumber: 2, game: { currentGameNumber: 1, totalCompletionCount: 0, participants: [draft(2, 3, 14, 3).participants[2],
      draft(2, 3, 14, 3).participants[0], draft(2, 3, 14, 3).participants[1]] }, turn: { turnId: '2/series/1/p2' } });
    expect(series(restarted).cumulative.every((p) => p.cumulativeScore === 0 && p.cumulativeRemainingDice === 0)).toBe(true);
    const newGame = act(final, { type: 'newGame' });
    expect(newGame).toMatchObject({ phase: 'setup', draft: draft(2, 3, 14, 3) });
    expect(newGame).not.toHaveProperty('game');
    restored(newGame);
    expect(act(newGame, { type: 'fullReset' })).toMatchObject({ draft: initialSetup() });
  });
  it('saves atomic cumulative commit before the last roll presentation and blocks premature transitions', () => {
    const ready = act(roll(start(draft(2, 1)), all(1)), { type: 'next' });
    const saved: FlowState[] = [];
    let calls = 0;
    const store = createGameStore({ next: () => { calls++; return 0.9; } }, {
      loadGame: () => ({ recovered: true, state: ready }), saveGame: (state) => { saved.push(state); return undefined; },
    });
    store.dispatch(ready.revision, { type: 'roll' });
    const committed = store.getSnapshot().state;
    expect(committed.phase).toBe('turn');
    expect(saved).toEqual([committed]);
    expect(series(committed).cumulative[0]!.cumulativeScore).toBe(500);
    expect(store.getSnapshot()).toMatchObject({ busy: true, visibleState: ready });
    store.dispatch(committed.revision, { type: 'ranking' });
    expect(store.getSnapshot().state).toBe(committed);
    store.reveal(committed.revision);
    expect(store.getSnapshot().visibleState).toBe(committed);
    store.dispatch(committed.revision, { type: 'ranking' });
    expect(store.getSnapshot().state).toBe(committed);
    store.presented(committed.revision);
    store.dispatch(committed.revision, { type: 'ranking' });
    expect(store.getSnapshot().state.phase).toBe('seriesIntermediate');
    expect(series(store.getSnapshot().state).cumulative).toBe(series(committed).cumulative);
    expect(calls).toBe(10);
  });
});

describe('Series ranking exclusively from cumulative values', () => {
  const p = (playerId: string, cumulativeScore: number, cumulativeRemainingDice: number) => ({ playerId, cumulativeScore, cumulativeRemainingDice });
  it('uses score before remaining without Complete priority', () => {
    expect(calculateSeriesRanking([p('a', 500, 10), p('b', 400, 0)]).rankings).toEqual([{ playerId: 'a', rank: 1 }, { playerId: 'b', rank: 2 }]);
  });
  it('breaks score ties by remaining', () => {
    expect(calculateSeriesRanking([p('a', 500, 5), p('b', 500, 3)]).rankings).toEqual([{ playerId: 'b', rank: 1 }, { playerId: 'a', rank: 2 }]);
  });
  it('uses 1,2,2,4 competition ranks and does not mutate inputs', () => {
    const input = Object.freeze([p('d', 100, 4), p('b', 300, 2), p('a', 500, 1), p('c', 300, 2)]);
    const before = structuredClone(input);
    expect(calculateSeriesRanking(input)).toEqual({ rankings: [{ playerId: 'a', rank: 1 }, { playerId: 'b', rank: 2 },
      { playerId: 'c', rank: 2 }, { playerId: 'd', rank: 4 }], loserIds: ['d'] });
    expect(input).toEqual(before);
  });
  it('returns all tied bottom losers in original input order', () => {
    expect(calculateSeriesRanking([p('z', 100, 2), p('a', 500, 0), p('b', 100, 2)]).loserIds).toEqual(['z', 'b']);
    expect(calculateSeriesRanking([p('z', 100, 2), p('b', 100, 2), p('a', 100, 2)])).toEqual({
      rankings: [{ playerId: 'z', rank: 1 }, { playerId: 'b', rank: 1 }, { playerId: 'a', rank: 1 }], loserIds: ['z', 'b', 'a'] });
  });
});

describe('Series recovery without contribution replay', () => {
  it('restores setup, Game 1 mid-Turn and later Game continuing result', () => {
    restored({ phase: 'setup', setupKind: 'initial', revision: 0, gameNumber: 0, draft: draft() });
    const first = roll(start(), [1, 0, 2, 2, 2]);
    restored(first);
    let later = nextGame(endGame(start()));
    later = roll(later, [5, 2, 2, 2, 2]);
    const store = restored(later);
    expect(series(store.getSnapshot().state).cumulative).toEqual([{ playerId: 'p0', cumulativeScore: 0, cumulativeRemainingDice: 5 },
      { playerId: 'p1', cumulativeScore: 0, cumulativeRemainingDice: 5 }]);
    expect(series(store.getSnapshot().state).currentGameNumber).toBe(2);
  });
  it.each([0, 3, -1, 1.5, '1'])('rejects invalid currentGameNumber %s', (currentGameNumber) => {
    const state = start();
    expect(validateStoredFlowState({ ...state, game: { ...series(state), currentGameNumber } })).toBe(false);
  });
  it.each([
    [{ playerId: 'p0', cumulativeScore: 0, cumulativeRemainingDice: 5 }],
    [{ playerId: 'p0', cumulativeScore: 0, cumulativeRemainingDice: 5 }, { playerId: 'p0', cumulativeScore: 0, cumulativeRemainingDice: 5 }],
    [{ playerId: 'foreign', cumulativeScore: 0, cumulativeRemainingDice: 5 }, { playerId: 'p1', cumulativeScore: 0, cumulativeRemainingDice: 5 }],
  ].map((cumulative) => ({ cumulative })))('rejects incomplete/duplicate/foreign cumulative identities %j', ({ cumulative }) => {
    const state = nextGame(endGame(start()));
    expect(validateStoredFlowState({ ...state, game: { ...series(state), cumulative } })).toBe(false);
  });
  it.each([
    { cumulativeScore: -50, cumulativeRemainingDice: 5 }, { cumulativeScore: 0, cumulativeRemainingDice: -1 },
    { cumulativeScore: 0, cumulativeRemainingDice: 6 }, { cumulativeScore: 1, cumulativeRemainingDice: 5 },
    { cumulativeScore: 50, cumulativeRemainingDice: 5 }, { cumulativeScore: 0, cumulativeRemainingDice: 4 },
    { cumulativeScore: 150, cumulativeRemainingDice: 4 },
  ])('rejects impossible cumulative arithmetic %j', (patch) => {
    const state = nextGame(endGame(start()));
    expect(validateStoredFlowState({ ...state, game: { ...series(state), cumulative: series(state).cumulative.map((entry, i) => i === 0 ? { ...entry, ...patch } : entry) } })).toBe(false);
  });
  it('rejects missing commit, unsupported phases and final/intermediate Game mismatch', () => {
    const terminal = endGame(start());
    expect(validateStoredFlowState({ ...terminal, game: { ...series(terminal), cumulative: series(start()).cumulative } })).toBe(false);
    const intermediate = act(terminal, { type: 'ranking' });
    expect(validateStoredFlowState({ ...intermediate, game: { ...series(intermediate), currentGameNumber: 2 } })).toBe(false);
    for (const phase of ['ranking', 'penalty', 'suddenDeath', 'loserReveal', 'finished']) expect(validateStoredFlowState({ ...intermediate, phase })).toBe(false);
    const final = act(endGame(nextGame(terminal)), { type: 'ranking' });
    expect(validateStoredFlowState({ ...final, ranking: { rankings: [], loserIds: [] } })).toBe(false);
    expect(validateStoredFlowState({ ...final, phase: 'seriesIntermediate' })).toBe(false);
    expect(new SessionRecovery(() => storageFor(final, 3)).loadGame()).toEqual({ recovered: false, notice: 'corrupt' });
  });
  it('rejects completion count contradictions and keeps Intermediate waiting after reload', () => {
    const terminal = endGame(start(), 1);
    const intermediate = act(terminal, { type: 'ranking' });
    const store = restored(intermediate);
    expect(store.getSnapshot().state.phase).toBe('seriesIntermediate');
    for (const totalCompletionCount of [0, 3, -1, 0.5]) {
      expect(validateStoredFlowState({ ...intermediate, game: { ...series(intermediate), totalCompletionCount } })).toBe(false);
    }
  });
});
