import { describe, expect, it } from 'vitest';
import { advanceFlow, initialFlow } from '../../src/game/gameFlow';
import type { FlowAction, FlowState } from '../../src/game/gameFlow';
import { initialSetup } from '../../src/game/setup';
import type { Setup } from '../../src/game/setup';
import type { CompletionTarget, DiceMode, ThrowStyle } from '../../src/game/types';
import { shouldStartNextRound } from '../../src/game/roundPolicy';
import { shouldStartSuddenDeath, resetFinishedRound } from '../../src/game/suddenDeath';
import { calculateFinalRanking } from '../../src/game/ranking';
import { createGameStore } from '../../src/app/gameStore';
import { SessionRecovery, SESSION_GAME_KEY, validateStoredFlowState } from '../../src/storage/sessionRecovery';

const noDraw = { next: (): number => { throw new Error('Unexpected draw'); } };
const setup = (targetCompletions: CompletionTarget = 2, count = 2, diceMode: DiceMode = 5, throwStyle: ThrowStyle = 'normal'): Setup => ({
  ...initialSetup(), mode: { type: 'completionTarget', targetCompletions }, rollLimit: null, diceMode, throwStyle,
  participants: Array.from({ length: count }, (_, i) => ({ id: `p${i}`, name: `P${i}` })),
});
const act = (state: FlowState, type: Extract<FlowAction, { type: string }>['type']) => {
  if (type === 'start' || type === 'updateSetup' || type === 'reorderReplay') throw new Error('Use a complete action');
  return advanceFlow(state, state.revision, { type }, noDraw);
};
const start = (draft = setup()) => advanceFlow(initialFlow(), 0, { type: 'start', setup: draft }, noDraw);
function round(state: FlowState) {
  if (state.phase === 'setup' || state.phase === 'replayPreparation') throw new Error('Game expected');
  return state.game;
}
function roll(state: FlowState, faces: readonly number[], type: 'roll' | 'rollPenalty' = 'roll') {
  // Each OUT consumes its check only; SAFE consumes check then face, preserving die order.
  const draws = faces.flatMap((face) => face === 0 ? [0] : [0.9, (face - 0.5) / 6]);
  let calls = 0;
  const next = advanceFlow(state, state.revision, { type }, { next: () => {
    const value = draws[calls++];
    if (value === undefined) throw new Error('Unexpected draw');
    return value;
  } });
  expect(calls).toBe(draws.length);
  return next;
}
const faces = (face: number, count = 5) => Array<number>(count).fill(face);
function partialRound() {
  let state = roll(start(), faces(1));
  state = act(state, 'next');
  state = roll(state, [1, 0, 2, 2, 2]);
  return roll(state, faces(2, 3));
}
function nextRound(state: FlowState) {
  const decision = act(state, 'ranking');
  expect(decision.phase).toBe('suddenDeath');
  return act(decision, 'startSuddenDeath');
}
function restore(state: FlowState) {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  new SessionRecovery(() => storage).saveGame(state);
  expect(JSON.parse(values.get(SESSION_GAME_KEY)!)).toEqual({ version: 4, state });
  const recovery = new SessionRecovery(() => storage);
  expect(recovery.loadGame()).toEqual({ recovered: true, state });
  const store = createGameStore(noDraw, recovery);
  expect(store.getSnapshot()).toMatchObject({ state, visibleState: state, busy: false, recovered: true });
  return store;
}

