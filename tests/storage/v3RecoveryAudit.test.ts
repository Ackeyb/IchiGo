import { describe, expect, it } from 'vitest';
import { createGameStore } from '../../src/app/gameStore';
import { continueTurn } from '../../src/game/gameEngine';
import { advanceFlow, initialFlow } from '../../src/game/gameFlow';
import type { FlowAction, FlowState } from '../../src/game/gameFlow';
import { initialSetup, validateSetup } from '../../src/game/setup';
import type { RollLimit } from '../../src/game/types';
import { SessionRecovery, SESSION_GAME_KEY, SESSION_SOUND_KEY } from '../../src/storage/sessionRecovery';

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}
const noDraw = { next: (): number => { throw new Error('Unexpected draw'); } };
const act = (state: FlowState, action: FlowAction) => advanceFlow(state, state.revision, action, noDraw);
const setup = (rollLimit: RollLimit = 3) => ({ ...initialSetup(), diceMode: 14 as const, rollLimit,
  participants: [{ id: 'z', name: 'Z' }, { id: 'a', name: 'A' }, { id: 'm', name: 'M' }] });
function roll(state: FlowState, faces: readonly number[], type: 'roll' | 'rollPenalty' = 'roll') {
  // OUT check precedes each SAFE face draw; zero denotes an OUT check only.
  const draws = faces.flatMap((face) => face === 0 ? [0] : [0.9, (face - 0.5) / 6]);
  let index = 0;
  const result = advanceFlow(state, state.revision, { type }, { next: () => {
    const value = draws[index++];
    if (value === undefined) throw new Error('Unexpected draw');
    return value;
  } });
  expect(index).toBe(draws.length);
  return result;
}
function load(state: unknown, version: unknown = 3) {
  const storage = new MemoryStorage();
  storage.setItem(SESSION_GAME_KEY, JSON.stringify({ version, state }));
  return new SessionRecovery(() => storage).loadGame();
}
const accepted = (state: FlowState) => expect(load(state)).toEqual({ state, recovered: true });
const rejected = (state: unknown) => expect(load(state)).toEqual({ recovered: false, notice: 'corrupt' });
function finished(rollLimit: RollLimit = 3) {
  let state = act(initialFlow(), { type: 'start', setup: setup(rollLimit) });
  accepted(state);
  state = roll(state, Array<number>(14).fill(1));
  accepted(state);
  for (let index = 0; index < 2; index++) {
    state = act(state, { type: 'next' });
    state = roll(state, Array<number>(14).fill(2));
    accepted(state);
  }
  for (const type of ['ranking', 'reveal', 'penalty'] as const) {
    state = act(state, { type });
    accepted(state);
  }
  state = roll(state, [0, 2, 5, 0, ...Array<number>(10).fill(3)], 'rollPenalty');
  accepted(state);
  state = act(state, { type: 'nextPenalty' });
  accepted(state);
  state = roll(state, Array<number>(14).fill(0), 'rollPenalty');
  accepted(state);
  state = act(state, { type: 'finish' });
  if (state.phase !== 'finished') throw new Error('Expected finished');
  accepted(state);
  return state;
}

