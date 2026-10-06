import type { GameStore } from './gameStore';
import { partitionSeriesPenalty } from '../game/seriesPenalty';

export type SeriesPenaltyPresentationIdentity = Readonly<{
  /** The live Store instance distinguishes callbacks captured before reload/state ownership replacement. */
  store: GameStore;
  revision: number;
  penaltyId: string;
  playerId: string;
  committedChunkCount: number;
}>;

/** Capture when a committed chunk becomes the presentation target, never from visibleState alone. */
export function captureSeriesPenaltyPresentation(store: GameStore): SeriesPenaltyPresentationIdentity | undefined {
  const { state } = store.getSnapshot();
  if (state.phase !== 'seriesPenalty') return undefined;
  const entry = state.seriesPenalty.entries[state.seriesPenalty.currentLoserIndex]!;
  if (entry.committedChunks.length === 0) return undefined;
  return { store, revision: state.revision, penaltyId: state.seriesPenalty.penaltyId,
    playerId: entry.playerId, committedChunkCount: entry.committedChunks.length };
}

/** Presentation-only scheduling. No timer/ack/pause information is part of authoritative or persisted Flow state. */
export function createSeriesPenaltyAutoCoordinator(store: GameStore) {
  let disposed = false;
  let blocked = false;
  let acknowledged: SeriesPenaltyPresentationIdentity | undefined;
  let pending: { handle: ReturnType<typeof setTimeout>; identity: SeriesPenaltyPresentationIdentity } | undefined;

  const matchesCurrent = (identity: SeriesPenaltyPresentationIdentity) => {
    const current = captureSeriesPenaltyPresentation(store);
    return identity.store === store && current !== undefined && identity.revision === current.revision
      && identity.penaltyId === current.penaltyId && identity.playerId === current.playerId
      && identity.committedChunkCount === current.committedChunkCount;
  };
  const cancel = () => {
    if (pending) clearTimeout(pending.handle);
    // Invalidates even a callback already queued by the browser; clearing a timeout alone is not the authority guard.
    pending = undefined;
  };
  const canProceed = (identity: SeriesPenaltyPresentationIdentity) => {
    const snapshot = store.getSnapshot();
    if (!matchesCurrent(identity) || snapshot.busy || snapshot.visibleState !== snapshot.state
      || snapshot.state.phase !== 'seriesPenalty') return false;
    const entry = snapshot.state.seriesPenalty.entries[snapshot.state.seriesPenalty.currentLoserIndex]!;
    return entry.status === 'running' && entry.committedChunks.length < partitionSeriesPenalty(entry.totalDice).length;
  };
  const sync = () => {
    if (acknowledged && !matchesCurrent(acknowledged)) acknowledged = undefined;
    if (disposed || blocked || !acknowledged || !canProceed(acknowledged)) { cancel(); return; }
    if (pending) return;
    const identity = acknowledged;
    const wait = { identity, handle: setTimeout(() => {
      if (disposed || blocked || pending !== wait) return;
      pending = undefined;
      // Preserve the captured revision/loser/prefix; never rebind this request to the latest state.
      if (!acknowledged || !canProceed(identity)) { acknowledged = undefined; return; }
      acknowledged = undefined;
      store.dispatch(identity.revision, { type: 'nextSeriesPenaltyChunk', penaltyId: identity.penaltyId,
        playerId: identity.playerId, chunkIndex: identity.committedChunkCount });
      // The commit clears acknowledgment. Only that next chunk's reveal/paint completion may schedule again.
    }, 1500) };
    pending = wait;
  };
  const unsubscribe = store.subscribe(sync);
  return {
    /** Call after staged reveal and paint, or after painting a restored committed chunk. Not an animation-stop callback. */
    presented(identity: SeriesPenaltyPresentationIdentity) {
      if (disposed || !matchesCurrent(identity) || store.getSnapshot().visibleState !== store.getSnapshot().state) return;
      // Reuse the existing presentation acknowledgment to unlock the committed revision.
      store.presented(identity.revision);
      acknowledged = identity;
      sync();
    },
    setBlockingConfirmation(open: boolean) {
      if (disposed || blocked === open) return;
      blocked = open;
      // Cancel retains a still-current paint acknowledgment, but closing always schedules a fresh 1500ms wait.
      sync();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      acknowledged = undefined;
      cancel();
      unsubscribe();
    },
  };
}
