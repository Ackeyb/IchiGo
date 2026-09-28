import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { getPenaltyMultiplier } from '../game/penalty';
import { calculateFinalRanking } from '../game/ranking';
import { getRemainingDice } from '../game/rollResolver';
import { shouldStartSuddenDeath } from '../game/suddenDeath';
import { mathRandomSource } from '../game/randomSource';
import type { RandomSource } from '../game/randomSource';
import type { FlowAction } from '../game/gameFlow';
import { createGameStore } from './gameStore';
import type { GameStore } from './gameStore';
import { SetupScreen, styleLabels } from './SetupScreen';
import { ReadyDice } from './DiceView';
import { DicePresentation } from './DicePresentation';
import type { DicePresentationConfig } from './DicePresentation';
import { RankingBoard } from './RankingBoard';
import { ConfirmDialog } from './ConfirmDialog';
import './app.css';

function ActionButton({ children, disabled, onClick }: { children: ReactNode; disabled: boolean; onClick: (button: HTMLButtonElement) => void }) {
  return <button className="primary" disabled={disabled} onClick={(event) => { if (event.detail <= 1) onClick(event.currentTarget); }}
    onKeyDown={(event) => { if (event.repeat) event.preventDefault(); }}>{children}</button>;
}

export function App({ random = mathRandomSource, store: suppliedStore, dicePresentation }: { random?: RandomSource; store?: GameStore; dicePresentation?: DicePresentationConfig } = {}) {
  const [store] = useState(() => suppliedStore ?? createGameStore(random));
  const { state: committedState, visibleState: state, busy, error } = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const [confirm, setConfirm] = useState<{ action: 'newGame' | 'replay'; revision: number; opener: HTMLElement } | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  // Non-dice transitions unlock after a committed paint. Dice transitions unlock from their presenter.
  useEffect(() => {
    if (!busy) return;
    const hasDicePresentation = (committedState.phase === 'turn' && committedState.turn.phase === 'result')
      || (committedState.phase === 'penalty' && committedState.penalty.penalties[committedState.penaltyIndex]?.status === 'resolved');
    if (hasDicePresentation) return;
    let second = 0;
    const first = requestAnimationFrame(() => { second = requestAnimationFrame(() => store.presented(committedState.revision)); });
    return () => { cancelAnimationFrame(first); cancelAnimationFrame(second); };
  }, [busy, committedState, store]);
  useEffect(() => { heading.current?.focus(); }, [state.revision]);
  const send = (action: FlowAction) => store.dispatch(committedState.revision, action);
  const action = (label: string, type: Exclude<FlowAction['type'], 'start'>) => <ActionButton disabled={busy || !!confirm}
    onClick={() => send({ type })}>{label}</ActionButton>;
  let content: ReactNode;
  if (state.phase === 'setup') content = <SetupScreen busy={busy} focusOnMount={state.revision > 0} onStart={(setup) => send({ type: 'start', setup })} />;
  else {
    const { game } = state;
    const name = (id: string) => game.participants.find((p) => p.id === id)!.name;
    if (state.phase === 'turn') {
      const player = state.turn.player;
      const result = state.turn.phase === 'result' ? state.turn.result : undefined;
      const committedResult = committedState.phase === 'turn' && committedState.turn.phase === 'result'
        ? committedState.turn.result : undefined;
      const current = game.participants[game.currentPlayerIndex]!;
      content = <div className="game-layout"><section className="play panel">
        <p className="eyebrow">PLAYER {game.currentPlayerIndex + 1} / {game.participants.length}</p>
        <h2 ref={heading} tabIndex={-1}>現在プレイヤー：{current.name}</h2>
        <div className="dice-field">
          {result ? <p>直前のROLL · 確定結果</p> : <p>ダイスを振って、ゲームを始めよう。</p>}
          <DicePresentation dice={committedResult?.dice} kind="normal" revision={committedState.revision}
            busy={busy} onReveal={store.reveal} onPresented={store.presented} config={dicePresentation} />
          <p className="ready-label">現在ROLL可能：{player.activeDice}個</p><ReadyDice count={player.activeDice} />
        </div>
        <dl className="metrics" aria-label="現在のプレイヤー状態">
          <div><dt>SCORE</dt><dd>{player.score}<small>点</small></dd></div>
          <div><dt>残り</dt><dd>{getRemainingDice(player)}<small>個</small></dd></div>
          <div><dt>OUT</dt><dd>{player.strandedDice}<small>個</small></dd></div>
        </dl>
        <div className="turn-message" role="status">
          {player.completed ? <strong>COMPLETE!! 完走</strong> : player.turnFinished ? <strong>TURN END · ターン終了</strong> : result ? <strong>得点！ 次のROLLへ</strong> : <strong>ROLL READY</strong>}
          {result && <p>今回の獲得：{result.gainedScore}点</p>}
          {player.strandedDice > 0 && <p>OUTあり・完走不能。OUTダイスは再ROLLされません。</p>}
        </div>
        {!player.turnFinished ? action(result ? '続けてROLL' : 'ROLL', 'roll') : game.currentPlayerIndex < game.participants.length - 1
          ? <><p>次のプレイヤー：{game.participants[game.currentPlayerIndex + 1]!.name}</p>{action('次へ', 'next')}</>
          : action('結果を見る', 'ranking')}
      </section><RankingBoard game={game} currentHasRolled={state.turn.nextRollNumber > 1} /></div>;
    } else if (state.phase === 'ranking') {
      const tied = shouldStartSuddenDeath(game.players);
      content = <section className="results"><h2 ref={heading} tabIndex={-1}>FINAL RANKING</h2><RankingBoard game={game} final />
        <p>{tied ? '全員同順位。サドンデスへ進みます。' : 'このラウンドで決着しました。'}</p>
        {tied ? action('サドンデスへ', 'suddenDeath') : action('敗者発表', 'reveal')}</section>;
    } else if (state.phase === 'suddenDeath') {
      content = <section className="panel results"><p className="eyebrow">もう一度、全員で。</p><h2 ref={heading} tabIndex={-1}>SUDDEN DEATH</h2>
        <p>得点とダイスをリセットし、元のプレイ順で再開します。累積完走数と投げ方は引き継ぎます。</p>
        <p>次のラウンドの先頭：{game.participants[0]!.name}</p>{action('開始', 'startSuddenDeath')}</section>;
    } else if (state.phase === 'loserReveal') {
      const losers = calculateFinalRanking(game.players).loserIds;
      content = <section className="panel results"><h2 ref={heading} tabIndex={-1}>LOSER REVEAL</h2><p>今回の敗者</p>
        <ul className="losers">{game.participants.filter((p) => losers.includes(p.id)).map((p) => {
          const player = game.players.find((item) => item.id === p.id)!;
          return <li key={p.id}><strong>{p.name}</strong><span>残り {getRemainingDice(player)}個 · OUT {player.strandedDice}個</span></li>;
        })}</ul><p>それぞれの残りダイスで、1回ずつペナルティROLL。</p>{action('ペナルティへ', 'penalty')}</section>;
    } else if (state.phase === 'penalty') {
      const entry = state.penalty.penalties[state.penaltyIndex]!;
      const committedEntry = committedState.phase === 'penalty'
        ? committedState.penalty.penalties[committedState.penaltyIndex]! : entry;
      content = <section className="panel results"><p className="eyebrow">PENALTY {state.penaltyIndex + 1} / {state.penalty.penalties.length}</p>
        <h2 ref={heading} tabIndex={-1}>ペナルティ：{name(entry.playerId)}</h2><p>ペナルティダイス：{entry.diceCount}個（OUT分を含む）</p>
        <DicePresentation dice={committedEntry.status === 'resolved' ? committedEntry.penaltyRoll.map((value) => ({ status: 'safe', value })) : undefined}
          kind="penalty" revision={committedState.revision} busy={busy} onReveal={store.reveal} onPresented={store.presented} config={dicePresentation} />
        {entry.status === 'pending' ? <><ReadyDice count={entry.diceCount} /><p>通常のD6を1回。OUT判定や1・5の特殊効果はありません。</p>{action('ペナルティROLL', 'rollPenalty')}</>
          : <><dl className="metrics"><div><dt>BASE PENALTY</dt><dd>{entry.basePenalty}</dd></div><div><dt>MULTIPLIER</dt><dd>×{entry.multiplier}</dd></div><div><dt>FINAL PENALTY</dt><dd>{entry.finalPenalty}<small>pt</small></dd></div></dl>
            {state.penaltyIndex < state.penalty.penalties.length - 1 ? action('次の敗者へ', 'nextPenalty') : action('最終結果を見る', 'finish')}</>}
      </section>;
    } else if (state.phase === 'finished') {
      content = <section className="results"><h2 ref={heading} tabIndex={-1}>FINAL RESULT</h2><RankingBoard game={game} final />
        <section className="panel"><h3>敗者と最終ペナルティ</h3><ul className="losers">{state.penalty.penalties.map((entry) => <li key={entry.playerId}>
          <strong>{name(entry.playerId)}</strong><span>{entry.status === 'resolved' ? entry.finalPenalty : '—'} pt</span>
        </li>)}</ul></section>
        <div className="final-actions"><ActionButton disabled={busy || !!confirm} onClick={(opener) => setConfirm({ action: 'replay', revision: state.revision, opener })}>同じメンバーでもう一度</ActionButton>
          <ActionButton disabled={busy || !!confirm} onClick={(opener) => setConfirm({ action: 'newGame', revision: state.revision, opener })}>新しいゲーム</ActionButton></div>
      </section>;
    }
  }
  return <main>
    <header className="site-header"><div className="brand-mark" aria-hidden="true">⚄</div><h1>Ichi-Go Game</h1><span>7 DICE GAME</span></header>
    {state.phase !== 'setup' && <div className="game-summary" aria-label="ゲーム情報">
      <span>{state.game.suddenDeathCount ? `サドンデス ${state.game.suddenDeathCount}` : '通常ラウンド'}</span>
      <span>投げ方：{styleLabels[state.game.throwStyle]}</span><span>累積完走：{state.game.totalCompletionCount}</span>
      <strong>ペナルティ倍率 ×{getPenaltyMultiplier(state.game.totalCompletionCount)}</strong>
    </div>}
    {error && <p role="alert" className="field-error">{error}</p>}
    {content}
    {state.phase !== 'setup' && state.phase !== 'finished' && <button className="exit-button" disabled={busy || !!confirm} onClick={(event) => setConfirm({ action: 'newGame', revision: state.revision, opener: event.currentTarget })}>ゲームを終了する</button>}
    <footer>7つのダイス、1と5をつなぐゲーム。</footer>
    {confirm && <ConfirmDialog opener={confirm.opener} title={confirm.action === 'replay' ? '同じメンバーで再開しますか？' : '新しいゲームに戻りますか？'}
      onCancel={() => setConfirm(null)} onConfirm={() => { store.dispatch(confirm.revision, { type: confirm.action }); setConfirm(null); }} />}
  </main>;
}
