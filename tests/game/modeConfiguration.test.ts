import { describe, expect, it } from 'vitest';
import { advanceFlow, initialFlow } from '../../src/game/gameFlow';
import type { FlowAction, FlowState } from '../../src/game/gameFlow';
import { initialSetup, switchSetupMode, validateSetup, validateSetupDraft } from '../../src/game/setup';
import type { Setup } from '../../src/game/setup';
import { isCompletionTarget, isSeriesGameCount, isGameMode, isModeConfiguration } from '../../src/game/types';
import type { GameMode, ModeConfiguration } from '../../src/game/types';
import { SessionRecovery, SESSION_GAME_KEY, SESSION_SCHEMA_VERSION, SESSION_SOUND_KEY, SOUND_SCHEMA_VERSION, validateStoredFlowState } from '../../src/storage/sessionRecovery';

const named = () => ({ ...initialSetup(), participants: [{ id: 'b', name: 'B' }, { id: 'a', name: 'A' }] });
const noDraw = { next: (): number => { throw new Error('Unexpected random draw'); } };
const act = (state: FlowState, action: FlowAction) => advanceFlow(state, state.revision, action, noDraw);
const modes: readonly GameMode[] = [{ type: 'normal' }, { type: 'completionTarget', targetCompletions: 5 }, { type: 'series', gameCount: 5 }];

function roundTrip(state: FlowState) {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  new SessionRecovery(() => storage).saveGame(state);
  expect(JSON.parse(values.get(SESSION_GAME_KEY)!)).toEqual({ version: 4, state });
  return new SessionRecovery(() => storage).loadGame();
}

