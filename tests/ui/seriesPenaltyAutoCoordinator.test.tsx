// @vitest-environment jsdom
import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { App } from '../../src/app/App';
import { createGameStore } from '../../src/app/gameStore';
import * as autoModule from '../../src/app/seriesPenaltyAutoCoordinator';
import { advanceFlow, initialFlow } from '../../src/game/gameFlow';
import type { FlowAction, FlowState } from '../../src/game/gameFlow';
import { initialSetup } from '../../src/game/setup';

const noDraw = { next: (): number => { throw new Error('Unexpected draw'); } };
function ready() {
  let state: FlowState = initialFlow();
  const apply = (action: FlowAction, random = noDraw) => { state = advanceFlow(state, state.revision, action, random); };
  apply({ type: 'start', setup: { ...initialSetup(), mode: { type: 'series', gameCount: 2 }, diceMode: 14,
    participants: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }] } });
  for (let game = 1; game <= 2; game++) {
    for (let player = 0; player < 2; player++) {
      // Alternating OUT checks and face draws, all SAFE six: both players end with no score.
      apply({ type: 'roll' }, { next: () => 0.9 });
      if (player === 0) apply({ type: 'next' });
    }
    apply({ type: 'ranking' });
    if (game === 1) apply({ type: 'nextSeriesGame', currentGameNumber: 1 });
  }
  apply({ type: 'penalty' });
  return state;
}
beforeEach(() => {
  vi.useFakeTimers();
  // Keep App's paint callbacks pending. Series acknowledgment is explicit; no visual UI is introduced in this Batch.
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
});
afterEach(() => { cleanup(); vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it.each(['cancel', 'accept'] as const)('plumbs existing confirmation %s and StrictMode cleanup without new UI', (choice) => {
  const instances: ReturnType<typeof autoModule.createSeriesPenaltyAutoCoordinator>[] = [];
  const create = autoModule.createSeriesPenaltyAutoCoordinator;
  vi.spyOn(autoModule, 'createSeriesPenaltyAutoCoordinator').mockImplementation((store) => {
    const instance = create(store); instances.push(instance); return instance;
  });
  const state = ready();
  let calls = 0;
  const store = createGameStore({ next: () => { calls++; return 0.9; } }, { loadGame: () => ({ state, recovered: true }), saveGame: () => undefined });
  const view = render(<StrictMode><App store={store} soundPlayer={{ play: () => undefined, dispose: () => undefined }} /></StrictMode>);
  expect(instances.length).toBe(2);
  if (state.phase !== 'seriesPenalty') throw new Error('Penalty expected');
  act(() => store.dispatch(state.revision, { type: 'startSeriesPenalty', penaltyId: state.seriesPenalty.penaltyId, playerId: 'a', chunkIndex: 0 }));
  const identity = autoModule.captureSeriesPenaltyPresentation(store)!;
  act(() => { store.reveal(identity.revision); instances[0]!.presented(identity); });
  expect(vi.getTimerCount()).toBe(0); // The StrictMode-cleaned coordinator remains inert.
  act(() => instances[1]!.presented(identity));
  expect(vi.getTimerCount()).toBe(1);
  act(() => vi.advanceTimersByTime(1000));
  fireEvent.click(screen.getByRole('button', { name: 'ゲームを終了する' }));
  act(() => vi.advanceTimersByTime(0));
  expect(vi.getTimerCount()).toBe(0);
  act(() => vi.advanceTimersByTime(1000));
  expect(calls).toBe(20);
  if (choice === 'cancel') {
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }));
    act(() => vi.advanceTimersByTime(1499));
    expect(calls).toBe(20);
    act(() => vi.advanceTimersByTime(1));
    expect(calls).toBe(40);
    // A new chunk requires its own staged reveal/paint acknowledgment.
    const next = autoModule.captureSeriesPenaltyPresentation(store)!;
    act(() => { store.reveal(next.revision); instances[1]!.presented(next); });
    expect(vi.getTimerCount()).toBe(1);
  } else {
    fireEvent.click(screen.getByRole('button', { name: '確認して進む' }));
    act(() => vi.advanceTimersByTime(15000));
    expect(store.getSnapshot().state.phase).toBe('setup');
    expect(calls).toBe(20);
  }
  view.unmount();
  expect(vi.getTimerCount()).toBe(0);
  act(() => vi.advanceTimersByTime(15000));
  expect(calls).toBe(choice === 'cancel' ? 40 : 20);
});
