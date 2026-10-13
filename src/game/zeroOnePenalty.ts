import type { SeriesPenaltyState } from './seriesPenalty';
import { calculateZeroOneRanking } from './zeroOneRanking';
import type { ZeroOneGame } from './zeroOne';

/** Turn difference, never preset dice count. Numeric safety is the only bound; rendering stays chunked at ten. */
export function createZeroOnePenalty(game: ZeroOneGame, penaltyId: string): SeriesPenaltyState {
  const ranking = calculateZeroOneRanking(game.players);
  const top = Math.min(...game.players.map((p) => p.accumulatedTurnCount));
  if (!penaltyId || ranking.rankings.every((r) => r.rank === 1)) throw new Error('Tied Zero-One round requires Sudden Death.');
  return { penaltyId, currentLoserIndex: 0, entries: game.players.filter((p) => ranking.loserIds.includes(p.id)).map((p) => ({
    playerId: p.id, totalDice: p.accumulatedTurnCount - top, status: 'pending', committedChunks: [], basePenalty: 0,
  })) };
}
