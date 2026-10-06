import { describe, expect, it } from 'vitest';
import { advanceFlow, initialFlow } from '../../src/game/gameFlow';
import type { FlowAction } from '../../src/game/gameFlow';
import { createGameStore } from '../../src/app/gameStore';
import { initialSetup, nameError, validateSetup, validateSetupDraft } from '../../src/game/setup';
import type { Setup } from '../../src/game/setup';

const setup = { mode: { type: 'normal' as const }, rollLimit: null, participants: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], throwStyle: 'normal' as const, diceMode: 7 as const };

class SequenceRandom {
  calls = 0;
  constructor(private readonly values: readonly number[]) {}
  next() { return this.values[this.calls++] ?? 0.9; }
}

const safeFaces = (count: number, face: number) => Array.from({ length: count }, () => [0.9, (face - 0.5) / 6]).flat();

function finishedGame(gameSetup: Setup) {
  const random = new SequenceRandom([
    ...safeFaces(gameSetup.diceMode, 1),
    ...safeFaces(gameSetup.diceMode * (gameSetup.participants.length - 1), 2),
    ...safeFaces(gameSetup.diceMode * (gameSetup.participants.length - 1), 1),
  ]);
  let state = initialFlow();
  const perform = (action: FlowAction) => { state = advanceFlow(state, state.revision, action, random); };
  perform({ type: 'start', setup: gameSetup });
  for (let index = 0; index < gameSetup.participants.length; index++) {
    perform({ type: 'roll' });
    if (index < gameSetup.participants.length - 1) perform({ type: 'next' });
  }
  perform({ type: 'ranking' }); perform({ type: 'reveal' }); perform({ type: 'penalty' });
  for (let index = 0; index < gameSetup.participants.length - 1; index++) {
    perform({ type: 'rollPenalty' });
    if (index < gameSetup.participants.length - 2) perform({ type: 'nextPenalty' });
  }
  perform({ type: 'finish' });
  if (state.phase !== 'finished') throw new Error('Expected a finished game.');
  return state;
}

describe('setup boundaries', () => {
  it('accepts combining sequences and rejects a thirteenth grapheme', () => {
    expect(nameError(`  ${'e\u0301'.repeat(12)}  `)).toBeUndefined();
    expect(nameError('e\u0301'.repeat(13))).toBeDefined();
    expect(nameError(' \n ')).toBeDefined();
    expect(validateSetup(initialSetup())).toBe(false);
  });
  it.each([1, 11])('rejects %i participants', (count) => {
    expect(validateSetup({ ...setup, participants: Array.from({ length: count }, (_, i) => ({ id: String(i), name: '同名' })) })).toBe(false);
  });
  it('rejects duplicate IDs but permits duplicate names', () => {
    expect(validateSetup({ ...setup, participants: [{ id: 'a', name: '同名' }, { id: 'b', name: '同名' }] })).toBe(true);
    expect(validateSetup({ ...setup, participants: [setup.participants[0]!, setup.participants[0]!] })).toBe(false);
  });
  it('separates recoverable blank drafts from START validation without coercion', () => {
    expect(validateSetupDraft(initialSetup())).toBe(true);
    expect(validateSetup(initialSetup())).toBe(false);
    expect(validateSetupDraft({ ...initialSetup(), diceMode: '7' })).toBe(false);
    expect(validateSetupDraft({ ...initialSetup(), participants: [{ id: 'p0', name: 1 }, { id: 'p1', name: '' }] })).toBe(false);
  });
});

