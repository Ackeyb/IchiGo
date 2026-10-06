import type { FinalRanking } from './ranking';
import type { SeriesCumulativePlayer } from './series';

/** v4 §22–23: cumulative values only, with no Complete priority or original-order tie-break. */
export function calculateSeriesRanking(players: readonly SeriesCumulativePlayer[]): FinalRanking {
  if (players.length < 2 || players.length > 10 || new Set(players.map((p) => p.playerId)).size !== players.length
    || players.some((p) => !p.playerId || !Number.isSafeInteger(p.cumulativeScore) || p.cumulativeScore < 0
      || p.cumulativeScore % 50 !== 0 || !Number.isSafeInteger(p.cumulativeRemainingDice) || p.cumulativeRemainingDice < 0)) {
    throw new RangeError('Invalid Series cumulative players.');
  }
  const compare = (a: SeriesCumulativePlayer, b: SeriesCumulativePlayer) =>
    b.cumulativeScore - a.cumulativeScore || a.cumulativeRemainingDice - b.cumulativeRemainingDice;
  const sorted = [...players].sort(compare);
  let rank = 0;
  const rankings = sorted.map((player, index) => {
    if (index === 0 || compare(sorted[index - 1]!, player) !== 0) rank = index + 1;
    return { playerId: player.playerId, rank };
  });
  const lowestRank = rankings.at(-1)!.rank;
  const losers = new Set(rankings.filter((p) => p.rank === lowestRank).map((p) => p.playerId));
  return { rankings, loserIds: players.filter((p) => losers.has(p.playerId)).map((p) => p.playerId) };
}
