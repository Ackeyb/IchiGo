import { describe, expect, it } from 'vitest';
import { advanceFlow, initialFlow } from '../../src/game/gameFlow';
import type { FlowAction, FlowState } from '../../src/game/gameFlow';
import { initialSetup } from '../../src/game/setup';
import { commitSeriesPenaltyChunk, partitionSeriesPenalty, rollSeriesPenaltyChunk, seriesChunkBase, seriesPenaltyResult } from '../../src/game/seriesPenalty';
import type { SeriesPenaltyState } from '../../src/game/seriesPenalty';
import { rollGameDice } from '../../src/game/rollGenerator';
import { createGameStore } from '../../src/app/gameStore';
import { SessionRecovery, SESSION_GAME_KEY, SESSION_SOUND_KEY, validateStoredFlowState } from '../../src/storage/sessionRecovery';
import type { DiceMode, DieResult, DieValue, RollLimit, SeriesGameCount, ThrowStyle } from '../../src/game/types';

const out: DieResult = { status: 'out', value: null };
const safe = (value: DieValue): DieResult => ({ status: 'safe', value });
const noDraw = { next: (): number => { throw new Error('Unexpected random draw'); } };
class Sequence {
  calls = 0;
  constructor(private readonly values: readonly number[]) {}
  next() {
    const value = this.values[this.calls++];
    if (value === undefined) throw new Error('Extra random draw');
    return value;
  }
}
const faces = (values: readonly number[]) => values.flatMap((value) => [0.9, (value - 0.5) / 6]);
const act = (state: FlowState, action: FlowAction, random = noDraw) => advanceFlow(state, state.revision, action, random);
const entryState = (totalDice: number): SeriesPenaltyState => ({ penaltyId: 'id', currentLoserIndex: 0,
  entries: [{ playerId: 'loser', totalDice, status: totalDice ? 'pending' : 'resolved', committedChunks: [], basePenalty: 0 }] });
const request = (chunkIndex = 0) => ({ penaltyId: 'id', playerId: 'loser', chunkIndex });

/** Build genuine final Game snapshots, including all atomic cumulative commits; no fabricated Recovery history. */
function finalRanking(totalDice: number, diceMode: DiceMode = 14, gameCount: SeriesGameCount = 5,
  rollLimit: RollLimit = 1, throwStyle: ThrowStyle = 'normal', loserCount = 1, allTie = false) {
  let state = act(initialFlow(), { type: 'start', setup: { ...initialSetup(), mode: { type: 'series', gameCount },
    diceMode, rollLimit, throwStyle, participants: Array.from({ length: loserCount + 1 }, (_, i) => ({ id: `p${i}`, name: '同名' })) } });
  let remaining = totalDice;
  for (let game = 1; game <= gameCount; game++) {
    const thisRemaining = Math.min(diceMode, remaining);
    remaining -= thisRemaining;
    for (let player = 0; player <= loserCount; player++) {
      const dice = player === 0 && !allTie ? Array<number>(diceMode).fill(1)
        : [...Array<number>(diceMode - thisRemaining).fill(5), ...Array<number>(thisRemaining).fill(2)];
      state = act(state, { type: 'roll' }, new Sequence(faces(dice)));
      if (state.phase !== 'turn') throw new Error('Turn expected');
      if (!state.turn.player.turnFinished) state = act(state, { type: 'roll' }, new Sequence(faces(Array<number>(state.turn.player.activeDice).fill(2))));
      if (player < loserCount) state = act(state, { type: 'next' });
    }
    state = act(state, { type: 'ranking' });
    if (game < gameCount) state = act(state, { type: 'nextSeriesGame', currentGameNumber: game });
  }
  if (state.phase !== 'seriesRanking' || remaining !== 0) throw new Error('Final Series ranking expected');
  return state;
}
const ready = (...args: Parameters<typeof finalRanking>) => {
  const state = act(finalRanking(...args), { type: 'penalty' });
  if (state.phase !== 'seriesPenalty') throw new Error('Series Penalty expected');
  return state;
};
function chunk(state: FlowState, values?: readonly number[]) {
  if (state.phase !== 'seriesPenalty') throw new Error('Series Penalty expected');
  const entry = state.seriesPenalty.entries[state.seriesPenalty.currentLoserIndex]!;
  const size = partitionSeriesPenalty(entry.totalDice)[entry.committedChunks.length]!;
  const random = new Sequence(faces(values ?? Array<number>(size).fill(2)));
  const next = act(state, { type: entry.status === 'pending' ? 'startSeriesPenalty' : 'nextSeriesPenaltyChunk',
    penaltyId: state.seriesPenalty.penaltyId, playerId: entry.playerId, chunkIndex: entry.committedChunks.length }, random);
  expect(random.calls).toBe(size * 2);
  return next;
}
function memory(state: FlowState, version = 4) {
  const values = new Map([[SESSION_GAME_KEY, JSON.stringify({ version, state })], [SESSION_SOUND_KEY, JSON.stringify({ version: 1, enabled: false })]]);
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); } };
}
function restore(state: FlowState) {
  expect(validateStoredFlowState(state)).toBe(true);
  const storage = memory(state);
  const recovery = new SessionRecovery(() => storage);
  expect(recovery.loadGame()).toEqual({ state, recovered: true });
  expect(recovery.loadSound()).toEqual({ enabled: false });
  const store = createGameStore(noDraw, recovery);
  expect(store.getSnapshot()).toMatchObject({ state, visibleState: state, busy: false });
  return store;
}

