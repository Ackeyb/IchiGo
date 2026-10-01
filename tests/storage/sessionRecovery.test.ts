import { describe, expect, it } from 'vitest';
import { createGameStore } from '../../src/app/gameStore';
import { advanceFlow, initialFlow } from '../../src/game/gameFlow';
import type { FlowAction, FlowState } from '../../src/game/gameFlow';
import type { RandomSource } from '../../src/game/randomSource';
import {
  SESSION_GAME_KEY,
  SESSION_SCHEMA_VERSION,
  SESSION_SOUND_KEY,
  SOUND_SCHEMA_VERSION,
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

const setup = { rollLimit: null, participants: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], throwStyle: 'normal' as const, diceMode: 7 as const };
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
      status: 'resolved', penaltyRoll: [{ status: 'safe', value: 1 }], basePenalty: 1, multiplier: 2, finalPenalty: 2,
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

  it.each([5, 7, 10] as const)('saves and restores an editable %i-dice setup draft with blank names', (diceMode) => {
    const storage = new MemoryStorage();
    const recovery = new SessionRecovery(() => storage);
    const draft: FlowState = {
      phase: 'setup', revision: 4, gameNumber: 1, setupKind: 'newGame',
      draft: { rollLimit: null, participants: [{ id: 'kept-b', name: '' }, { id: 'kept-a', name: '編集中 ' }], throwStyle: 'rough', diceMode },
    };
    expect(recovery.saveGame(draft)).toBeUndefined();
    expect(new SessionRecovery(() => storage).loadGame()).toEqual({ state: draft, recovered: true });
  });

  it('restores a replay reorder and rejects persisted replay rename or setting changes', () => {
    const storage = new MemoryStorage();
    const random = new Sequence([...complete, ...allOut, ...Array<number>(7).fill(0)]);
    let state = activeState();
    for (const type of ['roll', 'next', 'roll', 'ranking', 'reveal', 'penalty', 'rollPenalty', 'finish', 'replay'] as const) {
      state = act(state, { type }, random);
    }
    state = act(state, { type: 'reorderReplay', participantIds: ['b', 'a'] }, random);
    const recovery = new SessionRecovery(() => storage);
    recovery.saveGame(state);
    expect(new SessionRecovery(() => storage).loadGame()).toEqual({ state, recovered: true });
    if (state.phase !== 'replayPreparation') throw new Error('replay preparation expected');
    expectValidStateToBeRejected({ ...state, draft: { ...state.draft,
      participants: [{ ...state.draft.participants[0]!, name: '改名' }, state.draft.participants[1]!],
    } });
    expectValidStateToBeRejected({ ...state, draft: { ...state.draft, diceMode: 5 } });
  });

  it.each([undefined, '7', 6, 8, 11, null])('rejects invalid Dice Mode %s without inferring it from counts', (diceMode) => {
    const state = structuredClone(activeState()) as FlowState;
    if (state.phase !== 'turn') throw new Error('turn expected');
    (state.game as unknown as { diceMode: unknown }).diceMode = diceMode;
    expectValidStateToBeRejected(state);
  });

  it('rejects corrupt setup draft identity, kind, revision and game number fields', () => {
    const valid: FlowState = { phase: 'setup', revision: 2, gameNumber: 1, setupKind: 'initial', draft: setup };
    expectValidStateToBeRejected({ ...valid, setupKind: 'other' } as unknown as FlowState);
    expectValidStateToBeRejected({ ...valid, revision: -1 });
    expectValidStateToBeRejected({ ...valid, gameNumber: 3 });
    expectValidStateToBeRejected({ ...valid, draft: { ...valid.draft,
      participants: [{ id: 'a', name: '' }, { id: 'a', name: '' }],
    } });
  });

  it('rejects a v3 snapshot with missing Dice Mode instead of guessing seven dice', () => {
    const storage = new MemoryStorage();
    const state = structuredClone(activeState());
    if (state.phase !== 'turn') throw new Error('turn expected');
    const legacy = structuredClone(state) as unknown as { game: { diceMode?: number } };
    delete legacy.game.diceMode;
    storage.values.set(SESSION_GAME_KEY, JSON.stringify({ version: SESSION_SCHEMA_VERSION, state: legacy }));
    expect(new SessionRecovery(() => storage).loadGame()).toEqual({ recovered: false, notice: 'corrupt' });
  });

  it.each([
    ['corrupt JSON', '{oops'],
    ['version 1', JSON.stringify({ version: 1, state: activeState() })],
    ['invalid schema', JSON.stringify({ version: SESSION_SCHEMA_VERSION, state: { phase: 'turn' } })],
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
    storage.values.set(SESSION_GAME_KEY, JSON.stringify({ version: SESSION_SCHEMA_VERSION, state }));
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

  it.each([5, 7, 10] as const)('restores a committed %i-dice turn result with current-player identity intact', (diceMode) => {
    const modeSetup = { ...setup, diceMode };
    let state = act(initialFlow(), { type: 'start', setup: modeSetup }, new Sequence([]));
    state = act(state, { type: 'roll' }, new Sequence(normal(...Array<number>(diceMode).fill(2))));
    const storage = new MemoryStorage();
    new SessionRecovery(() => storage).saveGame(state);
    const restored = new SessionRecovery(() => storage).loadGame().state;
    expect(restored).toEqual(state);
    if (restored?.phase !== 'turn') throw new Error('turn expected');
    expect(restored.game.diceMode).toBe(diceMode);
    expect(restored.game.currentPlayerIndex).toBe(0);
    expect(restored.turn.phase).toBe('result');
  });

  it.each([5, 7, 10] as const)('restores valid %i-dice sudden-death and penalty states', (diceMode) => {
    const modeSetup = { ...setup, diceMode };
    const completedRoll = normal(...Array<number>(diceMode).fill(1));
    let sudden = act(initialFlow(), { type: 'start', setup: modeSetup }, new Sequence([]));
    const tiedRandom = new Sequence([...completedRoll, ...completedRoll]);
    for (const type of ['roll', 'next', 'roll', 'ranking', 'suddenDeath'] as const) sudden = act(sudden, { type }, tiedRandom);
    const suddenStorage = new MemoryStorage();
    new SessionRecovery(() => suddenStorage).saveGame(sudden);
    expect(new SessionRecovery(() => suddenStorage).loadGame().state).toEqual(sudden);

    let penalty = act(initialFlow(), { type: 'start', setup: modeSetup }, new Sequence([]));
    const penaltyRandom = new Sequence([...completedRoll, ...Array<number>(diceMode).fill(0), ...Array<number>(diceMode).fill(0)]);
    for (const type of ['roll', 'next', 'roll', 'ranking', 'reveal', 'penalty', 'rollPenalty'] as const) {
      penalty = act(penalty, { type }, penaltyRandom);
    }
    const penaltyStorage = new MemoryStorage();
    new SessionRecovery(() => penaltyStorage).saveGame(penalty);
    expect(new SessionRecovery(() => penaltyStorage).loadGame().state).toEqual(penalty);
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

describe('independent sound persistence', () => {
  it('keeps a version 1 Sound OFF setting when game schema 3 rejects version 2', () => {
    const storage = new MemoryStorage();
    storage.values.set(SESSION_SOUND_KEY, JSON.stringify({ version: SOUND_SCHEMA_VERSION, enabled: false }));
    storage.values.set(SESSION_GAME_KEY, JSON.stringify({ version: 2, state: activeState() }));
    const recovery = new SessionRecovery(() => storage);
    expect(recovery.loadGame()).toEqual({ recovered: false, notice: 'corrupt' });
    expect(recovery.loadSound()).toEqual({ enabled: false });
    expect(storage.values.get(SESSION_SOUND_KEY)).toBe(JSON.stringify({ version: 1, enabled: false }));
  });

  it.each(['{bad', JSON.stringify({ version: 1, enabled: 'false' }), JSON.stringify({ version: 2, enabled: false })])(
    'defaults safely for invalid Sound data: %s', (raw) => {
      const storage = new MemoryStorage();
      storage.values.set(SESSION_SOUND_KEY, raw);
      expect(new SessionRecovery(() => storage).loadSound()).toEqual({ enabled: true });
      expect(storage.values.has(SESSION_SOUND_KEY)).toBe(false);
    },
  );

  it('writes Sound using its independent schema', () => {
    const storage = new MemoryStorage();
    const recovery = new SessionRecovery(() => storage);
    expect(recovery.saveSound(false)).toBeUndefined();
    expect(JSON.parse(storage.values.get(SESSION_SOUND_KEY)!)).toEqual({ version: SOUND_SCHEMA_VERSION, enabled: false });
  });
});

function expectValidStateToBeRejected(state: FlowState): void {
  const storage = new MemoryStorage();
  storage.values.set(SESSION_GAME_KEY, JSON.stringify({ version: SESSION_SCHEMA_VERSION, state }));
  expect(new SessionRecovery(() => storage).loadGame()).toEqual({ recovered: false, notice: 'corrupt' });
}

describe('authoritative save checkpoints', () => {
  it('saves the initial blank setup draft when the store is created', () => {
    const storage = new MemoryStorage();
    createGameStore(new Sequence([]), new SessionRecovery(() => storage));
    expect(readSaved(storage)).toEqual(initialFlow());
  });

  it('persists setup edits without locking the editor and restores them after reload', () => {
    const storage = new MemoryStorage();
    const store = createGameStore(new Sequence([]), new SessionRecovery(() => storage));
    const draft = { rollLimit: null, participants: [{ id: 'p0', name: '途中' }, { id: 'p1', name: '' }], throwStyle: 'careful' as const, diceMode: 10 as const };
    store.dispatch(0, { type: 'updateSetup', draft });
    expect(store.getSnapshot()).toMatchObject({ busy: false, state: { phase: 'setup', revision: 1, draft } });
    const restored = createGameStore(new Sequence([]), new SessionRecovery(() => storage)).getSnapshot();
    expect(restored).toMatchObject({ recovered: true, busy: false, state: { phase: 'setup', setupKind: 'initial', draft } });
  });

  it('persists every major transition, including reset semantics', () => {
    const storage = new MemoryStorage();
    const recovery = new SessionRecovery(() => storage);
    const random = new Sequence([...complete, ...allOut, ...Array<number>(7).fill(0)]);
    const store = createGameStore(random, recovery);
    const perform = (action: FlowAction, persisted = true) => {
      const revision = store.getSnapshot().state.revision;
      store.dispatch(revision, action);
      const committed = store.getSnapshot().state;
      if (persisted) expect(readSaved(storage)).toEqual(committed);
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
    expect(readSaved(storage)?.phase).toBe('replayPreparation');
    perform({ type: 'startReplay' });
    expect(readSaved(storage)?.phase).toBe('turn');

    const revision = store.getSnapshot().state.revision;
    store.dispatch(revision, { type: 'exitGame' });
    expect(store.getSnapshot().state.phase).toBe('setup');
    expect(readSaved(storage)).toEqual(store.getSnapshot().state);
  });

  it('writes new-game carry-over and full-reset drafts into the v2 recovery envelope', () => {
    const storage = new MemoryStorage();
    const store = createGameStore(
      new Sequence([...complete, ...allOut, ...Array<number>(7).fill(0)]),
      new SessionRecovery(() => storage),
    );
    const perform = (action: FlowAction) => {
      store.dispatch(store.getSnapshot().state.revision, action);
      store.presented(store.getSnapshot().state.revision);
    };
    perform({ type: 'start', setup });
    for (const type of ['roll', 'next', 'roll', 'ranking', 'reveal', 'penalty', 'rollPenalty', 'finish'] as const) {
      perform({ type });
    }
    perform({ type: 'newGame' });
    expect(store.getSnapshot().state).toMatchObject({ phase: 'setup', setupKind: 'newGame' });
    expect(readSaved(storage)).toEqual(store.getSnapshot().state);
    expect(createGameStore(new Sequence([]), new SessionRecovery(() => storage)).getSnapshot().state)
      .toEqual(store.getSnapshot().state);
    perform({ type: 'fullReset' });
    expect(store.getSnapshot().state).toMatchObject({ phase: 'setup', setupKind: 'fullReset' });
    expect(readSaved(storage)).toEqual(store.getSnapshot().state);
    expect(createGameStore(new Sequence([]), new SessionRecovery(() => storage)).getSnapshot().state).toEqual({
      phase: 'setup', revision: store.getSnapshot().state.revision, gameNumber: 1, setupKind: 'fullReset',
      draft: { rollLimit: null, participants: [{ id: 'p0', name: '' }, { id: 'p1', name: '' }], throwStyle: 'normal', diceMode: 7 },
    });
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
    const threePlayerSetup = { rollLimit: null, participants: [...setup.participants, { id: 'c', name: 'C' }], throwStyle: 'normal' as const, diceMode: 7 as const };
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
