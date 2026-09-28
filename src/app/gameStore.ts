import { advanceFlow, initialFlow } from '../game/gameFlow';
import type { FlowAction } from '../game/gameFlow';
import type { RandomSource } from '../game/randomSource';

/** Owned by one mounted app, not a React updater: StrictMode cannot replay random draws. */
export function createGameStore(random: RandomSource) {
  const initial = initialFlow();
  let snapshot = { state: initial, visibleState: initial, busy: false, error: '' };
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((notify) => notify());
  return {
    getSnapshot: () => snapshot,
    subscribe: (notify: () => void) => { listeners.add(notify); return () => { listeners.delete(notify); }; },
    dispatch(revision: number, action: FlowAction) {
      if (snapshot.busy || snapshot.state.revision !== revision) return;
      const before = snapshot.state;
      snapshot = { ...snapshot, busy: true, error: '' };
      try {
        const state = advanceFlow(before, revision, action, random);
        const waitsForDice = state !== before && (action.type === 'roll' || action.type === 'rollPenalty');
        snapshot = {
          state,
          visibleState: waitsForDice ? snapshot.visibleState : state,
          busy: state !== before,
          error: '',
        };
      } catch (error) {
        snapshot = { ...snapshot, state: before, busy: false, error: error instanceof Error ? error.message : '処理できませんでした。' };
      }
      emit();
    },
    reveal(revision: number) {
      if (!snapshot.busy || snapshot.state.revision !== revision) return;
      if (snapshot.visibleState === snapshot.state) return;
      snapshot = { ...snapshot, visibleState: snapshot.state };
      emit();
    },
    presented(revision: number) {
      if (!snapshot.busy || snapshot.state.revision !== revision) return;
      snapshot = { ...snapshot, visibleState: snapshot.state, busy: false };
      emit();
    },
  };
}
export type GameStore = ReturnType<typeof createGameStore>;