describe('v3 recovery phase and reload audit', () => {
  it.each([null, 1, 3] as const)('restores blank 14 DICE drafts with limit %s without making START valid', (rollLimit) => {
    const state = act(initialFlow(), { type: 'updateSetup', draft: { ...initialSetup(), diceMode: 14, rollLimit } });
    accepted(state);
    if (state.phase !== 'setup') throw new Error('Expected setup');
    expect(validateSetup(state.draft)).toBe(false);
  });
  it.each([0, 6, -1, 1.5, '3', undefined])('rejects invalid draft limit %s', (rollLimit) => {
    rejected({ ...initialFlow(), draft: { ...initialSetup(), rollLimit } });
  });
  it('rejects invalid setup metadata and Dice Mode 15', () => {
    const state = initialFlow();
    for (const patch of [{ setupKind: 'other' }, { revision: -1 }, { gameNumber: 1 }]) rejected({ ...state, ...patch });
    rejected({ ...state, draft: { ...initialSetup(), diceMode: 15 } });
  });
  it.each([null, 3] as const)('preserves settings and only participant order through Replay / New Game with limit %s', (limit) => {
    const end = finished(limit);
    const replay = act(end, { type: 'replay' });
    if (replay.phase !== 'replayPreparation') throw new Error('Expected replay');
    expect(replay.draft).toEqual(setup(limit));
    accepted(act(replay, { type: 'reorderReplay', participantIds: ['m', 'z', 'a'] }));
    for (const draft of [
      { ...replay.draft, diceMode: 10 }, { ...replay.draft, throwStyle: 'rough' },
      { ...replay.draft, rollLimit: 2 },
      { ...replay.draft, participants: replay.draft.participants.slice(1) },
      { ...replay.draft, participants: [...replay.draft.participants, { id: 'x', name: 'X' }] },
      { ...replay.draft, participants: [{ id: 'x', name: 'Z' }, ...replay.draft.participants.slice(1)] },
      { ...replay.draft, participants: [{ id: 'z', name: 'Changed' }, ...replay.draft.participants.slice(1)] },
    ]) rejected({ ...replay, draft });
    const fresh = act(end, { type: 'newGame' });
    accepted(fresh);
    expect(fresh).toEqual({ phase: 'setup', revision: end.revision + 1, gameNumber: end.gameNumber,
      setupKind: 'newGame', draft: setup(limit) });
    const reset = act(fresh, { type: 'fullReset' });
    accepted(reset);
    expect(reset).toMatchObject({ setupKind: 'fullReset', draft: initialSetup() });
  });
  it.each([null, 3] as const)('restores a genuine continued ready turn with limit %s', (limit) => {
    const state = roll(act(initialFlow(), { type: 'start', setup: setup(limit) }), [1, ...Array<number>(13).fill(2)]);
    if (state.phase !== 'turn' || state.turn.phase !== 'result') throw new Error('Expected result');
    const ready = { ...state, turn: continueTurn(state.turn, state.turn.rollNumber, state.turn.turnId) };
    accepted(ready);
    expect(ready.turn.nextRollNumber).toBe(2);
    rejected({ ...ready, game: { ...ready.game, rollLimit: 1 } });
    rejected({ ...ready, turn: { ...ready.turn, nextRollNumber: 4 } });
    rejected({ ...ready, turn: { ...ready.turn, rollNumber: 1, result: state.turn.result } });
  });
  it.each([null, 3] as const)('restores 14 DICE Sudden Death and cumulative completions with limit %s', (limit) => {
    let state = act(initialFlow(), { type: 'start', setup: setup(limit) });
    for (let index = 0; index < 3; index++) {
      state = roll(state, Array<number>(14).fill(1));
      if (index < 2) state = act(state, { type: 'next' });
    }
    state = act(state, { type: 'ranking' });
    accepted(state);
    state = act(state, { type: 'suddenDeath' });
    accepted(state);
    state = act(state, { type: 'startSuddenDeath' });
    accepted(state);
    expect(state).toMatchObject({ game: { diceMode: 14, throwStyle: 'normal', rollLimit: limit,
      participants: setup(limit).participants, totalCompletionCount: 3, suddenDeathCount: 1 },
    turn: { nextRollNumber: 1, player: { activeDice: 14, score: 0, removedDice: 0, strandedDice: 0 } } });
  });
  it.each([
    { limit: 1, faces: Array<number>(14).fill(1), outcome: 'complete', reason: undefined },
    { limit: 1, faces: Array<number>(14).fill(2), outcome: 'turnEnd', reason: 'noScore' },
    { limit: 1, faces: [1, ...Array<number>(13).fill(0)], outcome: 'turnEnd', reason: 'rollLimit' },
    { limit: 3, faces: [1, ...Array<number>(13).fill(0)], outcome: 'turnEnd', reason: 'noActiveDice' },
    { limit: null, faces: [1, ...Array<number>(13).fill(2)], outcome: 'continue', reason: undefined },
  ] as const)('revalidates result priority $outcome / $reason', ({ limit, faces, outcome, reason }) => {
    const state = roll(act(initialFlow(), { type: 'start', setup: setup(limit) }), faces);
    if (state.phase !== 'turn' || state.turn.phase !== 'result') throw new Error('Expected result');
    accepted(state);
    expect(state.turn.result.outcome).toBe(outcome);
    expect(state.turn.result.reason).toBe(reason);
    for (const wrong of ['noScore', 'rollLimit', 'noActiveDice']) {
      if (wrong !== reason) rejected({ ...state, turn: { ...state.turn, result: { ...state.turn.result, reason: wrong } } });
    }
    if (outcome === 'complete') {
      rejected({ ...state, turn: { ...state.turn, result: { ...state.turn.result, outcome: 'turnEnd', reason: 'rollLimit' } } });
    }
  });
  it('restores roll 2 animation checkpoint, ignores stale operations, and commits final limit once', () => {
    let state = act(initialFlow(), { type: 'start', setup: setup() });
    state = roll(state, [1, ...Array<number>(13).fill(2)]);
    const storage = new MemoryStorage();
    new SessionRecovery(() => storage).saveGame(state);
    let calls = 0;
    const store = createGameStore({ next: () => { calls++; return calls % 2 === 1 ? 0.9 : 0.25; } }, new SessionRecovery(() => storage));
    // Both rolls score one die; the remaining SAFE faces are 2.
    const faces = [1, ...Array<number>(12).fill(2)];
    const draws = faces.flatMap((face) => [0.9, (face - 0.5) / 6]);
    let index = 0;
    const rolling = createGameStore({ next: () => draws[index++]! }, new SessionRecovery(() => storage));
    rolling.dispatch(state.revision, { type: 'roll' });
    expect(rolling.getSnapshot().busy).toBe(true);
    const committed = rolling.getSnapshot().state;
    const restored = createGameStore(noDraw, new SessionRecovery(() => storage));
    expect(restored.getSnapshot()).toMatchObject({ state: committed, visibleState: committed, busy: false });
    expect(committed).toMatchObject({ turn: { rollNumber: 2, nextRollNumber: 3, result: { outcome: 'continue' } } });
    restored.dispatch(state.revision, { type: 'roll' });
    restored.reveal(state.revision);
    restored.presented(state.revision);
    expect(restored.getSnapshot().state).toBe(restored.getSnapshot().visibleState);
    expect(restored.getSnapshot().state).toEqual(committed);
    store.dispatch(state.revision - 1, { type: 'roll' });
    expect(calls).toBe(0);
    const final = roll(committed, [1, ...Array<number>(11).fill(2)]);
    accepted(final);
    expect(final).toMatchObject({ turn: { rollNumber: 3, nextRollNumber: 4, result: { outcome: 'turnEnd', reason: 'rollLimit' } } });
    expect(act(final, { type: 'roll' })).toBe(final);
  });
  it('keeps multiple loser association and Final Result intact without repeat draws', () => {
    const state = finished();
    expect(state.penalty.penalties).toMatchObject([
      { playerId: 'a', diceCount: 14, basePenalty: 49, multiplier: 2, finalPenalty: 98 },
      { playerId: 'm', diceCount: 14, basePenalty: 84, multiplier: 2, finalPenalty: 168 },
    ]);
    rejected({ ...state, penalty: { ...state.penalty, penalties: [...state.penalty.penalties].reverse() } });
    rejected({ ...state, penaltyIndex: 0 });
    rejected({ ...state, penalty: { ...state.penalty, penalties: state.penalty.penalties.map((entry) => ({ ...entry, playerId: 'z' })) } });
    const storage = new MemoryStorage();
    new SessionRecovery(() => storage).saveGame(state);
    const store = createGameStore(noDraw, new SessionRecovery(() => storage));
    expect(store.getSnapshot()).toMatchObject({ state, visibleState: state, busy: false, recovered: true });
    store.dispatch(state.revision, { type: 'rollPenalty' });
    store.dispatch(state.revision - 1, { type: 'replay' });
    expect(store.getSnapshot().state).toEqual(state);
  });
  it.each([true, false])('preserves Sound %s independently of malformed/unsupported game data and reset', (enabled) => {
    for (const raw of ['{', JSON.stringify({ version: 2, state: initialFlow() }), JSON.stringify({ version: 99 }),
      JSON.stringify({ state: initialFlow() })]) {
      const storage = new MemoryStorage();
      const sound = JSON.stringify({ version: 1, enabled });
      storage.setItem(SESSION_SOUND_KEY, sound);
      storage.setItem(SESSION_GAME_KEY, raw);
      const recovery = new SessionRecovery(() => storage);
      expect(recovery.loadGame().recovered).toBe(false);
      expect(recovery.loadSound()).toEqual({ enabled });
      recovery.saveGame(act(initialFlow(), { type: 'fullReset' }));
      expect(new SessionRecovery(() => storage).loadSound()).toEqual({ enabled });
      expect(storage.getItem(SESSION_SOUND_KEY)).toBe(sound);
    }
  });
});
