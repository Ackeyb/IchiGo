import type { ZeroOnePlayer } from './zeroOne';
import type { FinalRanking } from './ranking';

/** Clear-time ordering is not a tiebreak; only accumulated Turn counts determine competition ranks. */
export function calculateZeroOneRanking(players: readonly ZeroOnePlayer[]): FinalRanking {
  if (players.length < 2 || !players.every((p) => p.isCleared && Number.isSafeInteger(p.accumulatedTurnCount) && p.accumulatedTurnCount > 0)
    || new Set(players.map((p) => p.id)).size !== players.length) throw new Error('Ranking requires all players Clear.');
  const sorted = [...players].sort((a, b) => a.accumulatedTurnCount - b.accumulatedTurnCount);
  let rank = 1;
  const rankings = sorted.map((p, i) => {
    if (i > 0 && p.accumulatedTurnCount !== sorted[i - 1]!.accumulatedTurnCount) rank = i + 1;
    return { playerId: p.id, rank };
  });
  const bottom = rankings.at(-1)!.rank;
  return { rankings, loserIds: players.filter((p) => rankings.find((r) => r.playerId === p.id)!.rank === bottom).map((p) => p.id) };
}
