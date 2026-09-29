import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { CSSProperties, ReactNode } from 'react';
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
import { ReplayPreparationScreen } from './ReplayPreparationScreen';
import { ReadyDice } from './DiceView';
import { DicePresentation } from './DicePresentation';
import type { DicePresentationConfig } from './DicePresentation';
import type { DiceResultPresentation } from './DicePresentation';
import { RankingBoard } from './RankingBoard';
import { ConfirmDialog } from './ConfirmDialog';
import { WebAudioSoundPlayer } from './sound';
import type { SoundCue, SoundPlayer } from './sound';
import { recoveryNoticeText } from '../storage/sessionRecovery';
import type { RecoveryNotice, SessionRecovery } from '../storage/sessionRecovery';
import './app.css';

function ActionButton({ children, disabled, onClick }: { children: ReactNode; disabled: boolean; onClick: (button: HTMLButtonElement) => void }) {
  return <button className="primary" disabled={disabled} onClick={(event) => { if (event.detail <= 1) onClick(event.currentTarget); }}
    onKeyDown={(event) => { if (event.repeat) event.preventDefault(); }}>{children}</button>;
}

export function App({ random = mathRandomSource, store: suppliedStore, dicePresentation, soundPlayer: suppliedSound, recovery: suppliedRecovery }: {
  random?: RandomSource;
  store?: GameStore;
  dicePresentation?: DicePresentationConfig;
  soundPlayer?: SoundPlayer;
  recovery?: SessionRecovery;
} = {}) {
  const [recovery] = useState(() => suppliedRecovery);
  const [store] = useState(() => suppliedStore ?? createGameStore(random, recovery));
  const [sound] = useState(() => suppliedSound ?? new WebAudioSoundPlayer());
  const [initialSound] = useState(() => recovery?.loadSound() ?? { enabled: true });
  const [soundEnabled, setSoundEnabled] = useState(initialSound.enabled);
  const soundEnabledRef = useRef(initialSound.enabled);
  const [soundRecoveryNotice, setSoundRecoveryNotice] = useState<RecoveryNotice | undefined>(initialSound.notice);
  const { state: committedState, visibleState: state, busy, error, recovered, recoveryNotice } = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const [confirm, setConfirm] = useState<{ action: 'newGame' | 'replay' | 'exitGame' | 'fullReset'; revision: number; opener: HTMLElement } | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const playCue = useCallback((cue: SoundCue) => {
    if (!soundEnabledRef.current) return;
    try { sound.play(cue); } catch { /* sound is fail-open */ }
  }, [sound]);
  useEffect(() => () => sound.dispose(), [sound]);
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
  const send = (action: FlowAction) => {
    if (action.type === 'roll' || action.type === 'rollPenalty') playCue('roll');
    else if (action.type === 'suddenDeath') playCue('sudden-death');
    else if (action.type === 'reveal') playCue('loser-reveal');
    store.dispatch(committedState.revision, action);
  };
  const action = (label: string, type: Exclude<FlowAction['type'], 'start' | 'updateSetup' | 'reorderReplay'>) => <ActionButton disabled={busy || !!confirm}
    onClick={() => send({ type })}>{label}</ActionButton>;
  const toggleSound = () => {
    const next = !soundEnabledRef.current;
    soundEnabledRef.current = next;
    setSoundEnabled(next);
    setSoundRecoveryNotice(recovery?.saveSound(next));
    if (next) { try { sound.play('ui'); } catch { /* sound is fail-open */ } }
  };
  let content: ReactNode;
  if (state.phase === 'setup') content = <SetupScreen key={`${state.gameNumber}/${state.setupKind}`} initial={state.draft} busy={busy}
    focusOnMount={state.gameNumber > 0 || state.setupKind !== 'initial'} onDraftChange={(draft) => send({ type: 'updateSetup', draft })}
    onFullReset={(opener) => setConfirm({ action: 'fullReset', revision: state.revision, opener })}
    onStart={(setup) => send({ type: 'start', setup })} />;
  else if (state.phase === 'replayPreparation') content = <ReplayPreparationScreen draft={state.draft} busy={busy || !!confirm}
    onReorder={(participantIds) => send({ type: 'reorderReplay', participantIds })} onStart={() => send({ type: 'startReplay' })} />;
  else {
    const { game } = state;
    const name = (id: string) => game.participants.find((p) => p.id === id)!.name;
    if (state.phase === 'turn') {
      const player = state.turn.player;
      const result = state.turn.phase === 'result' ? state.turn.result : undefined;
      const committedResult = committedState.phase === 'turn' && committedState.turn.phase === 'result'
        ? committedState.turn.result : undefined;
      const rollPresentation: DiceResultPresentation | undefined = committedResult && committedState.phase === 'turn' ? {
        kind: 'normal',
        gainedScore: committedResult.gainedScore,
        scoringCount: committedResult.scoringCount,
        outCount: committedResult.outCount,
        outcome: committedResult.outcome,
        totalCompletionCount: committedState.game.totalCompletionCount,
        multiplier: getPenaltyMultiplier(committedState.game.totalCompletionCount),
      } : undefined;
      const current = game.participants[game.currentPlayerIndex]!;
      content = <div className="game-layout"><section className="play panel">
        <p className="eyebrow">PLAYER {game.currentPlayerIndex + 1} / {game.participants.length}</p>
        <h2 className="current-player" ref={heading} tabIndex={-1}><span>現在プレイヤー：</span>{current.name}</h2>
        <div className="dice-field">
          <p className="dice-field-intro" aria-hidden={result ? true : undefined}>{result ? '\u00a0' : 'ダイスを振って、ゲームを始めよう。'}</p>
          <DicePresentation dice={committedResult?.dice} diceMode={game.diceMode} kind="normal" revision={committedState.revision}
            busy={busy} presentation={rollPresentation} onCue={playCue}
            onReveal={store.reveal} onPresented={store.presented} config={dicePresentation} />
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
        <div className="turn-action-slot">
          <p className="turn-action-context">{player.turnFinished && game.currentPlayerIndex < game.participants.length - 1
            ? <>次のプレイヤー：<strong>{game.participants[game.currentPlayerIndex + 1]!.name}</strong></> : '\u00a0'}</p>
          {!player.turnFinished ? action(result ? '続けてROLL' : 'ROLL', 'roll') : game.currentPlayerIndex < game.participants.length - 1
            ? action('次へ', 'next') : action('結果を見る', 'ranking')}
        </div>
      </section><RankingBoard game={game} currentHasRolled={state.turn.nextRollNumber > 1} /></div>;
    } else if (state.phase === 'ranking') {
      const tied = shouldStartSuddenDeath(game.players, game.diceMode);
      content = <section className="results phase-reveal"><h2 ref={heading} tabIndex={-1}>FINAL RANKING</h2><RankingBoard game={game} final />
        <p>{tied ? '全員同順位。サドンデスへ進みます。' : 'このラウンドで決着しました。'}</p>
        {tied ? action('サドンデスへ', 'suddenDeath') : action('敗者発表', 'reveal')}</section>;
    } else if (state.phase === 'suddenDeath') {
      content = <section className="panel results sudden-death-reveal"><p className="eyebrow">もう一度、全員で。</p><h2 ref={heading} tabIndex={-1}>SUDDEN DEATH</h2>
        <p><strong>全プレイヤー参加</strong>で、元のプレイ順のまま再開します。</p>
        <div className="state-notes"><span>score / dice / OUTをリセット</span><span>累積完走 {game.totalCompletionCount}を維持</span>
          <span>倍率 ×{getPenaltyMultiplier(game.totalCompletionCount)}を維持</span></div>
        <p>次のラウンドの先頭：{game.participants[0]!.name}</p>{action('開始', 'startSuddenDeath')}</section>;
    } else if (state.phase === 'loserReveal') {
      const losers = calculateFinalRanking(game.players, game.diceMode).loserIds;
      content = <section className="panel results loser-reveal"><h2 ref={heading} tabIndex={-1}>LOSER REVEAL</h2><p>今回の敗者</p>
        <ul className="losers">{game.participants.filter((p) => losers.includes(p.id)).map((p, index) => {
          const player = game.players.find((item) => item.id === p.id)!;
          return <li key={p.id} style={{ '--reveal-index': index } as CSSProperties}><strong>{p.name}</strong><span>残り {getRemainingDice(player)}個 · OUT {player.strandedDice}個</span></li>;
        })}</ul><p>それぞれの残りダイスで、1回ずつペナルティROLL。</p>{action('ペナルティへ', 'penalty')}</section>;
    } else if (state.phase === 'penalty') {
      const entry = state.penalty.penalties[state.penaltyIndex]!;
      const committedEntry = committedState.phase === 'penalty'
        ? committedState.penalty.penalties[committedState.penaltyIndex]! : entry;
      const penaltyPresentation: DiceResultPresentation | undefined = committedEntry.status === 'resolved' ? {
        kind: 'penalty', basePenalty: committedEntry.basePenalty,
        multiplier: committedEntry.multiplier, finalPenalty: committedEntry.finalPenalty,
      } : undefined;
      content = <section className="panel results"><p className="eyebrow">PENALTY {state.penaltyIndex + 1} / {state.penalty.penalties.length}</p>
        <h2 ref={heading} tabIndex={-1}>ペナルティ：{name(entry.playerId)}</h2><p>ペナルティダイス：{entry.diceCount}個</p>
        <DicePresentation dice={committedEntry.status === 'resolved' ? committedEntry.penaltyRoll.map((value) => ({ status: 'safe', value })) : undefined}
          diceMode={game.diceMode} kind="penalty" revision={committedState.revision} busy={busy} presentation={penaltyPresentation} onCue={playCue}
          onReveal={store.reveal} onPresented={store.presented} config={dicePresentation} />
        {entry.status === 'pending' ? <><ReadyDice count={entry.diceCount} />{action('ペナルティROLL', 'rollPenalty')}</>
          : <><dl className="metrics penalty-metrics"><div className="penalty-metric"><dt>BASE PENALTY</dt><dd>{entry.basePenalty}</dd></div><div className="penalty-metric"><dt>MULTIPLIER</dt><dd>×{entry.multiplier}</dd></div><div className="penalty-metric"><dt>ペナルティポイント</dt><dd>{entry.finalPenalty}<small>pt</small></dd></div></dl>
            {state.penaltyIndex < state.penalty.penalties.length - 1 ? action('次の敗者へ', 'nextPenalty') : action('最終結果を見る', 'finish')}</>}
      </section>;
    } else if (state.phase === 'finished') {
      content = <section className="results"><h2 ref={heading} tabIndex={-1}>FINAL RESULT</h2><RankingBoard game={game} final />
        <section className="panel"><h3>敗者とペナルティポイント</h3><ul className="losers">{state.penalty.penalties.map((entry) => <li key={entry.playerId}>
          <strong>{name(entry.playerId)}</strong><span>{entry.status === 'resolved' ? entry.finalPenalty : '—'} pt</span>
        </li>)}</ul></section>
        <div className="final-actions"><ActionButton disabled={busy || !!confirm} onClick={(opener) => setConfirm({ action: 'replay', revision: state.revision, opener })}>同じメンバーでもう一度</ActionButton>
          <ActionButton disabled={busy || !!confirm} onClick={(opener) => setConfirm({ action: 'newGame', revision: state.revision, opener })}>新しいゲーム</ActionButton></div>
      </section>;
    }
  }
  return <main>
    <header className="site-header"><div className="brand-mark" aria-hidden="true">⚄</div><h1>Ichi-Go Game</h1><span>ONE ROLL AT A TIME</span>
      <button className="sound-toggle" data-sound={soundEnabled ? 'on' : 'off'} aria-pressed={soundEnabled} aria-label={`サウンド ${soundEnabled ? 'ON' : 'OFF'}`} onClick={toggleSound}>
        Sound {soundEnabled ? 'ON' : 'OFF'}</button></header>
    {recovered && <p className="recovery-status" role="status">ゲームを復旧しました。</p>}
    {(recoveryNotice ?? soundRecoveryNotice) && <p className="recovery-warning" role="status">
      {recoveryNoticeText((recoveryNotice ?? soundRecoveryNotice)!)}</p>}
    {state.phase !== 'setup' && state.phase !== 'replayPreparation' && <div className="game-summary" aria-label="ゲーム情報">
      <span>{state.game.suddenDeathCount ? `サドンデス ${state.game.suddenDeathCount}` : '通常ラウンド'}</span>
      <span>投げ方：{styleLabels[state.game.throwStyle]}</span><span>累積完走：{state.game.totalCompletionCount}</span>
      <strong>ペナルティ倍率 ×{getPenaltyMultiplier(state.game.totalCompletionCount)}</strong>
    </div>}
    {error && <p role="alert" className="field-error">{error}</p>}
    {content}
    {state.phase !== 'setup' && state.phase !== 'replayPreparation' && state.phase !== 'finished' && <button className="exit-button" disabled={busy || !!confirm} onClick={(event) => setConfirm({ action: 'exitGame', revision: state.revision, opener: event.currentTarget })}>ゲームを終了する</button>}
    <footer>ONE ROLL AT A TIME · 最後のダイスまで。</footer>
    {confirm && <ConfirmDialog opener={confirm.opener} title={confirm.action === 'replay' ? '再戦の準備へ進みますか？'
      : confirm.action === 'newGame' ? '新しいゲームに戻りますか？'
        : confirm.action === 'fullReset' ? 'すべて初期状態に戻しますか？' : 'ゲームを終了しますか？'}
      {...(confirm.action === 'fullReset' ? {
        description: 'プレイヤー名・順番・Dice Mode・投げ方が初期状態に戻ります。Sound設定は維持されます。',
        confirmLabel: '初期状態に戻す',
      } : {})}
      onCancel={() => setConfirm(null)} onConfirm={() => { store.dispatch(confirm.revision, { type: confirm.action }); setConfirm(null); }} />}
  </main>;
}
