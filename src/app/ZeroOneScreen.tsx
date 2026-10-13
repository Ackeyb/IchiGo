import type { ReactNode, RefObject } from 'react';
import type { FlowAction } from '../game/gameFlow';
import type { ZeroOneFlowState } from '../game/zeroOneFlow';
import { nextZeroOnePlayer, zeroOneDiceCount } from '../game/zeroOne';
import { calculateZeroOneRanking } from '../game/zeroOneRanking';
import { seriesPenaltyResult } from '../game/seriesPenalty';
import { DicePresentation } from './DicePresentation';
import type { DicePresentationConfig } from './DicePresentation';
import { ReadyDice } from './DiceView';
import type { GameStore } from './gameStore';
import type { SoundCue } from './sound';

/** Reuse the stable Play regions; Zero-One owns the values and actions, not Normal's Turn rules. */
export function ZeroOneScreen({ state, committedState, busy, blocked, heading, store, send, config, onCue, finalActions }: {
  state: ZeroOneFlowState; committedState: ZeroOneFlowState; busy: boolean; blocked: boolean;
  heading: RefObject<HTMLHeadingElement | null>; store: GameStore; send: (action: FlowAction) => void;
  config?: DicePresentationConfig | undefined; onCue: (cue: SoundCue) => void; finalActions: ReactNode;
}) {
  const { game } = state;
  const player = game.players[game.currentPlayerIndex]!;
  const name = (id: string) => game.participants.find((p) => p.id === id)!.name;
  const diceMode = zeroOneDiceCount(game.mode.preset);
  const button = (label: string, type: 'roll' | 'next' | 'startSuddenDeath' | 'ranking' | 'penalty') =>
    <button className="primary" disabled={busy || blocked} onClick={(event) => { if (event.detail <= 1) send({ type }); }}
      onKeyDown={(event) => { if (event.repeat) event.preventDefault(); }}>{label}</button>;
  const ranking = state.phase === 'zeroOneTurn' ? undefined : state.ranking;
  const board = <section className="panel ranking" aria-label={ranking ? '最終順位' : 'プレイヤー進行'}>
    <h3>{ranking ? '最終順位' : 'プレイヤー進行'}</h3><ol>{game.players.map((p) => <li key={p.id}>
      <span className="rank">{ranking ? `${ranking.rankings.find((r) => r.playerId === p.id)!.rank}位` : '—'}</span>
      <div><strong>{name(p.id)}</strong><small>{p.isCleared ? 'Clear' : '未Clear・順位未確定'}</small></div>
      <div className="rank-score"><strong>{p.accumulatedTurnCount} Turn</strong><small>残り {p.remainingScore}点</small></div>
    </li>)}</ol></section>;
  if (state.phase !== 'zeroOneTurn') return <section className="results">
    <h2 ref={heading} tabIndex={-1}>{state.phase === 'zeroOneFinished' ? 'ゼロワン FINAL RESULT' : 'ゼロワン FINAL RANKING'}</h2>
    {board}{state.phase === 'zeroOneRanking' ? button('ペナルティへ', 'penalty') : <>
      <section className="panel"><h3>敗者とペナルティポイント</h3><ul className="losers">{state.zeroOnePenalty.entries.map((p) =>
        <li key={p.playerId}><strong>{name(p.playerId)}</strong><span>{seriesPenaltyResult(p, game.totalCleanClearCount)!.finalPenalty} pt</span></li>)}</ul></section>
      {finalActions}</>}
  </section>;
  const result = state.result;
  const committed = committedState.phase === 'zeroOneTurn' ? committedState.result : undefined;
  const next = result ? nextZeroOnePlayer(game) : undefined;
  const tied = next === undefined && game.players.every((p) => p.isCleared)
    && calculateZeroOneRanking(game.players).rankings.every((r) => r.rank === 1);
  return <div className="game-layout"><section className="play panel">
    <p className="eyebrow player-roll-line"><span>PLAYER {game.currentPlayerIndex + 1} / {game.participants.length}</span><span className="mode-progress">ゼロワン {game.mode.preset}</span></p>
    <h2 className="current-player" ref={heading} tabIndex={-1}><span>現在プレイヤー：</span>{name(player.id)}</h2>
    <div className="dice-field">
      <p className="dice-field-intro" aria-hidden={result ? true : undefined}>{result ? '\u00a0' : '1 ROLL = 1 Turn'}</p>
      <DicePresentation dice={committed?.dice} diceMode={diceMode} kind="normal" revision={committedState.revision} busy={busy}
        presentation={committed ? { kind: 'zeroOne', rollScore: committed.rollScore, outcome: committed.outcome } : undefined}
        onReveal={store.reveal} onPresented={store.presented} config={config} onCue={onCue} />
      <p className="ready-label">現在ROLL可能：{player.activeDice}個</p><ReadyDice count={player.activeDice} diceMode={diceMode} />
    </div>
    <dl className="metrics" aria-label="現在のプレイヤー状態">
      <div><dt>残り点数</dt><dd>{player.remainingScore}<small>点</small></dd></div>
      <div><dt>ダイス</dt><dd>{player.activeDice}<small>個</small></dd></div>
      <div><dt>Turn</dt><dd>{player.accumulatedTurnCount}<small>回</small></dd></div>
    </dl>
    <div className="turn-message" role="status">
      <strong>{result ? ({ clear: 'CLEAR', bust: 'BUST', short: 'SHORT', turnEnd: 'TURN END' } as const)[result.outcome] : 'ROLL READY'}</strong>
      {result && <p>{result.outcome === 'bust' ? '残り点数超過。点数・ダイスはROLL前へ戻ります。'
        : result.outcome === 'short' ? '残りダイスでは届かないため、点数・ダイスを初期化。' : `今回：${result.rollScore}点`}</p>}
      {result && <p>OUT {player.strandedDice}個 · Clean Clear{player.cleanClearEligible ? '資格あり' : '対象外'}</p>}
    </div>
    <div className="turn-action-slot"><p className="turn-action-context">{result && next !== undefined ? <>次のプレイヤー：<strong>{name(game.players[next]!.id)}</strong></> : '\u00a0'}</p>
      {!result ? button('ROLL', 'roll') : next !== undefined ? button('次へ', 'next') : tied ? button('サドンデスへ', 'startSuddenDeath') : button('結果を見る', 'ranking')}
    </div>
  </section>{board}</div>;
}
