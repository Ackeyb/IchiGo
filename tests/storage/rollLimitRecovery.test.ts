import { describe, expect, it } from 'vitest';
import { createGameStore } from '../../src/app/gameStore';
import { advanceFlow, initialFlow } from '../../src/game/gameFlow';
import type { FlowAction, FlowState } from '../../src/game/gameFlow';
import { initialSetup } from '../../src/game/setup';
import type { RollLimit } from '../../src/game/types';
import { SESSION_GAME_KEY, SESSION_SCHEMA_VERSION, SESSION_SOUND_KEY, SOUND_SCHEMA_VERSION, SessionRecovery, validateStoredFlowState } from '../../src/storage/sessionRecovery';

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}
const setup = { ...initialSetup(), participants: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], rollLimit: 3 as const };
const noDraw = { next: (): number => { throw new Error('Unexpected random draw'); } };
const act = (state: FlowState, action: FlowAction) => advanceFlow(state, state.revision, action, noDraw);
function roll(state: FlowState, faces: readonly number[]) {
  const values = faces.flatMap((face) => [0.9, (face - 0.5) / 6]);
  let index = 0;
  return advanceFlow(state, state.revision, { type: 'roll' }, { next: () => {
    const value = values[index++];
    if (value === undefined) throw new Error('Unexpected random draw');
    return value;
  } });
}
function afterRolls(count: number) {
  let state = act(initialFlow(), { type: 'start', setup });
  for (let index = 0; index < count; index++) state = roll(state, [1, ...Array<number>(6 - index).fill(2)]);
  if (state.phase !== 'turn' || state.turn.phase !== 'result') throw new Error('Expected result');
  return { ...state, turn: state.turn };
}
function load(state: unknown, version: number = SESSION_SCHEMA_VERSION) {
  const storage = new MemoryStorage();
  storage.setItem(SESSION_GAME_KEY, JSON.stringify({ version, state }));
  return new SessionRecovery(() => storage).loadGame();
}
function replay() {
  let state = act(initialFlow(), { type: 'start', setup });
  state = roll(state, Array<number>(7).fill(1));
  state = act(state, { type: 'next' });
  state = roll(state, Array<number>(7).fill(2));
  for (const type of ['ranking', 'reveal', 'penalty'] as const) state = act(state, { type });
  state = advanceFlow(state, state.revision, { type: 'rollPenalty' }, { next: () => 0 });
  state = act(state, { type: 'finish' });
  state = act(state, { type: 'replay' });
  if (state.phase !== 'replayPreparation') throw new Error('Expected replay');
  return state;
}