describe('Series partition and OUT-first generation', () => {
  it.each([
    { count: 0, plan: [] }, { count: 1, plan: [1] }, { count: 10, plan: [10] }, { count: 11, plan: [10, 1] },
    { count: 15, plan: [10, 5] }, { count: 20, plan: [10, 10] }, { count: 24, plan: [10, 10, 4] },
    { count: 70, plan: [10, 10, 10, 10, 10, 10, 10] },
  ])('partitions $count deterministically', ({ count, plan }) => expect(partitionSeriesPenalty(count)).toEqual(plan));
  it.each([-1, 71, 1.5, NaN, Infinity])('rejects invalid total %s', (count) => expect(() => partitionSeriesPenalty(count)).toThrow(RangeError));
  it.each([0, 11, 1.5])('rejects invalid chunk %s before random generation', (count) => expect(() => rollSeriesPenaltyChunk(count, 'normal', noDraw)).toThrow(RangeError));
  it.each([['rough', 0.03], ['normal', 0.01]] as const)('shares %s OUT-first semantics', (style, probability) => {
    const draws = [probability - 0.000001, probability, 0.1, 0.9, 0.8];
    const random = new Sequence(draws);
    const result = rollSeriesPenaltyChunk(3, style, random);
    expect(result).toEqual([out, safe(1), safe(5)]);
    expect(result).toEqual(rollGameDice(3, style, new Sequence(draws), 5));
    expect(random.calls).toBe(5);
    expect(seriesChunkBase(result)).toBe(12);
  });
  it('careful still draws an OUT check and face for every die', () => {
    const random = new Sequence([0, 0, 0, 0.99]);
    expect(rollSeriesPenaltyChunk(2, 'careful', random)).toEqual([safe(1), safe(6)]);
    expect(random.calls).toBe(4);
  });
  it('all OUT retains null and consumes no face draws', () => {
    const random = new Sequence(Array<number>(10).fill(0));
    const state = commitSeriesPenaltyChunk(entryState(10), request(), true, 'rough', random);
    expect(state.entries[0]!.committedChunks).toEqual([Array<DieResult>(10).fill(out)]);
    expect(seriesPenaltyResult(state.entries[0]!, 2)).toEqual({ basePenalty: 60, multiplier: 3, finalPenalty: 180 });
    expect(random.calls).toBe(10);
  });
  it('preserves the Normal count<=diceMode invariant', () => {
    expect(() => rollGameDice(10, 'normal', noDraw, 5)).toThrow(RangeError);
    expect(() => rollGameDice(10, 'normal', noDraw, 7)).toThrow(RangeError);
  });
});

