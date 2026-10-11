import { resetFinishedRound } from './suddenDeath';
import type { SuddenDeathState } from './suddenDeath';
import type { GameMode } from './types';

export type CompletionTargetState = SuddenDeathState & Readonly<{
  mode: Extract<GameMode, { type: 'completionTarget' }>;
  completionTargetRound: Readonly<{ number: number; kind: 'regular' | 'suddenDeath' }>;
}>;

/** Trusted Flow state only; Recovery requires and validates the identity separately. */
export function isCompletionTargetState(game: SuddenDeathState): game is CompletionTargetState {
  return game.mode.type === 'completionTarget';
}

export function completionTargetTurnId(game: CompletionTargetState, gameNumber: number): string {
  return `${gameNumber}/completionTarget/${game.completionTargetRound.number}/${game.completionTargetRound.kind}/${game.participants[game.currentPlayerIndex]!.id}`;
}

/** Only a finished-game continuation policy may call this; count events are already committed. */
export function nextCompletionTargetGame(game: CompletionTargetState, kind: 'regular' | 'suddenDeath'): CompletionTargetState {
  if (!Number.isSafeInteger(game.completionTargetRound.number + 1)) throw new RangeError('Completion Target round overflow.');
  const next = resetFinishedRound(game, game.suddenDeathCount);
  if (next === game) return game;
  return { ...next, mode: game.mode, rollLimit: null,
    suddenDeathCount: game.suddenDeathCount + (kind === 'suddenDeath' ? 1 : 0),
    completionTargetRound: { number: game.completionTargetRound.number + 1, kind } };
}
