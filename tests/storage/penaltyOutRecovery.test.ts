import { describe, expect, it } from 'vitest';
import { createGameStore } from '../../src/app/gameStore';
import { advanceFlow, initialFlow } from '../../src/game/gameFlow';
import type { FlowAction } from '../../src/game/gameFlow';
import { initialSetup } from '../../src/game/setup';
import type { DiceMode, DieResult, ThrowStyle } from '../../src/game/types';
import { SESSION_GAME_KEY, SESSION_SCHEMA_VERSION, SESSION_SOUND_KEY, SOUND_SCHEMA_VERSION, SessionRecovery } from '../../src/storage/sessionRecovery';

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}
const out: DieResult = { status: 'out', value: null };
const normal = (count: number, face: number) => Array.from({ length: count }, () => [0.9, (face - 0.5) / 6]).flat();
function penaltyState(values: readonly number[], throwStyle: ThrowStyle = 'normal', diceMode: DiceMode = 7) {
  let index = 0;
  const draws = [...normal(diceMode, 1), ...normal(diceMode, 2), ...values];
  const random = { next: () => {
    const value = draws[index++];
    if (value === undefined) throw new Error('Unexpected random draw');
    return value;
  } };
  let state = initialFlow();
  const perform = (action: FlowAction) => { state = advanceFlow(state, state.revision, action, random); };
  perform({ type: 'start', setup: { ...initialSetup(), diceMode, throwStyle,
    participants: [{ id: 'w', name: 'W' }, { id: 'l', name: 'L' }] } });
  for (const type of ['roll', 'next', 'roll', 'ranking', 'reveal', 'penalty', 'rollPenalty'] as const) perform({ type });
  if (state.phase !== 'penalty' || state.penalty.penalties[0]?.status !== 'resolved') throw new Error('Expected resolved penalty');
  return state;
}
const mixed = () => penaltyState([0, ...normal(1, 2), ...normal(1, 5), 0, ...normal(1, 1), ...normal(1, 3), ...normal(1, 4)]);
function restore(state: unknown) {
  const storage = new MemoryStorage();
  storage.setItem(SESSION_GAME_KEY, JSON.stringify({ version: 4, state }));
  return new SessionRecovery(() => storage).loadGame();
}
function patchEntry(patch: Record<string, unknown>) {
  const state = mixed();
  return { ...state, penalty: { ...state.penalty, penalties: [{ ...state.penalty.penalties[0], ...patch }] } };
}

describe('Penalty OUT recovery without new draws', () => {
  it.each(['rough', 'normal', 'careful'] as const)('restores SAFE-only results for %s', (style) => {
    const state = penaltyState(normal(7, 5), style);
    expect(restore(state)).toEqual({ state, recovered: true });
  });
  it('restores mixed OUT in committed order and never consumes RandomSource on reload or repeat', () => {
    const state = mixed();
    const storage = new MemoryStorage();
    new SessionRecovery(() => storage).saveGame(state);
    let calls = 0;
    const store = createGameStore({ next: () => { calls++; throw new Error('Unexpected draw'); } }, new SessionRecovery(() => storage));
    expect(store.getSnapshot().state).toEqual(state);
    const saved = store.getSnapshot().state;
    if (saved.phase !== 'penalty' || saved.penalty.penalties[0]?.status !== 'resolved') throw new Error('Expected penalty');
    expect(saved.penalty.penalties[0].penaltyRoll).toEqual([out, { status: 'safe', value: 2 }, { status: 'safe', value: 5 }, out,
      { status: 'safe', value: 1 }, { status: 'safe', value: 3 }, { status: 'safe', value: 4 }]);
    expect(saved.penalty.penalties[0]).toMatchObject({ basePenalty: 27, multiplier: 2, finalPenalty: 54 });
    store.dispatch(saved.revision, { type: 'rollPenalty' });
    expect(store.getSnapshot().state).toBe(saved);
    expect(calls).toBe(0);
  });
  it.each(['rough', 'normal'] as const)('accepts 14 all-OUT dice under %s without rejecting rarity', (style) => {
    const state = penaltyState(Array<number>(14).fill(0), style, 14);
    expect(restore(state).state).toEqual(state);
    expect(state.penalty.penalties[0]).toMatchObject({ diceCount: 14, penaltyRoll: Array<DieResult>(14).fill(out), basePenalty: 84, finalPenalty: 168 });
  });
  it.each([{ status: 'out', value: 6 }, { status: 'out', value: 0 }, { status: 'out' }, { status: 'safe', value: null },
    { status: 'safe', value: 7 }, { status: 'other', value: null }, 6])('rejects malformed saved die %j', (die) => {
    const state = mixed();
    const entry = state.penalty.penalties[0];
    if (entry?.status !== 'resolved') throw new Error('Expected penalty');
    expect(restore(patchEntry({ penaltyRoll: [die, ...entry.penaltyRoll.slice(1)] }))).toEqual({ recovered: false, notice: 'corrupt' });
  });
  it.each([{ basePenalty: 26 }, { multiplier: 3 }, { finalPenalty: 53 }, { diceCount: 6 }, { penaltyRoll: [] },
    { penaltyRoll: Array<DieResult>(6).fill(out), basePenalty: 36, finalPenalty: 72 }])('rejects inconsistent saved counts/calculation %j', (patch) => {
    expect(restore(patchEntry(patch))).toEqual({ recovered: false, notice: 'corrupt' });
  });
  it('rejects legacy numeric penalty results even inside a schema 4 envelope', () => {
    expect(restore(patchEntry({ penaltyRoll: [6, 2, 5, 6, 1, 3, 4] }))).toEqual({ recovered: false, notice: 'corrupt' });
  });
  it('rejects saved OUT under careful even when BASE and FINAL are correct', () => {
    const state = mixed();
    expect(restore({ ...state, game: { ...state.game, throwStyle: 'careful' } })).toEqual({ recovered: false, notice: 'corrupt' });
  });
  it('keeps game schema 4 and Sound schema 1 / OFF unchanged', () => {
    expect(SESSION_SCHEMA_VERSION).toBe(4);
    expect(SOUND_SCHEMA_VERSION).toBe(1);
    const storage = new MemoryStorage();
    storage.setItem(SESSION_SOUND_KEY, JSON.stringify({ version: 1, enabled: false }));
    new SessionRecovery(() => storage).saveGame(mixed());
    const recovered = new SessionRecovery(() => storage);
    expect(recovered.loadGame().recovered).toBe(true);
    expect(recovered.loadSound()).toEqual({ enabled: false });
    expect(storage.getItem(SESSION_SOUND_KEY)).toBe(JSON.stringify({ version: 1, enabled: false }));
  });
});
