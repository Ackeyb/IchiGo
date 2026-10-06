import { getPenaltyDieValue, getPenaltyMultiplier } from './penalty';
import { OUT_PROBABILITIES, rollDie } from './rollGenerator';
import type { RandomSource } from './randomSource';
import type { SeriesState } from './series';
import { calculateSeriesRanking } from './seriesRanking';
import type { DieResult, ThrowStyle } from './types';

export type SeriesPenaltyEntry = Readonly<{
  playerId: string;
  totalDice: number;
  status: 'pending' | 'running' | 'resolved';
  committedChunks: readonly (readonly DieResult[])[];
  basePenalty: number;
}>;
export type SeriesPenaltyState = Readonly<{
  penaltyId: string;
  entries: readonly SeriesPenaltyEntry[];
  currentLoserIndex: number;
}>;
export type SeriesChunkRequest = Readonly<{ penaltyId: string; playerId: string; chunkIndex: number }>;

/** v4 §27: only totalDice and committed results are authority; never store a parallel chunk plan/cursor. */
export function partitionSeriesPenalty(totalDice: number): readonly number[] {
  if (!Number.isSafeInteger(totalDice) || totalDice < 0 || totalDice > 70) throw new RangeError('Series Penalty requires 0 to 70 dice.');
  return Array.from({ length: Math.ceil(totalDice / 10) }, (_, index) => Math.min(10, totalDice - index * 10));
}

export function seriesChunkBase(dice: readonly DieResult[]): number {
  let base = 0;
  for (const die of dice) base += getPenaltyDieValue(die);
  return base;
}

/** No final result exists for a partially committed sequence. Apply the multiplier to the complete BASE only. */
export function seriesPenaltyResult(entry: SeriesPenaltyEntry, totalCompletionCount: number) {
  if (entry.status !== 'resolved') return undefined;
  const multiplier = getPenaltyMultiplier(totalCompletionCount);
  const finalPenalty = entry.basePenalty * multiplier;
  if (!Number.isSafeInteger(finalPenalty)) throw new RangeError('Penalty exceeds exact numeric representation.');
  return { basePenalty: entry.basePenalty, multiplier, finalPenalty };
}

export function createSeriesPenalty(game: SeriesState, penaltyId: string): SeriesPenaltyState {
  if (!penaltyId || game.currentGameNumber !== game.mode.gameCount || !game.players.every((p) => p.turnFinished)) {
    throw new Error('Series Penalty requires the final completed Game and a phase ID.');
  }
  getPenaltyMultiplier(game.totalCompletionCount);
  const losers = new Set(calculateSeriesRanking(game.cumulative).loserIds);
  const byId = new Map(game.cumulative.map((p) => [p.playerId, p]));
  return { penaltyId, currentLoserIndex: 0, entries: game.participants.filter((p) => losers.has(p.id)).map(({ id }) => {
    const totalDice = byId.get(id)!.cumulativeRemainingDice;
    partitionSeriesPenalty(totalDice);
    return { playerId: id, totalDice, status: totalDice === 0 ? 'resolved' : 'pending', committedChunks: [], basePenalty: 0 };
  }) };
}

export function rollSeriesPenaltyChunk(count: number, throwStyle: ThrowStyle, random: RandomSource): readonly DieResult[] {
  if (!Number.isInteger(count) || count < 1 || count > 10) throw new RangeError('Series chunk requires 1 to 10 dice.');
  if (!Object.hasOwn(OUT_PROBABILITIES, throwStyle)) throw new RangeError('Unknown throw style.');
  return Array.from({ length: count }, () => rollDie(throwStyle, random));
}

/** Exactly one chunk per request. All captured identities/progress are checked before any random draw. */
export function commitSeriesPenaltyChunk(
  state: SeriesPenaltyState, request: SeriesChunkRequest, first: boolean, throwStyle: ThrowStyle, random: RandomSource,
): SeriesPenaltyState {
  const entry = state.entries[state.currentLoserIndex];
  if (request.penaltyId !== state.penaltyId || !entry || request.playerId !== entry.playerId
    || request.chunkIndex !== entry.committedChunks.length || entry.status !== (first ? 'pending' : 'running')) return state;
  const plan = partitionSeriesPenalty(entry.totalDice);
  const size = plan[request.chunkIndex];
  if (size === undefined) return state;
  const dice = rollSeriesPenaltyChunk(size, throwStyle, random);
  const committedChunks = [...entry.committedChunks, dice];
  const next: SeriesPenaltyEntry = { ...entry, committedChunks, basePenalty: entry.basePenalty + seriesChunkBase(dice),
    status: committedChunks.length === plan.length ? 'resolved' : 'running' };
  return { ...state, entries: state.entries.map((p, i) => i === state.currentLoserIndex ? next : p) };
}

export function nextSeriesPenaltyLoser(state: SeriesPenaltyState, penaltyId: string, playerId: string): SeriesPenaltyState {
  const entry = state.entries[state.currentLoserIndex];
  if (penaltyId !== state.penaltyId || entry?.playerId !== playerId || entry.status !== 'resolved'
    || state.currentLoserIndex >= state.entries.length - 1) return state;
  return { ...state, currentLoserIndex: state.currentLoserIndex + 1 };
}
