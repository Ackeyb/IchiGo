import { calculateFinalRanking, calculateProvisionalRanking } from '../game/ranking';
import { getRemainingDice } from '../game/rollResolver';
import type { SuddenDeathState } from '../game/suddenDeath';

export function RankingBoard({ game, final = false, currentHasRolled = false }: { game: SuddenDeathState; final?: boolean; currentHasRolled?: boolean }) {
  const result = final
    ? calculateFinalRanking(game.players, game.diceMode)
    : calculateProvisionalRanking(game.players, game.diceMode);
  const bottom = 'bottomIds' in result ? result.bottomIds : [];
  // Append unfinished players without a provisional rank; current-player emphasis remains presentation only.
  const ids = [...result.rankings.map((entry) => entry.playerId), ...game.players.filter((p) => !p.turnFinished).map((p) => p.id)];
  return <section className="panel ranking" aria-label={final ? '最終順位' : '暫定順位'}>
    <h3>{final ? '最終順位' : '暫定順位'}</h3>
    {!final && <p className="subtle">ターン終了済みのプレイヤーだけを順位に含めます。</p>}
    <ol>{ids.map((id) => {
      const player = game.players.find((p) => p.id === id)!;
      const index = game.participants.findIndex((p) => p.id === id);
      const rank = result.rankings.find((entry) => entry.playerId === id)?.rank;
      const playing = !player.turnFinished && index === game.currentPlayerIndex;
      const classes = [bottom.includes(id) ? 'bottom' : '', player.completed ? 'complete' : '', playing ? 'current' : '', !player.turnFinished ? 'unplayed' : ''].filter(Boolean).join(' ');
      return <li key={id} className={classes}>
        <span className="rank">{rank ? `${rank}位` : '—'}</span>
        <div><strong>{game.participants[index]!.name}</strong><small>プレイヤー {index + 1} · {player.completed ? '完走' : player.turnFinished ? '終了' : playing ? currentHasRolled ? 'プレイ中' : '未プレイ・現在の手番' : '未プレイ'}</small>
          {!player.turnFinished && playing && <small>順位対象外・未終了</small>}
          {bottom.includes(id) && <small className="bottom-label">暫定最下位</small>}
        </div>
        <div className="rank-score"><strong>{player.score}点</strong><small>残り {getRemainingDice(player)} · OUT {player.strandedDice}</small></div>
      </li>;
    })}</ol>
  </section>;
}