describe('ROLL limit Recovery v3', () => {
  it('uses game schema 3 while Sound remains schema 1', () => {
    expect(SESSION_SCHEMA_VERSION).toBe(3);
    expect(SOUND_SCHEMA_VERSION).toBe(1);
    const ready = act(initialFlow(), { type: 'start', setup });
    expect(load(ready)).toEqual({ state: ready, recovered: true });
    expect(ready).toMatchObject({ turn: { nextRollNumber: 1 } });
  });
  it('rejects schema 2 even with otherwise valid v3 data', () => {
    expect(load(afterRolls(1), 2)).toEqual({ recovered: false, notice: 'corrupt' });
  });
  it.each([null, 1, 2, 3, 4, 5] as readonly RollLimit[])('saves an explicit %s limit in setup drafts and game state', (rollLimit) => {
    const draft = { ...initialFlow(), draft: { ...initialSetup(), rollLimit } };
    const game = act(initialFlow(), { type: 'start', setup: { ...setup, rollLimit } });
    for (const state of [draft, game]) {
      const storage = new MemoryStorage();
      new SessionRecovery(() => storage).saveGame(state);
      expect(JSON.parse(storage.getItem(SESSION_GAME_KEY)!)).toEqual({ version: 3, state });
      expect(new SessionRecovery(() => storage).loadGame()).toEqual({ state, recovered: true });
    }
  });
  it('rejects missing rollLimit in setup, replay draft/source and game without filling null', () => {
    const draft = initialFlow();
    const preparation = replay();
    const game = afterRolls(1);
    for (const [state, path] of [[draft, 'draft'], [preparation, 'draft'], [preparation, 'replaySource'], [game, 'game']] as const) {
      const corrupt = structuredClone(state) as unknown as Record<string, Record<string, unknown>>;
      delete corrupt[path]!.rollLimit;
      expect(load(corrupt)).toEqual({ recovered: false, notice: 'corrupt' });
    }
  });
  it('restores next ROLL 2/3 after one committed roll without drawing on reload', () => {
    const state = afterRolls(1);
    const storage = new MemoryStorage();
    new SessionRecovery(() => storage).saveGame(state);
    const restored = createGameStore(noDraw, new SessionRecovery(() => storage)).getSnapshot();
    expect(restored).toMatchObject({ recovered: true, busy: false, state: { turn: { nextRollNumber: 2, rollNumber: 1, result: { outcome: 'continue' } } } });
    expect(restored.state).toEqual(state);
  });
  it('restores limit 3 / roll 2 continuation with nextRollNumber 3', () => {
    const state = afterRolls(2);
    expect(load(state)).toEqual({ state, recovered: true });
    expect(state.turn).toMatchObject({ rollNumber: 2, nextRollNumber: 3, result: { outcome: 'continue' } });
  });
  it('accepts final roll 3 termination and nextRollNumber 4, and rejects further rolls without draws', () => {
    const state = afterRolls(3);
    const restored = load(state).state;
    expect(restored).toEqual(state);
    expect(state.turn).toMatchObject({ rollNumber: 3, nextRollNumber: 4, result: { outcome: 'turnEnd', reason: 'rollLimit' } });
    expect(act(restored!, { type: 'roll' })).toBe(restored);
  });
  it('rejects result reason mismatches, missing reasons and reasons on continuation', () => {
    const ended = afterRolls(3);
    for (const reason of ['noScore', 'noActiveDice', undefined]) {
      expect(load({ ...ended, turn: { ...ended.turn, result: { ...ended.turn.result, reason } } }))
        .toEqual({ recovered: false, notice: 'corrupt' });
    }
    const continued = afterRolls(2);
    expect(load({ ...continued, turn: { ...continued.turn, result: { ...continued.turn.result, reason: 'rollLimit' } } }))
      .toEqual({ recovered: false, notice: 'corrupt' });
  });
  it('rejects final-roll continuation even when player finish flags are consistent with it', () => {
    const ended = afterRolls(3);
    const player = { ...ended.turn.player, turnFinished: false };
    const result = { ...ended.turn.result, player, outcome: 'continue' } as Record<string, unknown>;
    delete result.reason;
    expect(load({ ...ended, game: { ...ended.game, players: [{ id: 'a', ...player }, ended.game.players[1]] },
      turn: { ...ended.turn, player, result } })).toEqual({ recovered: false, notice: 'corrupt' });
  });
  it('rejects a result beyond its finite limit', () => {
    const state = afterRolls(2);
    expect(load({ ...state, game: { ...state.game, rollLimit: 1 } })).toEqual({ recovered: false, notice: 'corrupt' });
  });
  it('restores replay order and rejects a draft/source rollLimit mismatch', () => {
    const preparation = replay();
    const reordered = act(preparation, { type: 'reorderReplay', participantIds: ['b', 'a'] });
    expect(load(reordered)).toEqual({ state: reordered, recovered: true });
    expect(load({ ...preparation, draft: { ...preparation.draft, rollLimit: 2 } })).toEqual({ recovered: false, notice: 'corrupt' });
  });
  it('keeps valid Sound OFF through v2 rejection, v3 recovery and full reset', () => {
    const storage = new MemoryStorage();
    storage.setItem(SESSION_SOUND_KEY, JSON.stringify({ version: 1, enabled: false }));
    storage.setItem(SESSION_GAME_KEY, JSON.stringify({ version: 2, state: afterRolls(1) }));
    const rejected = new SessionRecovery(() => storage);
    expect(rejected.loadGame().recovered).toBe(false);
    expect(rejected.loadSound().enabled).toBe(false);
    const reset = act({ phase: 'setup', revision: 1, gameNumber: 0, setupKind: 'initial', draft: setup }, { type: 'fullReset' });
    rejected.saveGame(reset);
    const recovered = new SessionRecovery(() => storage);
    expect(recovered.loadGame()).toEqual({ state: reset, recovered: true });
    expect(recovered.loadSound()).toEqual({ enabled: false });
    expect(storage.getItem(SESSION_SOUND_KEY)).toBe(JSON.stringify({ version: 1, enabled: false }));
  });
  it('keeps no-score and COMPLETE final-roll results valid under the same resolver rules', () => {
    for (const face of [1, 2]) {
      const ready = act(initialFlow(), { type: 'start', setup: { ...setup, rollLimit: 1 } });
      const state = roll(ready, Array<number>(7).fill(face));
      expect(validateStoredFlowState(state)).toBe(true);
      expect(load(state).state).toEqual(state);
    }
  });
});
