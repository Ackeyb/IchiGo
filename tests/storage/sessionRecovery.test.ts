import { describe, expect, it } from 'vitest';
import { createGameStore } from '../../src/app/gameStore';
import { advanceFlow, initialFlow } from '../../src/game/gameFlow';
import type { FlowAction, FlowState } from '../../src/game/gameFlow';
import type { RandomSource } from '../../src/game/randomSource';
import {
  SESSION_GAME_KEY,
  SESSION_SCHEMA_VERSION,
  SessionRecovery,
} from '../../src/storage/sessionRecovery';
import type { StorageAdapter } from '../../src/storage/sessionRecovery';

class MemoryStorage implements StorageAdapter {
  readonly values = new Map<string, string>();
  getCalls = 0;
  setCalls = 0;
  removeCalls = 0;
  failGet = false;
  failSet = false;
  failRemove = false;
  getItem(key: string) { this.getCalls++; if (this.failGet) throw new Error('get'); return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.setCalls++; if (this.failSet) throw new Error('set'); this.values.set(key, value); }
  removeItem(key: string) { this.removeCalls++; if (this.failRemove) throw new Error('remove'); this.values.delete(key); }
}

class Sequence implements RandomSource {
  calls = 0;
  constructor(private readonly values: readonly number[]) {}
  next() { return this.values[this.calls++] ?? 0.9; }
}

const setup = { participants: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], throwStyle: 'normal' as const };
const normal = (...faces: number[]) => faces.flatMap((face) => [0.9, (face - 0.5) / 6]);
const complete = normal(1, 1, 1, 1, 1, 1, 1);
const allOut = Array<number>(7).fill(0);
const act = (state: FlowState, action: FlowAction, random: RandomSource) => advanceFlow(state, state.revision, action, random);

function activeState(): FlowState {
  return act(initialFlow(), { type: 'start', setup }, new Sequence([]));
}

function readSaved(storage: MemoryStorage): FlowState | undefined {
  return new SessionRecovery(() => storage).loadGame().state;
}

