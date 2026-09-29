import { advanceFlow, initialFlow } from '../game/gameFlow';
import type { FlowAction } from '../game/gameFlow';
import type { RandomSource } from '../game/randomSource';
import type { RecoveryNotice, SessionRecovery } from '../storage/sessionRecovery';

/** Owned by one mounted app, not a React updater: StrictMode cannot replay random draws. */
export function createGameStore(random: RandomSource, recovery?: Pick<SessionRecovery, 'loadGame' | 'saveGame'>) {
  const loaded = recovery?.loadGame();
  const initial = loaded?.state ?? initialFlow();
  const initialSaveNotice = recovery && !loaded?.state ? recovery.saveGame(initial) : undefined;
  let snapshot: Readonly<{
    state: typeof initial;
    visibleState: typeof initial;
    busy: boolean;
    error: string;
    recovered: boolean;
    recoveryNotice: RecoveryNotice | undefined;
  }> = {
    state: initial,
    visibleState: initial,
    busy: false,
    error: '',
    recovered: loaded?.recovered ?? false,
    recoveryNotice: loaded?.notice ?? initialSaveNotice,
  };
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
        const isDraftEdit = action.type === 'updateSetup' || action.type === 'reorderReplay';
        snapshot = {
          ...snapshot,
          state,
          visibleState: waitsForDice ? snapshot.visibleState : state,
          busy: state !== before && !isDraftEdit,
          error: '',
          recovered: false,
        };
        if (state !== before && recovery) {
          // State is authoritative in memory before persistence; storage failure is fail-open.
          snapshot = { ...snapshot, recoveryNotice: recovery.saveGame(state) };
        }
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
