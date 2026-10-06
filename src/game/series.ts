import { createTurn } from './gameEngine';
import { getRemainingDice } from './rollResolver';
import type { SuddenDeathState } from './suddenDeath';
import type { GameMode } from './types';

export type SeriesCumulativePlayer = Readonly<{ playerId: string; cumulativeScore: number; cumulativeRemainingDice: number }>;
export type SeriesState = SuddenDeathState & Readonly<{
  mode: Extract<GameMode, { type: 'series' }>;
  currentGameNumber: number;
  cumulative: readonly SeriesCumulativePlayer[];
}>;

/** Trusted Flow state only; Recovery separately validates every required Series field. */
export function isSeriesState(game: SuddenDeathState): game is SeriesState {
  return game.mode.type === 'series';
}

export function createSeriesState(game: SuddenDeathState, mode: Extract<GameMode, { type: 'series' }>): SeriesState {
  return { ...game, mode, currentGameNumber: 1,
    cumulative: game.participants.map(({ id }) => ({ playerId: id, cumulativeScore: 0, cumulativeRemainingDice: 0 })) };
}

/** Called only by the last terminal ROLL transition; presentation/Next Game never commits contributions. */
export function commitSeriesGame(game: SeriesState): SeriesState {
  if (!game.players.every((player) => player.turnFinished)) throw new Error('Series Game is unfinished.');
  const byId = new Map(game.players.map((player) => [player.id, player]));
  return { ...game, cumulative: game.cumulative.map((entry) => {
    const player = byId.get(entry.playerId)!;
    return { playerId: entry.playerId, cumulativeScore: entry.cumulativeScore + player.score,
      cumulativeRemainingDice: entry.cumulativeRemainingDice + getRemainingDice(player) };
  }) };
}

/** Explicit Intermediate action only. Preserve configuration/cumulative values and rebuild fresh current players. */
export function nextSeriesGame(game: SeriesState, expectedCurrentGameNumber: number): SeriesState {
  if (expectedCurrentGameNumber !== game.currentGameNumber || game.currentGameNumber >= game.mode.gameCount
    || !game.players.every((player) => player.turnFinished)) return game;
  return { ...game, currentGameNumber: game.currentGameNumber + 1, currentPlayerIndex: 0,
    players: game.participants.map(({ id }) => ({ id, ...createTurn({ turnId: id, totalCompletionCount: game.totalCompletionCount,
      diceMode: game.diceMode }, game.throwStyle).player })) };
}

export function seriesTurnId(game: SeriesState, gameNumber: number): string {
  return `${gameNumber}/series/${game.currentGameNumber}/${game.participants[game.currentPlayerIndex]!.id}`;
}
