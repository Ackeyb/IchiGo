import type { FinalRanking } from '../game/ranking';
import type { SeriesState } from '../game/series';

/** Intermediate retains participant order; Final renders the committed domain ranking verbatim. */
export function SeriesResults({ game, ranking }: { game: SeriesState; ranking?: FinalRanking }) {
  const rows = ranking?.rankings ?? game.participants.map(({ id }) => ({ playerId: id, rank: undefined }));
  return <section className="panel series-results" aria-label={ranking ? '連続試合の最終順位' : '累積状況'}>
    <h3>{ranking ? '最終順位' : '累積状況'}</h3>
    <table><thead><tr>{ranking && <th scope="col">順位</th>}<th scope="col">プレイヤー</th><th scope="col">スコア</th><th scope="col">残ダイス</th></tr></thead>
      <tbody>{rows.map(({ playerId, rank }) => {
        const participant = game.participants.find(({ id }) => id === playerId)!;
        const cumulative = game.cumulative.find((entry) => entry.playerId === playerId)!;
        return <tr key={playerId}>{ranking && <td>{rank}位</td>}<th scope="row">{participant.name}
          {ranking?.loserIds.includes(playerId) && <small>敗者</small>}</th>
          <td>{cumulative.cumulativeScore}点</td><td>{cumulative.cumulativeRemainingDice}個</td></tr>;
      })}</tbody>
    </table>
  </section>;
}
