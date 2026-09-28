import { describe, expect, it } from 'vitest';
import { advanceFlow, initialFlow } from '../../src/game/gameFlow';
import type { FlowAction } from '../../src/game/gameFlow';
import { createGameStore } from '../../src/app/gameStore';
import { initialSetup, nameError, validateSetup } from '../../src/game/setup';

const setup = { participants: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], throwStyle: 'normal' as const };

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
});

describe('authoritative flow and operation identity', () => {
  it('rejects out-of-phase requests before drawing randomness', () => {
    let calls = 0;
    const random = { next: () => { calls++; return 0; } };
    const state = advanceFlow(initialFlow(), 0, { type: 'start', setup }, random);
    for (const type of ['next', 'ranking', 'reveal', 'suddenDeath', 'startSuddenDeath', 'penalty', 'rollPenalty', 'nextPenalty', 'finish', 'replay'] as const) {
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
    perform({ type: 'rollPenalty' }); perform({ type: 'finish' }); perform({ type: 'replay' });
    if (first.phase !== 'turn' || state.phase !== 'turn') throw new Error('Expected turns');
    expect(state.turn.turnId).not.toBe(first.turn.turnId);
    expect(state.game.totalCompletionCount).toBe(0);
    expect(advanceFlow(state, first.revision, { type: 'roll' }, random)).toBe(state);
    perform({ type: 'newGame' }); perform({ type: 'start', setup });
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
    store.presented(1);
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
