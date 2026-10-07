import type { ProvisionalRanking } from './ranking';
import { getRemainingDice } from './rollResolver';
import type { SeriesCumulativePlayer, SeriesState } from './series';
import { compareSeriesCumulative } from './seriesRanking';

/** Display derivation from a trusted visible Flow game; never writes cumulative authority. */
export function calculateSeriesProvisional(game: SeriesState): ProvisionalRanking & Readonly<{ values: readonly SeriesCumulativePlayer[] }> {
  // Flow atomically commits every contribution with the last terminal ROLL. Thus an all-finished
  // visible game already includes this Game; earlier visible states still hold the previous cumulative base.
  const gameCommitted = game.players.every((player) => player.turnFinished);
  const values = game.cumulative.map((entry) => {
    const player = game.players.find((item) => item.id === entry.playerId)!;
    return player.turnFinished && !gameCommitted ? { ...entry,
      cumulativeScore: entry.cumulativeScore + player.score,
      cumulativeRemainingDice: entry.cumulativeRemainingDice + getRemainingDice(player),
    } : entry;
  });
  const finishedIds = new Set(game.players.filter((player) => player.turnFinished).map((player) => player.id));
  const sorted = values.filter((entry) => finishedIds.has(entry.playerId)).sort(compareSeriesCumulative);
  let rank = 0;
  const rankings = sorted.map((entry, index) => {
    if (index === 0 || compareSeriesCumulative(sorted[index - 1]!, entry) !== 0) rank = index + 1;
    return { playerId: entry.playerId, rank };
  });
  const lowestRank = rankings.at(-1)?.rank;
  return { values, rankings, bottomIds: rankings.filter((entry) => entry.rank === lowestRank).map((entry) => entry.playerId) };
}