describe('authoritative flow and operation identity', () => {
  it('rejects out-of-phase requests before drawing randomness', () => {
    let calls = 0;
    const random = { next: () => { calls++; return 0; } };
    const state = advanceFlow(initialFlow(), 0, { type: 'start', setup }, random);
    for (const type of ['next', 'ranking', 'reveal', 'suddenDeath', 'startSuddenDeath', 'penalty', 'rollPenalty', 'nextPenalty', 'finish', 'replay', 'startReplay', 'newGame', 'fullReset'] as const) {
      expect(advanceFlow(state, state.revision, { type }, random)).toBe(state);
    }
    expect(calls).toBe(0);
  });

  it('accepts every major action at most once and never rebinds a stale request after game reset', () => {
    let draws = 0;
    const random = { next: () => {
      const index = draws++;
      return index < 14 ? index % 2 === 0 ? 0.9 : 0 : 0;
    } };
    let state = initialFlow();
    function perform(action: FlowAction) {
      const previous = state;
      state = advanceFlow(state, state.revision, action, random);
      expect(state).not.toBe(previous);
      const beforeDraws = draws;
      expect(advanceFlow(state, previous.revision, action, random)).toBe(state);
      expect(draws).toBe(beforeDraws);
    }
    perform({ type: 'start', setup });
    const first = state;
    perform({ type: 'roll' }); perform({ type: 'next' }); perform({ type: 'roll' });
    perform({ type: 'ranking' }); perform({ type: 'reveal' }); perform({ type: 'penalty' });
    perform({ type: 'rollPenalty' }); perform({ type: 'finish' }); perform({ type: 'replay' }); perform({ type: 'startReplay' });
    if (first.phase !== 'turn' || state.phase !== 'turn') throw new Error('Expected turns');
    expect(state.turn.turnId).not.toBe(first.turn.turnId);
    expect(state.game.totalCompletionCount).toBe(0);
    expect(advanceFlow(state, first.revision, { type: 'roll' }, random)).toBe(state);
    perform({ type: 'exitGame' }); perform({ type: 'start', setup });
    expect(advanceFlow(state, first.revision, { type: 'newGame' }, random)).toBe(state);
    expect(draws).toBe(28);
  });

  it('requires presentation acknowledgment and does not unlock for an old frame callback', () => {
    let calls = 0;
    const store = createGameStore({ next: () => { calls++; return 0; } });
    store.dispatch(0, { type: 'start', setup });
    expect(store.getSnapshot().busy).toBe(true);
    store.presented(0);
    expect(store.getSnapshot().busy).toBe(true);
    store.dispatch(1, { type: 'roll' });
    expect(calls).toBe(0);
    store.presented(1); store.dispatch(1, { type: 'roll' });
    expect(calls).toBe(7);
    const committed = store.getSnapshot().state;
    const hidden = store.getSnapshot().visibleState;
    expect(committed.revision).toBe(2);
    expect(hidden.revision).toBe(1);
    store.reveal(1);
    expect(store.getSnapshot().visibleState).toBe(hidden);
    store.presented(1);
    expect(store.getSnapshot().busy).toBe(true);
    store.reveal(2);
    expect(store.getSnapshot().visibleState).toBe(committed);
    expect(store.getSnapshot().busy).toBe(true);
    store.presented(2);
    expect(store.getSnapshot().busy).toBe(false);
  });

  it('does not partially commit or remain locked when a RandomSource fails', () => {
    const store = createGameStore({ next: () => { throw new Error('failed source'); } });
    store.dispatch(0, { type: 'start', setup }); store.presented(1);
    const before = store.getSnapshot().state;
    store.dispatch(1, { type: 'roll' });
    expect(store.getSnapshot().state).toBe(before);
    expect(store.getSnapshot().busy).toBe(false);
    expect(store.getSnapshot().error).toBe('failed source');
  });
});