describe('session recovery format and validation', () => {
  it('rejects a ready flow snapshot carrying an already rolled player', () => {
    const state = act(activeState(), { type: 'roll' }, new Sequence(normal(1, 2, 2, 2, 2, 2, 2)));
    if (state.phase !== 'turn') throw new Error('turn expected');
    expectValidStateToBeRejected({ ...state, turn: { ...state.turn, phase: 'ready' } });
  });

  it('rejects roll numbers inconsistent with the number of previously removed dice', () => {
    const state = act(activeState(), { type: 'roll' }, new Sequence(normal(1, 2, 2, 2, 2, 2, 2)));
    if (state.phase !== 'turn' || state.turn.phase !== 'result') throw new Error('result expected');
    expectValidStateToBeRejected({ ...state, turn: { ...state.turn, rollNumber: 2, nextRollNumber: 3 } });
  });

  it('rejects a roll result belonging to a different player snapshot', () => {
    const continued = act(activeState(), { type: 'roll' }, new Sequence(normal(1, 2, 2, 2, 2, 2, 2)));
    const ended = act(activeState(), { type: 'roll' }, new Sequence(normal(2, 2, 2, 2, 2, 2, 2)));
    if (continued.phase !== 'turn' || continued.turn.phase !== 'result'
      || ended.phase !== 'turn' || ended.turn.phase !== 'result') throw new Error('result expected');
    expectValidStateToBeRejected({ ...continued, turn: { ...continued.turn, result: ended.turn.result } });
  });

  it('rejects OUT state under the careful throw style', () => {
    const state = act(activeState(), { type: 'roll' }, new Sequence(allOut));
    if (state.phase !== 'turn') throw new Error('turn expected');
    expectValidStateToBeRejected({ ...state, game: { ...state.game, throwStyle: 'careful' },
      turn: { ...state.turn, throwStyle: 'careful' } });
  });

  it('rejects a self-consistent penalty calculated from the wrong number of dice', () => {
    const random = new Sequence([...complete, ...allOut]);
    let state = activeState();
    for (const type of ['roll', 'next', 'roll', 'ranking', 'reveal', 'penalty', 'rollPenalty'] as const) {
      state = act(state, { type }, random);
    }
    if (state.phase !== 'penalty') throw new Error('penalty expected');
    const entry = state.penalty.penalties[0]!;
    expectValidStateToBeRejected({ ...state, penalty: { ...state.penalty, penalties: [{ ...entry,
      status: 'resolved', penaltyRoll: [1], basePenalty: 1, multiplier: 2, finalPenalty: 2,
    }] } });
  });

  it('saves and loads a versioned valid authoritative state', () => {
    const storage = new MemoryStorage();
    const recovery = new SessionRecovery(() => storage);
    const state = activeState();
    expect(recovery.saveGame(state)).toBeUndefined();
    expect(JSON.parse(storage.values.get(SESSION_GAME_KEY)!)).toEqual({ version: SESSION_SCHEMA_VERSION, state });
    expect(new SessionRecovery(() => storage).loadGame()).toEqual({ state, recovered: true });
  });

  it.each([
    ['corrupt JSON', '{oops'],
    ['invalid schema', JSON.stringify({ version: 1, state: { phase: 'turn' } })],
    ['unsupported version', JSON.stringify({ version: 99, state: activeState() })],
  ])('rejects %s and removes it', (_label, raw) => {
    const storage = new MemoryStorage();
    storage.values.set(SESSION_GAME_KEY, raw);
    const result = new SessionRecovery(() => storage).loadGame();
    expect(result).toEqual({ recovered: false, notice: 'corrupt' });
    expect(storage.values.has(SESSION_GAME_KEY)).toBe(false);
  });

  it('rejects a dice invariant violation', () => {
    const storage = new MemoryStorage();
    const state = structuredClone(activeState());
    if (state.phase !== 'turn') throw new Error('turn expected');
    (state.game.players[0] as { activeDice: number }).activeDice = 6;
    storage.values.set(SESSION_GAME_KEY, JSON.stringify({ version: 1, state }));
    expect(new SessionRecovery(() => storage).loadGame()).toEqual({ recovered: false, notice: 'corrupt' });
  });

  it('rejects stale operation identity and inconsistent penalty calculations', () => {
    const staleTurn = structuredClone(activeState());
    if (staleTurn.phase !== 'turn') throw new Error('turn expected');
    (staleTurn.turn as { turnId: string }).turnId = 'old/turn/id';
    expectValidStateToBeRejected(staleTurn);

    const random = new Sequence([...complete, ...allOut, ...Array<number>(7).fill(0)]);
    let penalty = act(initialFlow(), { type: 'start', setup }, random);
    for (const action of [
      { type: 'roll' }, { type: 'next' }, { type: 'roll' }, { type: 'ranking' },
      { type: 'reveal' }, { type: 'penalty' }, { type: 'rollPenalty' },
    ] as const) penalty = act(penalty, action, random);
    if (penalty.phase !== 'penalty' || penalty.penalty.penalties[0]?.status !== 'resolved') throw new Error('resolved penalty expected');
    const corruptPenalty = structuredClone(penalty);
    const entry = corruptPenalty.penalty.penalties[0];
    if (entry?.status !== 'resolved') throw new Error('resolved penalty expected');
    (entry as { finalPenalty: number }).finalPenalty += 1;
    expectValidStateToBeRejected(corruptPenalty);
  });

  it('fails open when storage access or getItem fails', () => {
    expect(new SessionRecovery(() => { throw new Error('access'); }).loadGame())
      .toEqual({ recovered: false, notice: 'unavailable' });
    const storage = new MemoryStorage(); storage.failGet = true;
    const recovery = new SessionRecovery(() => storage);
    expect(recovery.loadGame()).toEqual({ recovered: false, notice: 'unavailable' });
    expect(recovery.saveGame(activeState())).toBe('unavailable');
  });

  it('keeps the last good snapshot after setItem failure and retries later', () => {
    const storage = new MemoryStorage();
    const recovery = new SessionRecovery(() => storage);
    const first = activeState();
    recovery.saveGame(first);
    const second = act(first, { type: 'roll' }, new Sequence(normal(1, 2, 2, 2, 2, 2, 2)));
    storage.failSet = true;
    expect(recovery.saveGame(second)).toBe('save-failed');
    expect(readSaved(storage)).toEqual(first);
    storage.failSet = false;
    expect(recovery.saveGame(second)).toBeUndefined();
    expect(readSaved(storage)).toEqual(second);
  });

  it('uses a cleared marker when removeItem fails so an old game cannot return', () => {
    const storage = new MemoryStorage();
    const recovery = new SessionRecovery(() => storage);
    recovery.saveGame(activeState());
    storage.failRemove = true;
    expect(recovery.clearGame()).toBe('remove-failed');
    expect(new SessionRecovery(() => storage).loadGame()).toEqual({ recovered: false });
  });

  it('stays memory-only when corrupt data cannot be deleted or overwritten', () => {
    const storage = new MemoryStorage();
    storage.values.set(SESSION_GAME_KEY, '{bad');
    storage.failRemove = true;
    storage.failSet = true;
    const recovery = new SessionRecovery(() => storage);
    expect(recovery.loadGame()).toEqual({ recovered: false, notice: 'corrupt' });
    expect(recovery.loadGame()).toEqual({ recovered: false, notice: 'corrupt' });
    expect(storage.getCalls).toBe(1);
  });
});