describe('Series chunk authority', () => {
  it.each([1, 10, 11, 15, 24, 70])('commits exactly one chunk for total %i, then derives one FINAL', (total) => {
    let state = entryState(total);
    const plan = partitionSeriesPenalty(total);
    let base = 0;
    for (let i = 0; i < plan.length; i++) {
      expect(seriesPenaltyResult(state.entries[0]!, 3)).toBeUndefined();
      const random = new Sequence(faces(Array<number>(plan[i]!).fill(3)));
      const previous = state;
      state = commitSeriesPenaltyChunk(state, request(i), i === 0, 'normal', random);
      base += plan[i]! * 3;
      expect(state.entries[0]).toMatchObject({ status: i === plan.length - 1 ? 'resolved' : 'running', basePenalty: base });
      expect(state.entries[0]!.committedChunks.map((c) => c.length)).toEqual(plan.slice(0, i + 1));
      expect(previous.entries[0]!.committedChunks.length).toBe(i);
      expect(random.calls).toBe(plan[i]! * 2);
      expect(state.entries[0]).not.toHaveProperty('finalPenalty');
    }
    expect(seriesPenaltyResult(state.entries[0]!, 3)).toEqual({ basePenalty: total * 3, multiplier: 4, finalPenalty: total * 12 });
    expect(commitSeriesPenaltyChunk(state, request(plan.length), false, 'normal', noDraw)).toBe(state);
  });
  it('sums mixed ordered chunks before multiplier', () => {
    let state = entryState(24);
    const inputs = [[out, ...Array<DieResult>(9).fill(safe(3))], Array<DieResult>(10).fill(safe(2)), [out, safe(3), safe(5), out]];
    for (let i = 0; i < inputs.length; i++) {
      const random = new Sequence(inputs[i]!.flatMap((die) => die.status === 'out' ? [0] : faces([die.value])));
      state = commitSeriesPenaltyChunk(state, request(i), i === 0, 'normal', random);
    }
    expect(state.entries[0]!.committedChunks).toEqual(inputs);
    expect(state.entries[0]!.basePenalty).toBe(73);
    expect(seriesPenaltyResult(state.entries[0]!, 3)?.finalPenalty).toBe(292);
  });
  it('rejects duplicate start, chunk position, phase identity and loser before any draw', () => {
    const initial = entryState(24);
    const running = commitSeriesPenaltyChunk(initial, request(), true, 'normal', new Sequence(faces(Array<number>(10).fill(2))));
    for (const state of [initial, running]) {
      for (const bad of [{ ...request(), penaltyId: 'old' }, { ...request(), playerId: 'other' }, request(99)]) {
        expect(commitSeriesPenaltyChunk(state, bad, state === initial, 'normal', noDraw)).toBe(state);
      }
    }
    expect(commitSeriesPenaltyChunk(initial, request(), false, 'normal', noDraw)).toBe(initial);
    expect(commitSeriesPenaltyChunk(running, request(1), true, 'normal', noDraw)).toBe(running);
    expect(commitSeriesPenaltyChunk(running, request(0), false, 'normal', noDraw)).toBe(running);
  });
});

