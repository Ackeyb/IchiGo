import { shouldStartSuddenDeath } from './suddenDeath';
import type { SuddenDeathState } from './suddenDeath';

/** v4 §9–12: evaluate only a finished round, never the roll that reaches the target. */
export function shouldStartNextRound(game: SuddenDeathState): boolean {
  if (game.mode.type === 'series') return false;
  const tied = shouldStartSuddenDeath(game.players, game.diceMode);
  if (game.players.some((player) => !player.turnFinished)) return false;
  return game.mode.type === 'completionTarget'
    ? game.totalCompletionCount < game.mode.targetCompletions || tied : tied;
}
