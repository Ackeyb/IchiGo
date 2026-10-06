import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGameStore } from '../../src/app/gameStore';
import type { GameStore } from '../../src/app/gameStore';
import { captureSeriesPenaltyPresentation, createSeriesPenaltyAutoCoordinator } from '../../src/app/seriesPenaltyAutoCoordinator';
import { advanceFlow, initialFlow } from '../../src/game/gameFlow';
import type { FlowAction, FlowState } from '../../src/game/gameFlow';
import { initialSetup, switchSetupMode } from '../../src/game/setup';
import type { RollLimit } from '../../src/game/types';
import { SessionRecovery, SESSION_GAME_KEY, validateStoredFlowState } from '../../src/storage/sessionRecovery';

const noDraw = { next: (): number => { throw new Error('Unexpected draw'); } };
const perform = (state: FlowState, action: FlowAction, random = noDraw) => advanceFlow(state, state.revision, action, random);
const safeRoll = (state: FlowState, faces: readonly number[]) => {
  const values = faces.flatMap((value) => [0.9, (value - 0.5) / 6]);
  let calls = 0;
  return perform(state, { type: 'roll' }, { next: () => values[calls++]! });
};
function ready(totalDice = 24, rollLimit: RollLimit = 1, loserCount = 1) {
  let state = perform(initialFlow(), { type: 'start', setup: { ...initialSetup(), diceMode: 14, rollLimit,
    mode: { type: 'series', gameCount: 2 }, participants: Array.from({ length: loserCount + 1 }, (_, i) => ({ id: `p${i}`, name: `P${i}` })) } });
  let remaining = totalDice;
  for (let game = 1; game <= 2; game++) {
    const count = Math.min(14, remaining); remaining -= count;
    for (let player = 0; player <= loserCount; player++) {
      state = safeRoll(state, player === 0 ? Array<number>(14).fill(1)
        : [...Array<number>(14 - count).fill(5), ...Array<number>(count).fill(2)]);
      if (state.phase !== 'turn') throw new Error('Turn expected');
      if (!state.turn.player.turnFinished) state = safeRoll(state, Array<number>(state.turn.player.activeDice).fill(2));
      if (player < loserCount) state = perform(state, { type: 'next' });
    }
    state = perform(state, { type: 'ranking' });
    if (game < 2) state = perform(state, { type: 'nextSeriesGame', currentGameNumber: game });
  }
  state = perform(state, { type: 'penalty' });
  if (state.phase !== 'seriesPenalty') throw new Error('Series Penalty expected');
  expect(validateStoredFlowState(state)).toBe(true);
  return state;
}
const coordinators: ReturnType<typeof createSeriesPenaltyAutoCoordinator>[] = [];
function coordinator(store: GameStore) {
  const instance = createSeriesPenaltyAutoCoordinator(store);
  coordinators.push(instance);
  return instance;
}
function setup(state: FlowState = ready()) {
  let calls = 0;
  const saved: FlowState[] = [];
  const store = createGameStore({ next: () => { calls++; return 0.9; } }, {
    loadGame: () => ({ state, recovered: true }), saveGame: (next) => { saved.push(next); return undefined; },
  });
  const auto = coordinator(store);
  return { store, auto, saved, calls: () => calls };
}
const entry = (store: GameStore) => {
  const { state } = store.getSnapshot();
  if (state.phase !== 'seriesPenalty') throw new Error('Penalty expected');
  return state.seriesPenalty.entries[state.seriesPenalty.currentLoserIndex]!;
};
function start(store: GameStore) {
  const state = store.getSnapshot().state;
  if (state.phase !== 'seriesPenalty') throw new Error('Penalty expected');
  store.dispatch(state.revision, { type: 'startSeriesPenalty', penaltyId: state.seriesPenalty.penaltyId,
    playerId: entry(store).playerId, chunkIndex: 0 });
}
function ack(store: GameStore, auto: ReturnType<typeof createSeriesPenaltyAutoCoordinator>) {
  const identity = captureSeriesPenaltyPresentation(store)!;
  store.reveal(identity.revision);
  auto.presented(identity);
  return identity;
}
function queuedCallback() {
  const spy = vi.spyOn(globalThis, 'setTimeout');
  return () => {
    const callback = spy.mock.calls.at(-1)![0];
    if (typeof callback !== 'function') throw new Error('Timeout callback expected');
    return () => callback();
  };
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  coordinators.splice(0).forEach((auto) => auto.dispose());
  vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks();
});