describe('Completion Target round policy and flow', () => {
  it.each([1, 5] as const)('starts target %i with unchanged Turn engine defaults', (target) => {
    expect(start(setup(target))).toMatchObject({ phase: 'turn', game: { mode: { type: 'completionTarget', targetCompletions: target }, rollLimit: null },
      turn: { nextRollNumber: 1, player: { activeDice: 5, score: 0 } } });
  });
  it('rejects finite limits before any random consumption', () => {
    // @ts-expect-error Deliberately corrupt configuration: finite Completion Target is forbidden.
    const draft: Setup = { ...setup(), mode: { type: 'completionTarget', targetCompletions: 2 }, rollLimit: 1 };
    expect(() => start(draft)).toThrow('設定');
  });
  it('keeps Series START unsupported', () => {
    expect(() => start({ ...initialSetup(), participants: setup().participants, mode: { type: 'series', gameCount: 2 } })).toThrow('まだ開始できません');
  });
  it('waits for every player even when the first completion reaches target', () => {
    const state = roll(start(setup(1)), faces(1));
    expect(round(state).totalCompletionCount).toBe(1);
    for (const type of ['ranking', 'reveal', 'penalty', 'suddenDeath', 'startSuddenDeath'] as const) expect(act(state, type)).toBe(state);
    expect(shouldStartNextRound(round(state))).toBe(false);
    const next = act(state, 'next');
    expect(next).toMatchObject({ phase: 'turn', game: { currentPlayerIndex: 1 }, turn: { nextRollNumber: 1 } });
    const ended = roll(next, faces(2));
    expect(act(ended, 'ranking').phase).toBe('ranking');
  });
  it.each([5, 7, 10, 14] as const)('resets an unequal under-target %i-dice round while retaining configuration and count', (diceMode) => {
    const draft = setup(5, 2, diceMode, 'rough');
    let state = roll(start(draft), faces(1, diceMode));
    state = roll(act(state, 'next'), [0, ...faces(2, diceMode - 1)]);
    expect(shouldStartSuddenDeath(round(state).players, diceMode)).toBe(false);
    expect(shouldStartNextRound(round(state))).toBe(true);
    const before = structuredClone(state);
    const next = nextRound(state);
    expect(round(next)).toMatchObject({ ...draft, totalCompletionCount: 1, currentPlayerIndex: 0, suddenDeathCount: 1 });
    expect(round(next).players).toEqual(draft.participants.map(({ id }) => ({ id, score: 0, activeDice: diceMode, strandedDice: 0,
      removedDice: 0, completed: false, turnFinished: false })));
    expect(next).toMatchObject({ turn: { phase: 'ready', nextRollNumber: 1, turnId: '1/1/p0' } });
    expect(next).not.toHaveProperty('penalty');
    expect(state).toEqual(before);
  });
  it('counts the same player again and ranks only the decisive round', () => {
    const old = partialRound();
    expect(round(old).totalCompletionCount).toBe(1);
    let state = nextRound(old);
    state = roll(state, faces(1));
    expect(round(state).totalCompletionCount).toBe(2);
    // The other player's old score/OUT state does not survive the reset.
    expect(round(state).players[1]).toMatchObject({ score: 0, strandedDice: 0, activeDice: 5 });
    state = roll(act(state, 'next'), faces(2));
    const decision = act(state, 'ranking');
    expect(decision.phase).toBe('ranking');
    expect(calculateFinalRanking(round(decision).players, 5)).toEqual({ rankings: [{ playerId: 'p0', rank: 1 }, { playerId: 'p1', rank: 2 }], loserIds: ['p1'] });
    const penalty = act(act(decision, 'reveal'), 'penalty');
    expect(penalty).toMatchObject({ penalty: { totalCompletionCount: 2, penalties: [{ playerId: 'p1', diceCount: 5 }] } });
    const result = roll(penalty, [0, 2, 5, 0, 1], 'rollPenalty');
    expect(result).toMatchObject({ penalty: { penalties: [{ basePenalty: 20, multiplier: 3, finalPenalty: 60,
      penaltyRoll: [{ status: 'out', value: null }, { status: 'safe', value: 2 }, { status: 'safe', value: 5 }, { status: 'out', value: null }, { status: 'safe', value: 1 }] }] } });
    const finished = act(result, 'finish');
    restore(finished);
    const replay = act(finished, 'replay');
    restore(replay);
    expect(act(replay, 'startReplay')).toMatchObject({ game: { mode: { type: 'completionTarget', targetCompletions: 2 }, totalCompletionCount: 0, suddenDeathCount: 0 } });
    expect(act(finished, 'newGame')).toMatchObject({ draft: setup() });
  });
  it('uses the new round winner instead of retaining the previous round ranking', () => {
    let state = nextRound(partialRound());
    state = roll(state, faces(2));
    state = roll(act(state, 'next'), faces(1));
    const decisive = act(state, 'ranking');
    expect(decisive.phase).toBe('ranking');
    expect(calculateFinalRanking(round(decisive).players, 5)).toEqual({ rankings: [{ playerId: 'p1', rank: 1 }, { playerId: 'p0', rank: 2 }], loserIds: ['p0'] });
    expect(round(decisive).players[0]).toMatchObject({ score: 0, activeDice: 5, completed: false });
    restore(decisive);
  });
  it('continues an unequal round with zero completions and keeps zero through reset', () => {
    let state = roll(start(), [1, 0, 0, 0, 0]);
    state = roll(act(state, 'next'), faces(2));
    expect(round(state).totalCompletionCount).toBe(0);
    expect(shouldStartSuddenDeath(round(state).players, 5)).toBe(false);
    const next = nextRound(state);
    expect(round(next).totalCompletionCount).toBe(0);
    restore(next);
  });
  it('allows overshoot and continues all-complete rounds after target', () => {
    let state = start(setup(2, 3));
    for (let i = 0; i < 3; i++) { state = roll(state, faces(1)); if (i < 2) state = act(state, 'next'); }
    expect(round(state).totalCompletionCount).toBe(3);
    restore(state);
    state = nextRound(state);
    expect(round(state).totalCompletionCount).toBe(3);
    restore(state);
    state = roll(state, faces(2)); state = act(state, 'next'); state = roll(state, faces(2)); state = act(state, 'next'); state = roll(state, faces(2));
    expect(shouldStartSuddenDeath(round(state).players, 5)).toBe(true);
    const tied = act(state, 'ranking');
    expect(tied.phase).toBe('suddenDeath');
    restore(tied);
    const next = act(tied, 'startSuddenDeath');
    expect(round(next).totalCompletionCount).toBe(3);
    restore(next);
    // Once target is reached, a later non-complete unequal round can be decisive without a new completion.
    state = roll(next, [1, 0, 0, 0, 0]);
    state = roll(act(state, 'next'), faces(2));
    state = roll(act(state, 'next'), faces(2));
    expect(round(state).players.every((player) => !player.completed)).toBe(true);
    const decisive = act(state, 'ranking');
    expect(decisive.phase).toBe('ranking');
    expect(round(decisive).totalCompletionCount).toBe(3);
    restore(decisive);
  });
  it('uses decisive-round loser counts and original order for multiple independent penalties', () => {
    let state = roll(start(setup(1, 3)), faces(1));
    state = roll(act(state, 'next'), [0, 2, 2, 2, 2]);
    state = roll(act(state, 'next'), [2, 0, 0, 2, 2]);
    for (const type of ['ranking', 'reveal', 'penalty'] as const) state = act(state, type);
    expect(state).toMatchObject({ penalty: { penalties: [{ playerId: 'p1', diceCount: 5 }, { playerId: 'p2', diceCount: 5 }] } });
    state = roll(state, [0, 1, 2, 3, 4], 'rollPenalty');
    restore(state);
    state = roll(act(state, 'nextPenalty'), [5, 0, 0, 2, 1], 'rollPenalty');
    expect(state).toMatchObject({ penalty: { penalties: [{ playerId: 'p1', basePenalty: 16, finalPenalty: 32 }, { playerId: 'p2', basePenalty: 20, finalPenalty: 40 }] } });
    restore(act(state, 'finish'));
  });
  it('rejects stale player/round rolls and duplicate resets without consuming randomness or adding completions', () => {
    const previousPlayer = roll(start(), faces(1));
    const nextPlayer = act(previousPlayer, 'next');
    expect(advanceFlow(nextPlayer, previousPlayer.revision, { type: 'roll' }, noDraw)).toBe(nextPlayer);
    const ended = partialRound();
    const next = nextRound(ended);
    expect(advanceFlow(next, ended.revision, { type: 'roll' }, noDraw)).toBe(next);
    expect(act(next, 'startSuddenDeath')).toBe(next);
    expect(resetFinishedRound(round(next), 1)).toBe(round(next));
    expect(round(next).totalCompletionCount).toBe(1);
  });
});

