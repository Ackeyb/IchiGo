import { useCallback, useEffect, useMemo } from 'react';
import type { RefObject, ReactNode } from 'react';
import type { FlowAction, FlowState } from '../game/gameFlow';
import { partitionSeriesPenalty, seriesPenaltyResult } from '../game/seriesPenalty';
import { DicePresentation } from './DicePresentation';
import type { DicePresentationConfig } from './DicePresentation';
import { ReadyDice } from './DiceView';
import { captureSeriesPenaltyPresentation } from './seriesPenaltyAutoCoordinator';
import type { createSeriesPenaltyAutoCoordinator } from './seriesPenaltyAutoCoordinator';
import type { GameStore } from './gameStore';
import type { SoundCue } from './sound';

type PenaltyFlow = Extract<FlowState, { phase: 'seriesPenalty' | 'seriesFinished' }>;
export function SeriesPenaltyPresentation({ state, committedState, store, coordinator, busy, blocked, heading, send, config, onCue }: {
  state: PenaltyFlow;
  committedState: PenaltyFlow;
  store: GameStore;
  coordinator: RefObject<ReturnType<typeof createSeriesPenaltyAutoCoordinator> | undefined>;
  busy: boolean;
  blocked: boolean;
  heading: RefObject<HTMLHeadingElement | null>;
  send: (action: FlowAction) => void;
  config?: DicePresentationConfig | undefined;
  onCue: (cue: SoundCue) => void;
}) {
  const { game, seriesPenalty } = state;
  const entry = seriesPenalty.entries[seriesPenalty.currentLoserIndex]!;
  const committed = committedState.seriesPenalty.entries[committedState.seriesPenalty.currentLoserIndex]!;
  const chunk = committed.committedChunks.at(-1);
  const plan = partitionSeriesPenalty(entry.totalDice);
  const chunkPosition = Math.max(1, committed.committedChunks.length);
  const identity = useMemo(() => captureSeriesPenaltyPresentation(store), [store, committedState]);
  const presented = useCallback((revision: number) => {
    if (identity?.revision === revision) coordinator.current?.presented(identity);
  }, [identity, coordinator]);
  // A restored committed chunk is already revealed. Paint it before a fresh coordinator wait;
  // never reanimate/re-roll it or acknowledge a later identity from an old callback.
  useEffect(() => {
    if (busy || !identity || entry.status !== 'running') return;
    let second = 0;
    const first = requestAnimationFrame(() => { second = requestAnimationFrame(() => presented(identity.revision)); });
    return () => { cancelAnimationFrame(first); cancelAnimationFrame(second); };
  }, [busy, identity, entry.status, presented]);
  const result = seriesPenaltyResult(entry, game.totalCompletionCount);
  const button = (label: string, action: FlowAction): ReactNode => <button className="primary" disabled={busy || blocked}
    onClick={(event) => { if (event.detail <= 1) send(action); }} onKeyDown={(event) => { if (event.repeat) event.preventDefault(); }}>{label}</button>;
  return <section className="panel results series-penalty">
    <p className="eyebrow">PENALTY {seriesPenalty.currentLoserIndex + 1} / {seriesPenalty.entries.length}</p>
    <h2 ref={heading} tabIndex={-1}>ペナルティ：{game.participants.find((p) => p.id === entry.playerId)!.name}</h2>
    <p>ペナルティダイス：{entry.totalDice}個 · {plan.length ? `分割ROLL ${chunkPosition} / ${plan.length} · 今回 ${plan[chunkPosition - 1]}個` : 'ROLL不要'}</p>
    {entry.totalDice > 0 && <DicePresentation dice={chunk} diceMode={game.diceMode} kind="penalty" revision={committedState.revision} busy={busy}
      presentation={chunk ? { kind: 'seriesPenalty' } : undefined}
      onReveal={store.reveal} onPresented={presented} config={config} onCue={onCue} />}
    <div className="series-penalty-ready">{entry.status === 'pending' && <ReadyDice count={plan[0]!} />}</div>
    <dl className="metrics penalty-metrics" aria-label="ペナルティ計算">
      <div className="penalty-metric"><dt>累計BASE</dt><dd>{entry.basePenalty}</dd></div>
      <div className="penalty-metric"><dt>{result ? 'MULTIPLIER' : '計算待ち'}</dt><dd>{result ? `×${result.multiplier}` : '—'}</dd></div>
      <div className="penalty-metric"><dt>{result ? 'FINAL' : '結果待ち'}</dt><dd>{result ? result.finalPenalty : '—'}<small>pt</small></dd></div>
    </dl>
    <div className="series-penalty-action">
      {entry.status === 'pending' ? button('ペナルティROLL', { type: 'startSeriesPenalty', penaltyId: seriesPenalty.penaltyId, playerId: entry.playerId, chunkIndex: 0 })
        : entry.status === 'running' ? <p role="status">次のROLL待機中</p>
          : seriesPenalty.currentLoserIndex < seriesPenalty.entries.length - 1
            ? button('次の敗者へ', { type: 'nextSeriesPenaltyLoser', penaltyId: seriesPenalty.penaltyId, playerId: entry.playerId })
            : button('最終結果を見る', { type: 'finish' })}
    </div>
  </section>;
}