describe('Series presentation acknowledgment and 1500ms wait', () => {
  it('waits for reveal/paint ack, commits one chunk, then requires the next ack and fresh wait', () => {
    const { store, auto, calls, saved } = setup();
    start(store);
    const first = captureSeriesPenaltyPresentation(store)!;
    expect(calls()).toBe(20);
    expect(vi.getTimerCount()).toBe(0);
    auto.presented(first); // The committed target has not been revealed yet.
    expect(store.getSnapshot().busy).toBe(true);
    store.reveal(first.revision);
    vi.advanceTimersByTime(15000);
    expect(calls()).toBe(20);
    auto.presented(first);
    auto.presented(first);
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(1499);
    expect(entry(store).committedChunks.length).toBe(1);
    vi.advanceTimersByTime(1);
    expect(entry(store).committedChunks.length).toBe(2);
    expect(calls()).toBe(40);
    expect(saved.at(-1)).toBe(store.getSnapshot().state);
    expect(store.getSnapshot().visibleState).toBe(saved[0]);
    expect(store.getSnapshot().busy).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(15000);
    expect(calls()).toBe(40);
    auto.presented(first); // A delayed previous-chunk ack cannot unlock chunk 2.
    expect(store.getSnapshot().busy).toBe(true);
    ack(store, auto);
    vi.advanceTimersByTime(1499);
    expect(calls()).toBe(40);
    vi.advanceTimersByTime(1);
    expect(entry(store).committedChunks.length).toBe(3);
    expect(entry(store).status).toBe('resolved');
    expect(calls()).toBe(48);
    ack(store, auto);
    expect(store.getSnapshot().busy).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('a delayed background callback never catches up multiple chunks', () => {
    const { store, auto, calls } = setup();
    start(store); ack(store, auto);
    vi.advanceTimersByTime(15000);
    expect(entry(store).committedChunks.length).toBe(2);
    expect(calls()).toBe(40);
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each([null, 1, 2, 5] as const)('ignores Play rollLimit %s', (limit) => {
    const { store, auto } = setup(ready(24, limit));
    const game = store.getSnapshot().state;
    start(store); ack(store, auto); vi.advanceTimersByTime(1500);
    ack(store, auto); vi.advanceTimersByTime(1500);
    expect(entry(store).committedChunks.map((c) => c.length)).toEqual([10, 10, 4]);
    const state = store.getSnapshot().state;
    if (state.phase !== 'seriesPenalty' || game.phase !== 'seriesPenalty') throw new Error('Penalty expected');
    expect(state.game).toBe(game.game);
  });
  it.each([0, 1, 10])('creates no auto timer for %i dice', (count) => {
    const { store, auto, calls } = setup(ready(count));
    if (count > 0) { start(store); ack(store, auto); }
    expect(entry(store).status).toBe('resolved');
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(15000);
    expect(calls()).toBe(count * 2);
  });
});

describe('Blocking confirmation, cleanup and stale timers', () => {
  it('OPEN cancels, CANCEL starts fresh 1500ms, and a canceled queued callback remains inert', () => {
    const capture = queuedCallback();
    const { store, auto, calls } = setup();
    start(store); ack(store, auto);
    const old = capture();
    vi.advanceTimersByTime(1000);
    auto.setBlockingConfirmation(true);
    old();
    vi.advanceTimersByTime(1000);
    expect(calls()).toBe(20);
    expect(vi.getTimerCount()).toBe(0);
    auto.setBlockingConfirmation(false);
    expect(vi.getTimerCount()).toBe(1);
    old();
    vi.advanceTimersByTime(1499);
    expect(calls()).toBe(20);
    vi.advanceTimersByTime(1);
    expect(calls()).toBe(40);
  });
  it('an acknowledgment during confirmation cannot advance until a fresh wait after CANCEL', () => {
    const { store, auto, calls } = setup();
    start(store); auto.setBlockingConfirmation(true); ack(store, auto);
    vi.advanceTimersByTime(2000);
    expect(calls()).toBe(20);
    auto.setBlockingConfirmation(false);
    vi.advanceTimersByTime(1500);
    expect(calls()).toBe(40);
  });
  it('confirmation accept / exit / Full Reset cancels old work without changing allowed actions', () => {
    const capture = queuedCallback();
    const { store, auto, calls } = setup();
    start(store); ack(store, auto);
    const old = capture();
    auto.setBlockingConfirmation(true);
    const before = store.getSnapshot().state;
    store.dispatch(before.revision, { type: 'fullReset' }); // Still out of phase.
    expect(store.getSnapshot().state).toBe(before);
    store.dispatch(before.revision, { type: 'newGame' });
    expect(store.getSnapshot().state).toBe(before);
    store.dispatch(before.revision, { type: 'exitGame' });
    auto.setBlockingConfirmation(false);
    old(); vi.advanceTimersByTime(15000);
    expect(store.getSnapshot().state.phase).toBe('setup');
    expect(calls()).toBe(20);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('StrictMode setup/cleanup/remount and concurrent duplicate coordinators cannot double-dispatch', () => {
    const capture = queuedCallback();
    const { store, auto, calls } = setup();
    start(store); const identity = ack(store, auto);
    const old = capture();
    auto.dispose(); auto.dispose();
    const second = coordinator(store);
    const third = coordinator(store);
    second.presented(identity); third.presented(identity);
    old(); auto.presented(identity);
    vi.advanceTimersByTime(1500);
    expect(entry(store).committedChunks.length).toBe(2);
    expect(calls()).toBe(40);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('dispose removes listeners and invalidates callbacks already queued', () => {
    const capture = queuedCallback();
    const { store, auto, calls } = setup();
    start(store); const identity = ack(store, auto);
    const old = capture();
    auto.dispose(); old(); auto.presented(identity); auto.setBlockingConfirmation(false);
    vi.advanceTimersByTime(5000);
    expect(calls()).toBe(20);
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each(['revision', 'penaltyId', 'playerId', 'prefix', 'status', 'phase', 'busy', 'visible'] as const)('rechecks %s inside a callback even without a notification', (change) => {
    const loaded = setup();
    loaded.auto.dispose();
    start(loaded.store);
    const latest: { replacement?: ReturnType<GameStore['getSnapshot']> } = {};
    const store: GameStore = { ...loaded.store, getSnapshot: () => latest.replacement ?? loaded.store.getSnapshot() };
    const auto = coordinator(store);
    ack(store, auto);
    const original = store.getSnapshot();
    if (original.state.phase !== 'seriesPenalty') throw new Error('Penalty expected');
    const state = original.state;
    const current = state.seriesPenalty.entries[0]!;
    const nextState: FlowState = change === 'phase' ? initialFlow()
      : { ...state, revision: state.revision + (change === 'revision' ? 1 : 0), seriesPenalty: { ...state.seriesPenalty,
        penaltyId: change === 'penaltyId' ? 'replacement' : state.seriesPenalty.penaltyId,
        entries: [{ ...current, playerId: change === 'playerId' ? 'replacement' : current.playerId,
          committedChunks: change === 'prefix' ? [...current.committedChunks, current.committedChunks[0]!] : current.committedChunks,
          status: change === 'status' ? 'resolved' : current.status }],
      } };
    latest.replacement = { ...original, state: nextState, busy: change === 'busy', visibleState: change === 'visible' ? initialFlow() : nextState };
    const before = structuredClone(nextState);
    vi.advanceTimersByTime(1500);
    expect(loaded.calls()).toBe(20);
    expect(store.getSnapshot().state).toEqual(before);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('Recovery checkpoints and independent losers', () => {
  it('waits for explicit restored paint acknowledgment and fresh 1500ms, never persists time', () => {
    const { store, auto, saved, calls } = setup();
    start(store); const identity = ack(store, auto);
    vi.advanceTimersByTime(677);
    const state = saved.at(-1)!;
    expect(validateStoredFlowState(state)).toBe(true);
    const raw = JSON.stringify({ version: 4, state });
    for (const field of ['deadline', 'startedAt', 'remainingMs', 'timerId', 'acknowledged', 'paused']) expect(raw).not.toContain(field);
    auto.dispose();
    const storage = { getItem: (key: string) => key === SESSION_GAME_KEY ? raw : null, setItem: () => undefined, removeItem: () => undefined };
    let restoredCalls = 0;
    const restored = createGameStore({ next: () => { restoredCalls++; return 0.9; } }, new SessionRecovery(() => storage));
    const resume = coordinator(restored);
    expect(entry(restored).committedChunks).toEqual(entry(store).committedChunks);
    expect(restoredCalls).toBe(0);
    resume.presented(identity); // Callback captured by the pre-reload Store cannot acknowledge the new owner.
    vi.advanceTimersByTime(15000);
    expect(restoredCalls).toBe(0);
    ack(restored, resume);
    vi.advanceTimersByTime(1499);
    expect(restoredCalls).toBe(0);
    vi.advanceTimersByTime(1);
    expect(restoredCalls).toBe(20);
    expect(entry(restored).committedChunks.length).toBe(2);
    expect(calls()).toBe(20);
  });
  it.each(['pending', 'resolved'] as const)('does not auto-start recovered %s losers', (status) => {
    const original = setup(ready(status === 'pending' ? 24 : 10));
    if (status === 'resolved') { start(original.store); ack(original.store, original.auto); }
    const state = original.store.getSnapshot().state;
    const restored = setup(state);
    const identity = captureSeriesPenaltyPresentation(restored.store);
    if (identity) restored.auto.presented(identity);
    vi.advanceTimersByTime(15000);
    expect(restored.calls()).toBe(0);
    expect(restored.store.getSnapshot().state).toBe(state);
  });
  it('requires a new user start for each loser and rejects old loser acknowledgments', () => {
    const { store, auto, calls } = setup(ready(11, 1, 2));
    start(store); const old = ack(store, auto); vi.advanceTimersByTime(1500); ack(store, auto);
    expect(calls()).toBe(22);
    const state = store.getSnapshot().state;
    if (state.phase !== 'seriesPenalty') throw new Error('Penalty expected');
    store.dispatch(state.revision, { type: 'nextSeriesPenaltyLoser', penaltyId: state.seriesPenalty.penaltyId, playerId: 'p1' });
    store.presented(store.getSnapshot().state.revision);
    auto.presented(old);
    vi.advanceTimersByTime(15000);
    expect(entry(store).playerId).toBe('p2');
    expect(entry(store).status).toBe('pending');
    expect(calls()).toBe(22);
    start(store); ack(store, auto); vi.advanceTimersByTime(1500);
    expect(calls()).toBe(44);
  });
  it('keeps committed results when auto-save fails, without special retries', () => {
    const state = ready();
    let saves = 0;
    const store = createGameStore({ next: () => 0.9 }, { loadGame: () => ({ state, recovered: true }),
      saveGame: () => { saves++; return 'save-failed'; } });
    const auto = coordinator(store);
    start(store); ack(store, auto); vi.advanceTimersByTime(1500);
    expect(entry(store).committedChunks.length).toBe(2);
    expect(entry(store).basePenalty).toBe(120);
    expect(saves).toBe(2);
    expect(store.getSnapshot().recoveryNotice).toBe('save-failed');
    ack(store, auto); vi.advanceTimersByTime(1500);
    expect(entry(store).status).toBe('resolved');
    expect(saves).toBe(3);
  });
  it.each(['normal', 'completionTarget'] as const)('adds no timer to %s single-roll Penalty', (mode) => {
    let state = perform(initialFlow(), { type: 'start', setup: switchSetupMode({ ...initialSetup(), diceMode: 5,
      participants: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }] }, mode) });
    state = safeRoll(state, Array<number>(5).fill(1)); state = perform(state, { type: 'next' });
    state = safeRoll(state, Array<number>(5).fill(2));
    for (const type of ['ranking', 'reveal', 'penalty'] as const) state = perform(state, { type });
    const { store, calls } = setup(state);
    store.dispatch(state.revision, { type: 'rollPenalty' });
    const revision = store.getSnapshot().state.revision;
    store.reveal(revision); store.presented(revision);
    expect(captureSeriesPenaltyPresentation(store)).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(15000);
    expect(calls()).toBe(10);
  });
});