describe('v4 mode configuration', () => {
  it('defaults to Normal with the existing blank draft and separate START validation', () => {
    expect(initialSetup()).toEqual({ mode: { type: 'normal' }, rollLimit: null, diceMode: 7, throwStyle: 'normal',
      participants: [{ id: 'p0', name: '' }, { id: 'p1', name: '' }] });
    expect(validateSetupDraft(initialSetup())).toBe(true);
    expect(validateSetup(initialSetup())).toBe(false);
    expect(validateSetup(named())).toBe(true);
    expect(validateSetup({ ...named(), participants: [{ id: 'b', name: ' x '.repeat(13) }, { id: 'a', name: 'A' }] })).toBe(false);
  });
  it.each([1, 2, 3, 4, 5])('accepts Completion Target %i', (value) => {
    expect(isCompletionTarget(value)).toBe(true);
    expect(validateSetupDraft({ ...initialSetup(), mode: { type: 'completionTarget', targetCompletions: value } })).toBe(true);
  });
  it.each([2, 3, 4, 5])('accepts Series count %i with finite or unlimited rolls', (value) => {
    expect(isSeriesGameCount(value)).toBe(true);
    for (const rollLimit of [null, 1, 5]) expect(validateSetupDraft({ ...initialSetup(), mode: { type: 'series', gameCount: value }, rollLimit })).toBe(true);
  });
  it.each([null, undefined, 0, 6, '1', 1.5, Infinity])('rejects invalid target %s', (value) => {
    expect(isCompletionTarget(value)).toBe(false);
    expect(validateSetupDraft({ ...initialSetup(), mode: { type: 'completionTarget', targetCompletions: value } })).toBe(false);
  });
  it.each([null, undefined, 0, 1, 6, '2', 2.5, Infinity])('rejects invalid Series count %s', (value) => {
    expect(isSeriesGameCount(value)).toBe(false);
    expect(validateSetupDraft({ ...initialSetup(), mode: { type: 'series', gameCount: value } })).toBe(false);
  });
  it.each([undefined, null, 'normal', {}, { type: 'unknown' }, { type: 'normal', targetCompletions: 1 },
    { type: 'normal', gameCount: 2 }, { type: 'completionTarget', targetCompletions: 1, gameCount: 2 },
    { type: 'series', gameCount: 2, targetCompletions: 1 }])('rejects missing, malformed or hidden mode settings %j', (mode) => {
    expect(isGameMode(mode)).toBe(false);
    expect(validateSetupDraft({ ...initialSetup(), mode })).toBe(false);
    expect(validateStoredFlowState({ ...initialFlow(), draft: { ...initialSetup(), mode } })).toBe(false);
  });
  it.each([1, 2, 3, 4, 5])('rejects Completion Target plus finite limit %i in all validators', (rollLimit) => {
    const draft = { ...initialSetup(), mode: { type: 'completionTarget', targetCompletions: 1 }, rollLimit };
    expect(isModeConfiguration(draft)).toBe(false);
    expect(validateSetupDraft(draft)).toBe(false);
    expect(validateStoredFlowState({ ...initialFlow(), draft })).toBe(false);
  });
  it('expresses the correlation in TypeScript', () => {
    // @ts-expect-error Completion Target cannot own a finite limit.
    const invalid: ModeConfiguration = { mode: { type: 'completionTarget', targetCompletions: 1 }, rollLimit: 3 };
    expect(isModeConfiguration(invalid)).toBe(false);
  });
  for (const source of modes) for (const target of modes) {
    it(`switches ${source.type} to ${target.type} without hidden settings`, () => {
      const setup: Setup = source.type === 'completionTarget'
        ? { ...named(), mode: source, rollLimit: null } : { ...named(), mode: source, rollLimit: 3 };
      const before = structuredClone(setup);
      const next = switchSetupMode(setup, target.type);
      if (source.type === target.type) expect(next).toBe(setup);
      else expect(next).toEqual({ ...named(), mode: target.type === 'completionTarget'
        ? { type: target.type, targetCompletions: 1 } : target.type === 'series' ? { type: target.type, gameCount: 2 } : { type: target.type },
      rollLimit: target.type === 'completionTarget' || source.type === 'completionTarget' ? null : 3 });
      expect(setup).toEqual(before);
      expect(validateSetup(next)).toBe(true);
    });
  }
  it('recognizes mode-specific edits and resets to Normal', () => {
    const first = act(initialFlow(), { type: 'updateSetup', draft: switchSetupMode(initialSetup(), 'completionTarget') });
    if (first.phase !== 'setup') throw new Error('Setup expected');
    const next = act(first, { type: 'updateSetup', draft: { ...first.draft, mode: { type: 'completionTarget', targetCompletions: 5 }, rollLimit: null } });
    expect(next.revision).toBe(first.revision + 1);
    expect(act(next, { type: 'fullReset' })).toMatchObject({ draft: initialSetup() });
  });
  it.each(['completionTarget', 'series'] as const)('starts only supported %s gameplay without consuming random', (type) => {
    const start = () => act(initialFlow(), { type: 'start', setup: switchSetupMode(named(), type) });
    if (type === 'series') expect(start).toThrow('まだ開始できません');
    else expect(start()).toMatchObject({ phase: 'turn', game: { mode: { type: 'completionTarget', targetCompletions: 1 } } });
  });
});