describe('v2 preparation and reset flows', () => {
  const participants = [
    { id: 'p7', name: '七海' },
    { id: 'p2', name: '二郎' },
    { id: 'custom', name: '三咲' },
  ] as const;

  it('commits structurally valid setup edits, including blank names, and rejects corrupt drafts', () => {
    const initial = initialFlow();
    const draft = { mode: { type: 'normal' as const }, rollLimit: null, participants: [{ id: 'p1', name: '' }, { id: 'p0', name: '途中' }], diceMode: 10 as const, throwStyle: 'careful' as const };
    const edited = advanceFlow(initial, initial.revision, { type: 'updateSetup', draft }, new SequenceRandom([]));
    expect(edited).toEqual({ ...initial, revision: 1, draft });
    const corrupt = { ...draft, participants: [{ id: 'p1', name: '' }, { id: 'p1', name: '' }] };
    expect(advanceFlow(edited, edited.revision, { type: 'updateSetup', draft: corrupt }, new SequenceRandom([]))).toBe(edited);
  });

  it('enters replay preparation with only the retained configuration', () => {
    const finished = finishedGame({ mode: { type: 'normal' as const }, rollLimit: null, participants, diceMode: 10, throwStyle: 'rough' });
    const replay = advanceFlow(finished, finished.revision, { type: 'replay' }, new SequenceRandom([]));
    expect(replay).toMatchObject({
      phase: 'replayPreparation', gameNumber: finished.gameNumber,
      draft: { mode: { type: 'normal' as const }, rollLimit: null, participants, diceMode: 10, throwStyle: 'rough' },
    });
    expect(replay).not.toHaveProperty('game');
    expect(replay).not.toHaveProperty('penalty');
  });

  it('reorders replay participants by ID while preserving every ID/name pair and locked setting', () => {
    const finished = finishedGame({ mode: { type: 'normal' as const }, rollLimit: null, participants, diceMode: 5, throwStyle: 'careful' });
    const replay = advanceFlow(finished, finished.revision, { type: 'replay' }, new SequenceRandom([]));
    const reordered = advanceFlow(replay, replay.revision, {
      type: 'reorderReplay', participantIds: ['custom', 'p7', 'p2'],
    }, new SequenceRandom([]));
    if (reordered.phase !== 'replayPreparation') throw new Error('Expected replay preparation.');
    expect(reordered.draft).toEqual({
      mode: { type: 'normal' as const },
      rollLimit: null,
      participants: [participants[2], participants[0], participants[1]],
      diceMode: 5,
      throwStyle: 'careful',
    });
    const started = advanceFlow(reordered, reordered.revision, { type: 'startReplay' }, new SequenceRandom([]));
    if (started.phase !== 'turn') throw new Error('Expected replay turn.');
    expect(started.game.participants).toEqual([participants[2], participants[0], participants[1]]);
    expect(started.game.players.map(({ id }) => id)).toEqual(['custom', 'p7', 'p2']);
  });

  it('rejects replay rename/add/delete/settings changes and invalid permutations at the Flow boundary', () => {
    const finished = finishedGame({ mode: { type: 'normal' as const }, rollLimit: null, participants, diceMode: 10, throwStyle: 'rough' });
    const replay = advanceFlow(finished, finished.revision, { type: 'replay' }, new SequenceRandom([]));
    const forbiddenSetup: Setup = {
      mode: { type: 'normal' as const },
      rollLimit: null,
      participants: [{ id: 'p7', name: '改名' }, ...participants.slice(1)],
      diceMode: 5,
      throwStyle: 'careful',
    };
    expect(advanceFlow(replay, replay.revision, { type: 'start', setup: forbiddenSetup }, new SequenceRandom([]))).toBe(replay);
    expect(advanceFlow(replay, replay.revision, { type: 'newGame' }, new SequenceRandom([]))).toBe(replay);
    expect(advanceFlow(replay, replay.revision, { type: 'fullReset' }, new SequenceRandom([]))).toBe(replay);
    for (const participantIds of [['p7', 'p2'], ['p7', 'p2', 'missing'], ['p7', 'p7', 'custom']]) {
      expect(advanceFlow(replay, replay.revision, { type: 'reorderReplay', participantIds }, new SequenceRandom([]))).toBe(replay);
    }
  });

  it.each([5, 7, 10] as const)('starts replay as a clean %i DICE game and rejects duplicate/stale starts', (diceMode) => {
    const finished = finishedGame({ mode: { type: 'normal' as const }, rollLimit: null, participants, diceMode, throwStyle: 'normal' });
    const replay = advanceFlow(finished, finished.revision, { type: 'replay' }, new SequenceRandom([]));
    const started = advanceFlow(replay, replay.revision, { type: 'startReplay' }, new SequenceRandom([]));
    if (started.phase !== 'turn') throw new Error('Expected replay turn.');
    expect(started.gameNumber).toBe(finished.gameNumber + 1);
    expect(started.game).toMatchObject({ rollLimit: null, diceMode, throwStyle: 'normal', totalCompletionCount: 0, suddenDeathCount: 0 });
    expect(started.game.players.every((player) => player.score === 0 && player.activeDice === diceMode
      && player.strandedDice === 0 && player.removedDice === 0 && !player.completed && !player.turnFinished)).toBe(true);
    expect(advanceFlow(started, replay.revision, { type: 'startReplay' }, new SequenceRandom([]))).toBe(started);
    expect(advanceFlow(started, started.revision, { type: 'startReplay' }, new SequenceRandom([]))).toBe(started);
  });

  it('moves Final Result to an editable setup draft without carrying gameplay state', () => {
    const finished = finishedGame({ mode: { type: 'normal' as const }, rollLimit: null, participants, diceMode: 10, throwStyle: 'rough' });
    const next = advanceFlow(finished, finished.revision, { type: 'newGame' }, new SequenceRandom([]));
    expect(next).toEqual({
      phase: 'setup', revision: finished.revision + 1, gameNumber: finished.gameNumber,
      setupKind: 'newGame', draft: { mode: { type: 'normal' as const }, rollLimit: null, participants: [...participants], diceMode: 10, throwStyle: 'rough' },
    });
    expect(next).not.toHaveProperty('game');
    expect(next).not.toHaveProperty('turn');
    expect(next).not.toHaveProperty('penalty');
    if (next.phase !== 'setup') throw new Error('Expected new-game setup.');
    const started = advanceFlow(next, next.revision, { type: 'start', setup: next.draft }, new SequenceRandom([]));
    if (started.phase !== 'turn') throw new Error('Expected new-game turn.');
    expect(started.gameNumber).toBe(finished.gameNumber + 1);
    expect(started.game.players.every((player) => player.score === 0 && player.activeDice === 10
      && player.strandedDice === 0 && player.removedDice === 0 && !player.completed && !player.turnFinished)).toBe(true);
  });

  it('full reset creates the dedicated initial draft and is idempotent', () => {
    const finished = finishedGame({ mode: { type: 'normal' as const }, rollLimit: null, participants, diceMode: 10, throwStyle: 'rough' });
    const next = advanceFlow(finished, finished.revision, { type: 'newGame' }, new SequenceRandom([]));
    const reset = advanceFlow(next, next.revision, { type: 'fullReset' }, new SequenceRandom([]));
    expect(reset).toEqual({
      phase: 'setup', revision: next.revision + 1, gameNumber: next.gameNumber,
      setupKind: 'fullReset', draft: initialSetup(),
    });
    expect(advanceFlow(reset, reset.revision, { type: 'fullReset' }, new SequenceRandom([]))).toBe(reset);
  });

  it('keeps active-game exit separate and returns to the initial setup', () => {
    const active = advanceFlow(initialFlow(), 0, { type: 'start', setup: { mode: { type: 'normal' as const }, rollLimit: null, participants, diceMode: 10, throwStyle: 'rough' } }, new SequenceRandom([]));
    const exited = advanceFlow(active, active.revision, { type: 'exitGame' }, new SequenceRandom([]));
    expect(exited).toEqual({
      phase: 'setup', revision: active.revision + 1, gameNumber: active.gameNumber,
      setupKind: 'initial', draft: initialSetup(),
    });
    expect(advanceFlow(active, active.revision, { type: 'newGame' }, new SequenceRandom([]))).toBe(active);
  });

  it('uses replay order as the original order throughout sudden death', () => {
    const finished = finishedGame({ mode: { type: 'normal' as const }, rollLimit: null, participants, diceMode: 5, throwStyle: 'careful' });
    let state = advanceFlow(finished, finished.revision, { type: 'replay' }, new SequenceRandom([]));
    state = advanceFlow(state, state.revision, { type: 'reorderReplay', participantIds: ['custom', 'p2', 'p7'] }, new SequenceRandom([]));
    state = advanceFlow(state, state.revision, { type: 'startReplay' }, new SequenceRandom([]));
    const random = new SequenceRandom(safeFaces(15, 2));
    for (let index = 0; index < participants.length; index++) {
      state = advanceFlow(state, state.revision, { type: 'roll' }, random);
      if (index < participants.length - 1) state = advanceFlow(state, state.revision, { type: 'next' }, random);
    }
    state = advanceFlow(state, state.revision, { type: 'ranking' }, random);
    state = advanceFlow(state, state.revision, { type: 'suddenDeath' }, random);
    state = advanceFlow(state, state.revision, { type: 'startSuddenDeath' }, random);
    if (state.phase !== 'turn') throw new Error('Expected sudden-death turn.');
    expect(state.game.participants.map(({ id }) => id)).toEqual(['custom', 'p2', 'p7']);
    expect(state.game.players.map(({ id }) => id)).toEqual(['custom', 'p2', 'p7']);
  });
});