function expectValidStateToBeRejected(state: FlowState): void {
  const storage = new MemoryStorage();
  storage.values.set(SESSION_GAME_KEY, JSON.stringify({ version: 1, state }));
  expect(new SessionRecovery(() => storage).loadGame()).toEqual({ recovered: false, notice: 'corrupt' });
}

describe('authoritative save checkpoints', () => {
  it('persists every major transition, including reset semantics', () => {
    const storage = new MemoryStorage();
    const recovery = new SessionRecovery(() => storage);
    const random = new Sequence([...complete, ...allOut, ...Array<number>(7).fill(0)]);
    const store = createGameStore(random, recovery);
    const perform = (action: FlowAction) => {
      const revision = store.getSnapshot().state.revision;
      store.dispatch(revision, action);
      const committed = store.getSnapshot().state;
      expect(readSaved(storage)).toEqual(committed);
      store.presented(committed.revision);
    };

    perform({ type: 'start', setup });
    perform({ type: 'roll' }); // COMPLETE is saved before presentation acknowledgment.
    perform({ type: 'next' });
    perform({ type: 'roll' });
    perform({ type: 'ranking' });
    perform({ type: 'reveal' });
    perform({ type: 'penalty' });
    perform({ type: 'rollPenalty' });
    perform({ type: 'finish' });
    perform({ type: 'replay' });
    expect(readSaved(storage)?.phase).toBe('turn');

    const revision = store.getSnapshot().state.revision;
    store.dispatch(revision, { type: 'newGame' });
    expect(store.getSnapshot().state.phase).toBe('setup');
    expect(readSaved(storage)).toBeUndefined();
  });

  it('persists the sudden-death screen and reset round', () => {
    const storage = new MemoryStorage();
    const random = new Sequence([...complete, ...complete]);
    const store = createGameStore(random, new SessionRecovery(() => storage));
    const perform = (action: FlowAction) => {
      store.dispatch(store.getSnapshot().state.revision, action);
      store.presented(store.getSnapshot().state.revision);
    };
    perform({ type: 'start', setup }); perform({ type: 'roll' }); perform({ type: 'next' }); perform({ type: 'roll' });
    perform({ type: 'ranking' }); perform({ type: 'suddenDeath' });
    expect(readSaved(storage)?.phase).toBe('suddenDeath');
    perform({ type: 'startSuddenDeath' });
    const restored = readSaved(storage);
    expect(restored?.phase).toBe('turn');
    if (restored?.phase !== 'turn') throw new Error('turn expected');
    expect(restored.game.suddenDeathCount).toBe(1);
    expect(restored.game.totalCompletionCount).toBe(2);
  });

  it('persists advancement to the next tied loser during penalties', () => {
    const storage = new MemoryStorage();
    const threePlayerSetup = { participants: [...setup.participants, { id: 'c', name: 'C' }], throwStyle: 'normal' as const };
    const random = new Sequence([...complete, ...allOut, ...allOut, ...Array<number>(14).fill(0)]);
    const store = createGameStore(random, new SessionRecovery(() => storage));
    const perform = (action: FlowAction) => {
      store.dispatch(store.getSnapshot().state.revision, action);
      store.presented(store.getSnapshot().state.revision);
    };
    perform({ type: 'start', setup: threePlayerSetup });
    perform({ type: 'roll' }); perform({ type: 'next' }); perform({ type: 'roll' }); perform({ type: 'next' }); perform({ type: 'roll' });
    perform({ type: 'ranking' }); perform({ type: 'reveal' }); perform({ type: 'penalty' }); perform({ type: 'rollPenalty' });
    perform({ type: 'nextPenalty' });
    const restored = readSaved(storage);
    expect(restored?.phase).toBe('penalty');
    if (restored?.phase !== 'penalty') throw new Error('penalty expected');
    expect(restored.penaltyIndex).toBe(1);
    expect(restored.penalty.penalties.map((entry) => entry.status)).toEqual(['resolved', 'pending']);
  });

  it('continues in memory when saving a committed roll fails', () => {
    const storage = new MemoryStorage();
    const recovery = new SessionRecovery(() => storage);
    const random = new Sequence(normal(1, 2, 2, 2, 2, 2, 2));
    const store = createGameStore(random, recovery);
    store.dispatch(0, { type: 'start', setup }); store.presented(1);
    storage.failSet = true;
    store.dispatch(1, { type: 'roll' });
    expect(store.getSnapshot().state.revision).toBe(2);
    expect(store.getSnapshot().state.phase).toBe('turn');
    expect(store.getSnapshot().busy).toBe(true);
    expect(store.getSnapshot().recoveryNotice).toBe('save-failed');
    expect(random.calls).toBe(14);
    store.presented(2);
    expect(store.getSnapshot().busy).toBe(false);
  });
});

describe('reload safety', () => {
  it('restores an animation-time committed roll without rerolling or consuming randomness', () => {
    const storage = new MemoryStorage();
    const firstRandom = new Sequence(normal(1, 2, 2, 2, 2, 2, 2));
    const first = createGameStore(firstRandom, new SessionRecovery(() => storage));
    first.dispatch(0, { type: 'start', setup }); first.presented(1); first.dispatch(1, { type: 'roll' });
    expect(first.getSnapshot().busy).toBe(true);

    const reloadRandom = new Sequence(normal(5, 2, 2, 2, 2, 2));
    const restored = createGameStore(reloadRandom, new SessionRecovery(() => storage));
    const snapshot = restored.getSnapshot();
    expect(snapshot.recovered).toBe(true);
    expect(snapshot.busy).toBe(false);
    expect(snapshot.visibleState).toBe(snapshot.state);
    expect(snapshot.state).toEqual(first.getSnapshot().state);
    expect(reloadRandom.calls).toBe(0);

    restored.dispatch(snapshot.state.revision - 1, { type: 'roll' });
    expect(reloadRandom.calls).toBe(0);
    restored.dispatch(snapshot.state.revision, { type: 'roll' });
    expect(reloadRandom.calls).toBe(12);
  });
});
