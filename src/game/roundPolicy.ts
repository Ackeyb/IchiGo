import { shouldStartSuddenDeath } from './suddenDeath';
import type { SuddenDeathState } from './suddenDeath';

export type RoundContinuation = 'nextGame' | 'suddenDeath' | 'result';

/** v5: target-unmet continuation precedes tie eligibility, and is never Sudden Death. */
export function roundContinuation(game: SuddenDeathState): RoundContinuation | undefined {
  if (game.players.some((player) => !player.turnFinished)) return undefined;
  if (game.mode.type === 'series') return undefined;
  if (game.mode.type === 'completionTarget' && game.totalCompletionCount < game.mode.targetCompletions) return 'nextGame';
  return shouldStartSuddenDeath(game.players, game.diceMode) ? 'suddenDeath' : 'result';
}

export function shouldStartNextRound(game: SuddenDeathState): boolean {
  const continuation = roundContinuation(game);
  return continuation === 'nextGame' || continuation === 'suddenDeath';
}