describe('Completion Target recovery and presentation boundaries', () => {
  it('restores setup, continuing result, partial-completion prior round and reached-target mid-round without new draws', () => {
    restore({ phase: 'setup', revision: 0, gameNumber: 0, setupKind: 'initial', draft: setup() });
    restore(start());
    restore(roll(start(), [1, 0, 2, 2, 2]));
    restore(partialRound());
    let state = nextRound(partialRound());
    restore(state);
    state = roll(state, faces(1));
    const restored = restore(state);
    expect(restored.getSnapshot().state.phase).toBe('turn');
    const before = restored.getSnapshot().state;
    restored.dispatch(before.revision, { type: 'roll' });
    expect(restored.getSnapshot().state).toBe(before);
    restored.dispatch(before.revision, { type: 'next' });
    expect(restored.getSnapshot().state).toMatchObject({ phase: 'turn', game: { currentPlayerIndex: 1, totalCompletionCount: 2 } });
  });
  it.each(['finiteLimit', 'target', 'dice', 'countTooLow', 'countTooHigh', 'futurePlayer', 'result'] as const)('rejects malformed CT %s without repair', (kind) => {
    const state = roll(start(), faces(1));
    if (state.phase !== 'turn' || state.turn.phase !== 'result') throw new Error('Result expected');
    const invalid = kind === 'finiteLimit' ? { ...state, game: { ...state.game, rollLimit: 3 } }
      : kind === 'target' ? { ...state, game: { ...state.game, mode: { type: 'completionTarget', targetCompletions: 6 } } }
        : kind === 'dice' ? { ...state, game: { ...state.game, players: state.game.players.map((p) => ({ ...p, activeDice: 15 })) } }
          : kind === 'countTooLow' ? { ...state, game: { ...state.game, totalCompletionCount: 0 }, turn: { ...state.turn, totalCompletionCount: 0 } }
            : kind === 'countTooHigh' ? { ...state, game: { ...state.game, totalCompletionCount: 2 }, turn: { ...state.turn, totalCompletionCount: 2 } }
              : kind === 'futurePlayer' ? { ...state, game: { ...state.game, players: [...state.game.players].reverse() } }
                : { ...state, turn: { ...state.turn, result: { ...state.turn.result, outcome: 'turnEnd', reason: 'rollLimit' } } };
    expect(validateStoredFlowState(invalid)).toBe(false);
  });
  it('keeps Normal history strict while permitting CT partial-completion prior rounds', () => {
    const state = nextRound(partialRound());
    expect(validateStoredFlowState(state)).toBe(true);
    expect(validateStoredFlowState({ ...state, game: { ...round(state), mode: { type: 'normal' } } })).toBe(false);
    const underTarget = act(partialRound(), 'ranking');
    expect(validateStoredFlowState({ ...underTarget, phase: 'loserReveal' })).toBe(false);
    expect(validateStoredFlowState({ ...underTarget, phase: 'ranking' })).toBe(false);
  });
  it('holds the last roll until presentation acknowledgment, then saves the explicit next-round decision', () => {
    const ready = act(roll(start(setup(5)), faces(1)), 'next');
    let calls = 0;
    const saved: FlowState[] = [];
    const store = createGameStore({ next: () => calls++ % 2 === 0 ? 0.9 : 0.2 }, {
      loadGame: () => ({ state: ready, recovered: true }), saveGame: (state) => { saved.push(state); return undefined; },
    });
    store.dispatch(ready.revision, { type: 'roll' });
    const committed = store.getSnapshot().state;
    expect(committed.phase).toBe('turn');
    expect(saved).toEqual([committed]);
    expect(store.getSnapshot()).toMatchObject({ visibleState: ready, busy: true });
    store.dispatch(committed.revision, { type: 'ranking' });
    expect(store.getSnapshot().state).toBe(committed);
    store.reveal(committed.revision);
    store.dispatch(committed.revision, { type: 'ranking' });
    expect(store.getSnapshot().state).toBe(committed);
    store.presented(committed.revision);
    store.dispatch(committed.revision, { type: 'ranking' });
    expect(store.getSnapshot().state.phase).toBe('suddenDeath');
    expect(saved.at(-1)?.phase).toBe('suddenDeath');
    expect(calls).toBe(10);
  });
});