describe('Series Penalty Flow and checkpoints', () => {
  it.each([1, 10, 11, 15, 24, 70])('round-trips every committed prefix and the final result for %i dice', (totalDice) => {
    let state: FlowState = ready(totalDice);
    restore(state);
    for (const size of partitionSeriesPenalty(totalDice)) {
      state = chunk(state);
      if (state.phase !== 'seriesPenalty') throw new Error('Penalty expected');
      expect(state.seriesPenalty.entries[0]!.committedChunks.at(-1)!.length).toBe(size);
      restore(state);
    }
    if (state.phase !== 'seriesPenalty') throw new Error('Penalty expected');
    expect(state.seriesPenalty.entries[0]!.basePenalty).toBe(totalDice * 2);
    const result = seriesPenaltyResult(state.seriesPenalty.entries[0]!, state.game.totalCompletionCount);
    expect(result?.finalPenalty).toBe(totalDice * 2 * (state.game.totalCompletionCount + 1));
    restore(act(state, { type: 'finish' }));
  });
  it('keeps zero dice losers as resolved results without ROLL or renderer input', () => {
    const state = ready(0);
    expect(state.seriesPenalty.entries).toEqual([{ playerId: 'p1', totalDice: 0, status: 'resolved', committedChunks: [], basePenalty: 0 }]);
    expect(seriesPenaltyResult(state.seriesPenalty.entries[0]!, state.game.totalCompletionCount)?.finalPenalty).toBe(0);
    expect(act(state, { type: 'startSeriesPenalty', penaltyId: state.seriesPenalty.penaltyId, playerId: 'p1', chunkIndex: 0 })).toBe(state);
    restore(state);
    const finished = act(state, { type: 'finish' });
    expect(finished.phase).toBe('seriesFinished');
    restore(finished);
  });
  it.each([5, 7] as const)('generates a 10-die chunk with original %i DICE unchanged', (diceMode) => {
    const state = ready(diceMode * 2, diceMode, 2);
    const committed = chunk(state);
    if (committed.phase !== 'seriesPenalty') throw new Error('Penalty expected');
    expect(committed.game).toBe(state.game);
    expect(committed.seriesPenalty.entries[0]!.committedChunks[0]!.length).toBe(10);
    restore(committed);
  });
  it.each([null, 1, 2, 5] as const)('processes 24 dice independently of rollLimit %s and Play roll state', (limit) => {
    let state: FlowState = ready(24, 14, 2, limit);
    const game = state.game;
    for (let i = 0; i < 3; i++) {
      state = chunk(state);
      if (state.phase !== 'seriesPenalty') throw new Error('Penalty expected');
      expect(state.game).toBe(game); restore(state);
    }
    if (state.phase !== 'seriesPenalty') throw new Error('Penalty expected');
    expect(state.seriesPenalty.entries[0]!.committedChunks.map((c) => c.length)).toEqual([10, 10, 4]);
    expect(state.seriesPenalty.entries[0]!.basePenalty).toBe(48);
    restore(act(state, { type: 'finish' }));
  });
  it('keeps all tied losers in original order with independent results and explicit transitions', () => {
    let state: FlowState = ready(10, 5, 2, 1, 'normal', 2, true);
    if (state.phase !== 'seriesPenalty') throw new Error('Penalty expected');
    expect(state.seriesPenalty.entries.map((p) => p.playerId)).toEqual(['p0', 'p1', 'p2']);
    const id = state.seriesPenalty.penaltyId;
    expect(act(state, { type: 'nextSeriesPenaltyLoser', penaltyId: id, playerId: 'p0' })).toBe(state);
    expect(act(state, { type: 'finish' })).toBe(state);
    for (let i = 0; i < 3; i++) {
      state = chunk(state, Array<number>(10).fill(i + 1));
      restore(state);
      if (i < 2) {
        const previous = state;
        state = act(state, { type: 'nextSeriesPenaltyLoser', penaltyId: id, playerId: `p${i}` });
        restore(state);
        expect(act(state, { type: 'startSeriesPenalty', penaltyId: id, playerId: `p${i}`, chunkIndex: 0 })).toBe(state);
        expect(advanceFlow(state, previous.revision, { type: 'nextSeriesPenaltyLoser', penaltyId: id, playerId: `p${i}` }, noDraw)).toBe(state);
      }
    }
    if (state.phase !== 'seriesPenalty') throw new Error('Penalty expected');
    expect(state.seriesPenalty.entries.map((p) => p.basePenalty)).toEqual([10, 20, 30]);
    const finished = act(state, { type: 'finish' });
    restore(finished);
    expect(act(finished, { type: 'replay' }).phase).toBe('replayPreparation');
    expect(act(finished, { type: 'newGame' }).phase).toBe('setup');
  });
  it('retains every zero-dice loser in an all-tied final ranking', () => {
    let state: FlowState = ready(0, 5, 2, 1, 'normal', 2, true);
    if (state.phase !== 'seriesPenalty') throw new Error('Penalty expected');
    expect(state.seriesPenalty.entries.every((p) => p.totalDice === 0 && p.status === 'resolved')).toBe(true);
    for (let i = 0; i < 2; i++) {
      state = act(state, { type: 'nextSeriesPenaltyLoser', penaltyId: state.phase === 'seriesPenalty' ? state.seriesPenalty.penaltyId : '', playerId: `p${i}` });
      restore(state);
    }
    restore(act(state, { type: 'finish' }));
  });
  it('stores each chunk before staged reveal, preserves the prefix on reload and rejects stale requests', () => {
    const state = ready(24);
    const storage = memory(state);
    const recovery = new SessionRecovery(() => storage);
    let draws = 0;
    const store = createGameStore({ next: () => { draws++; return 0.9; } }, recovery);
    const first: FlowAction = { type: 'startSeriesPenalty', penaltyId: state.seriesPenalty.penaltyId, playerId: 'p1', chunkIndex: 0 };
    store.dispatch(state.revision, first);
    const committed = store.getSnapshot().state;
    expect(store.getSnapshot()).toMatchObject({ busy: true, visibleState: state });
    expect(JSON.parse(storage.getItem(SESSION_GAME_KEY)!).state).toEqual(committed);
    restore(committed);
    for (const action of [first, { ...first, type: 'nextSeriesPenaltyChunk' as const, chunkIndex: 1 }]) store.dispatch(committed.revision, action);
    expect(draws).toBe(20);
    store.reveal(committed.revision);
    expect(store.getSnapshot().visibleState).toBe(committed);
    store.presented(committed.revision);
    store.dispatch(state.revision, first);
    store.dispatch(committed.revision, first);
    store.dispatch(committed.revision, { ...first, type: 'nextSeriesPenaltyChunk', chunkIndex: 0 });
    expect(draws).toBe(20);
    store.dispatch(committed.revision, { ...first, type: 'nextSeriesPenaltyChunk', chunkIndex: 1 });
    expect(draws).toBe(40);
    restore(store.getSnapshot().state);
  });
  it('remains fail-open when saving a committed chunk fails', () => {
    const state = ready(11);
    const store = createGameStore({ next: () => 0.9 }, { loadGame: () => ({ state, recovered: true }), saveGame: () => 'save-failed' });
    store.dispatch(state.revision, { type: 'startSeriesPenalty', penaltyId: state.seriesPenalty.penaltyId, playerId: 'p1', chunkIndex: 0 });
    expect(store.getSnapshot()).toMatchObject({ busy: true, recoveryNotice: 'save-failed', state: { seriesPenalty: { entries: [{ status: 'running', basePenalty: 60 }] } } });
  });
  it.each(['rough', 'normal', 'careful'] as const)('passes game.throwStyle %s into chunks', (style) => {
    const state = ready(11, 7, 2, 1, style);
    const random = new Sequence(Array<number>(20).fill(0));
    const committed = act(state, { type: 'startSeriesPenalty', penaltyId: state.seriesPenalty.penaltyId, playerId: 'p1', chunkIndex: 0 }, random);
    if (committed.phase !== 'seriesPenalty') throw new Error('Penalty expected');
    expect(committed.seriesPenalty.entries[0]!.committedChunks[0]).toEqual(Array<DieResult>(10).fill(style === 'careful' ? safe(1) : out));
    expect(random.calls).toBe(style === 'careful' ? 20 : 10);
    restore(committed);
  });
  it('rejects wrong phase, revision, loser and chunk requests without changing aggregates', () => {
    const state = ready(24);
    const first: FlowAction = { type: 'startSeriesPenalty', penaltyId: state.seriesPenalty.penaltyId, playerId: 'p1', chunkIndex: 0 };
    expect(act(initialFlow(), first)).toEqual(initialFlow());
    expect(advanceFlow(state, state.revision - 1, first, noDraw)).toBe(state);
    for (const action of [{ ...first, playerId: 'p0' }, { ...first, penaltyId: 'old' }, { ...first, chunkIndex: 1 },
      { ...first, type: 'nextSeriesPenaltyChunk' as const }]) expect(act(state, action)).toBe(state);
    const committed = chunk(state);
    expect(act(committed, first)).toBe(committed);
    expect(act(committed, { ...first, type: 'nextSeriesPenaltyChunk' })).toBe(committed);
  });
});