describe('v4 configuration recovery and carry', () => {
  it.each([
    { type: 'completionTarget', targetCompletions: 0 },
    { type: 'completionTarget', targetCompletions: 6 },
    { type: 'series', gameCount: 1 },
    { type: 'series', gameCount: 6 },
  ])('rejects invalid mode ranges in schema 4 drafts: %j', (mode) => {
    expect(validateStoredFlowState({ ...initialFlow(), draft: { ...initialSetup(), mode } })).toBe(false);
  });
  it('rejects schema 4 drafts missing mode rather than supplying Normal', () => {
    const { mode, ...draft } = initialSetup();
    expect(mode).toEqual({ type: 'normal' });
    expect(validateStoredFlowState({ ...initialFlow(), draft })).toBe(false);
  });
  it.each(modes)('round-trips $type initial and New Game drafts', (mode) => {
    const draft: Setup = mode.type === 'completionTarget'
      ? { ...initialSetup(), mode, rollLimit: null } : { ...initialSetup(), mode, rollLimit: 5 };
    for (const setupKind of ['initial', 'newGame'] as const) {
      const state: FlowState = { phase: 'setup', revision: 2, gameNumber: 1, setupKind, draft };
      expect(roundTrip(state)).toEqual({ state, recovered: true });
    }
  });
  it.each(modes)('restores $type Replay order while rejecting changes to fixed mode settings', (mode) => {
    const draft: Setup = mode.type === 'completionTarget' ? { ...named(), mode, rollLimit: null } : { ...named(), mode, rollLimit: 3 };
    const state: FlowState = { phase: 'replayPreparation', revision: 2, gameNumber: 1, replaySource: draft,
      draft: { ...draft, participants: [...draft.participants].reverse() } };
    expect(roundTrip(state)).toEqual({ state, recovered: true });
    for (const other of modes.filter((other) => other.type !== mode.type)) {
      expect(validateStoredFlowState({ ...state, draft: { ...state.draft, mode: other, rollLimit: null } })).toBe(false);
    }
    if (mode.type === 'completionTarget') expect(validateStoredFlowState({ ...state, draft: { ...state.draft,
      mode: { type: mode.type, targetCompletions: 1 } } })).toBe(false);
    if (mode.type === 'series') expect(validateStoredFlowState({ ...state, draft: { ...state.draft,
      mode: { type: mode.type, gameCount: 2 } } })).toBe(false);
  });
  it('keeps Normal on running game, Sudden Death, Replay and New Game', () => {
    let state = act(initialFlow(), { type: 'start', setup: named() });
    expect(state).toMatchObject({ game: { mode: { type: 'normal' } } });
    expect(roundTrip(state)).toEqual({ state, recovered: true });
    const roll = (face: number) => { let calls = 0; state = advanceFlow(state, state.revision, { type: 'roll' },
      { next: () => calls++ % 2 === 0 ? 0.9 : (face - 0.5) / 6 }); };
    roll(1); state = act(state, { type: 'next' }); roll(1);
    state = act(state, { type: 'ranking' }); state = act(state, { type: 'suddenDeath' }); state = act(state, { type: 'startSuddenDeath' });
    expect(state).toMatchObject({ game: { mode: { type: 'normal' }, totalCompletionCount: 2 }, turn: { nextRollNumber: 1 } });
    roll(1); state = act(state, { type: 'next' }); roll(2);
    for (const type of ['ranking', 'reveal', 'penalty'] as const) state = act(state, { type });
    state = advanceFlow(state, state.revision, { type: 'rollPenalty' }, { next: () => 0.9 });
    state = act(state, { type: 'finish' });
    for (const type of ['replay', 'newGame'] as const) {
      const prep = act(state, { type });
      expect(prep).toMatchObject({ draft: { mode: { type: 'normal' } } });
      expect(roundTrip(prep)).toEqual({ state: prep, recovered: true });
    }
  });
  it('dispatches runtime validation by supported mode without supplying defaults', () => {
    const state = act(initialFlow(), { type: 'start', setup: named() });
    if (state.phase !== 'turn') throw new Error('Turn expected');
    for (const mode of modes.slice(1)) expect(validateStoredFlowState({ ...state, game: { ...state.game, mode } })).toBe(mode.type === 'completionTarget');
    const { mode: omitted, ...game } = state.game;
    expect(omitted).toEqual({ type: 'normal' });
    expect(validateStoredFlowState({ ...state, game })).toBe(false);
  });
  it.each([true, false])('rejects schema 3 without inferring Normal and retains Sound %s', (enabled) => {
    expect(SESSION_SCHEMA_VERSION).toBe(4);
    expect(SOUND_SCHEMA_VERSION).toBe(1);
    const values = new Map([[SESSION_GAME_KEY, JSON.stringify({ version: 3, state: initialFlow() })],
      [SESSION_SOUND_KEY, JSON.stringify({ version: 1, enabled })]]);
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); } };
    const recovery = new SessionRecovery(() => storage);
    expect(recovery.loadGame()).toEqual({ recovered: false, notice: 'corrupt' });
    expect(recovery.loadSound()).toEqual({ enabled });
  });
});