describe('Series Penalty Recovery rejects tampering without repair', () => {
  const badEntry = (state: ReturnType<typeof ready>, patch: Record<string, unknown>) => ({ ...state, seriesPenalty: {
    ...state.seriesPenalty, entries: state.seriesPenalty.entries.map((entry, i) => i === 0 ? { ...entry, ...patch } : entry),
  } });
  const lengths = (sizes: readonly number[]) => sizes.map((count) => Array<DieResult>(count).fill(safe(2)));
  it.each([
    { sizes: [4] }, { sizes: [10, 4] }, { sizes: [10, 10, 3] }, { sizes: [10, 10, 4, 1] }, { sizes: [11] }, { sizes: [0] },
  ])('rejects non-prefix / wrong lengths $sizes', ({ sizes }) => {
    expect(validateStoredFlowState(badEntry(ready(24), { committedChunks: lengths(sizes), status: 'running', basePenalty: sizes.reduce((sum, n) => sum + n * 2, 0) }))).toBe(false);
  });
  it.each([
    { patch: { status: 'running' } }, { patch: { status: 'resolved' } }, { patch: { status: 'unknown' } },
    { patch: { basePenalty: 1 } }, { patch: { playerId: 'p0' } }, { patch: { totalDice: 23 } },
    { patch: { totalDice: -1 } }, { patch: { totalDice: 71 } }, { patch: { totalDice: 1.5 } },
    { patch: { finalPenalty: 0 } }, { patch: { multiplier: 1 } },
  ])('rejects pending entry contradiction $patch', ({ patch }) => {
    const state = ready(24);
    const bad = badEntry(state, patch);
    expect(validateStoredFlowState(bad)).toBe(false);
    const before = structuredClone(bad);
    expect(new SessionRecovery(() => memory(bad as FlowState)).loadGame()).toMatchObject({ recovered: false, notice: 'corrupt' });
    expect(bad).toEqual(before);
  });
  it.each([
    { die: { status: 'safe', value: null } }, { die: { status: 'out', value: 6 } },
    { die: { status: 'safe', value: 0 } }, { die: { status: 'safe', value: 7 } }, { die: { value: 2 } },
  ])('rejects malformed committed die $die', ({ die }) => {
    const chunks = [[die, ...Array<DieResult>(9).fill(safe(2))]];
    expect(validateStoredFlowState(badEntry(ready(24), { committedChunks: chunks, status: 'running', basePenalty: 20 }))).toBe(false);
  });
  it('validates accumulated BASE and complete/running status boundaries', () => {
    const initial = ready(24);
    let running = chunk(initial);
    if (running.phase !== 'seriesPenalty') throw new Error('Penalty expected');
    for (const patch of [{ basePenalty: 21 }, { status: 'pending' }, { status: 'resolved' }]) expect(validateStoredFlowState(badEntry(running, patch))).toBe(false);
    running = chunk(running);
    restore(running);
    const resolved = chunk(running);
    if (resolved.phase !== 'seriesPenalty') throw new Error('Penalty expected');
    restore(resolved);
    expect(validateStoredFlowState(badEntry(resolved, { status: 'running' }))).toBe(false);
    expect(validateStoredFlowState(badEntry(resolved, { basePenalty: 47 }))).toBe(false);
  });
  it('rejects zero dice chunks and unresolved zero results', () => {
    const zero = ready(0);
    expect(validateStoredFlowState(badEntry(zero, { committedChunks: [[safe(2)]], basePenalty: 2 }))).toBe(false);
    expect(validateStoredFlowState(badEntry(zero, { status: 'pending' }))).toBe(false);
    expect(validateStoredFlowState(badEntry(zero, { basePenalty: 1 }))).toBe(false);
  });
  it('restores mixed and all OUT exactly, rejects careful OUT, and keeps schema 4 / Sound 1', () => {
    for (const style of ['normal', 'rough', 'careful'] as const) {
      const initial = ready(11, 7, 2, 1, style);
      const entry = initial.seriesPenalty.entries[0]!;
      const dice = [out, safe(2), safe(5), ...Array<DieResult>(7).fill(out)];
      const state = badEntry(initial, { ...entry, status: 'running', committedChunks: [dice], basePenalty: 55 });
      expect(validateStoredFlowState(state)).toBe(style !== 'careful');
      if (style !== 'careful') restore(state as FlowState);
    }
    const initial = ready(11, 7, 2);
    const allOut = badEntry(initial, { status: 'running', committedChunks: [Array<DieResult>(10).fill(out)], basePenalty: 60 });
    restore(allOut as FlowState);
    const recovery = new SessionRecovery(() => memory(initial, 3));
    expect(recovery.loadGame()).toMatchObject({ recovered: false, notice: 'corrupt' });
    expect(recovery.loadSound()).toEqual({ enabled: false });
  });
  it('validates loser identity/order/index, future untouched entries and all-resolved phase', () => {
    const state = ready(10, 5, 2, 1, 'normal', 2, true);
    const penalty = state.seriesPenalty;
    for (const entries of [penalty.entries.slice(1), [...penalty.entries, penalty.entries[0]],
      [penalty.entries[1], penalty.entries[0], penalty.entries[2]], [penalty.entries[0], penalty.entries[0], penalty.entries[2]]]) {
      expect(validateStoredFlowState({ ...state, seriesPenalty: { ...penalty, entries } })).toBe(false);
    }
    for (const currentLoserIndex of [-1, 3, 0.5, 1]) expect(validateStoredFlowState({ ...state, seriesPenalty: { ...penalty, currentLoserIndex } })).toBe(false);
    expect(validateStoredFlowState({ ...state, seriesPenalty: { ...penalty, penaltyId: 'old' } })).toBe(false);
    expect(validateStoredFlowState({ ...state, phase: 'seriesFinished' })).toBe(false);
    const resolved = chunk(state);
    if (resolved.phase !== 'seriesPenalty') throw new Error('Penalty expected');
    expect(validateStoredFlowState({ ...state, seriesPenalty: { ...penalty, entries: [penalty.entries[0], resolved.seriesPenalty.entries[0], penalty.entries[2]] } })).toBe(false);
    const next = act(resolved, { type: 'nextSeriesPenaltyLoser', penaltyId: penalty.penaltyId, playerId: 'p0' });
    restore(next);
    expect(validateStoredFlowState({ ...next, ranking: { rankings: [], loserIds: [] } })).toBe(false);
  });
});
