import { useEffect, useRef } from 'react';
import type { ReplayPreparation } from '../game/gameFlow';
import { styleLabels } from './SetupScreen';

export function ReplayPreparationScreen({ draft, busy, onReorder, onStart }: {
  draft: ReplayPreparation;
  busy: boolean;
  onReorder: (participantIds: readonly string[]) => void;
  onStart: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  // Replay edits order only; Flow and Recovery also enforce the locked identities and game settings.
  function move(index: number, offset: number) {
    const ids = draft.participants.map((participant) => participant.id);
    const target = index + offset;
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    onReorder(ids);
  }
  return <section className="panel results replay-preparation">
    <p className="eyebrow">ONE ROLL AT A TIME</p>
    <h2 ref={heading} tabIndex={-1}>再戦の準備</h2>
    <p>名前と設定はそのまま。順番だけ変更できます。</p>
    <dl className="replay-settings" aria-label="再戦の設定">
      <div><dt>Dice Mode</dt><dd>{draft.diceMode} DICE</dd></div>
      <div><dt>投げ方</dt><dd>{styleLabels[draft.throwStyle]}</dd></div>
      <div><dt>ROLL上限</dt><dd>{draft.rollLimit === null ? 'ROLL ∞' : `ROLL ${draft.rollLimit}回`}</dd></div>
    </dl>
    <h3>プレイ順</h3>
    <ol className="replay-players">
      {draft.participants.map((participant, index) => <li key={participant.id}>
        <span className="replay-order" aria-hidden="true">{index + 1}</span>
        <strong>{participant.name}</strong>
        <div className="player-controls">
          <button type="button" aria-label={`${index + 1}番 ${participant.name}を上へ`} disabled={busy || index === 0} onClick={() => move(index, -1)}>↑</button>
          <button type="button" aria-label={`${index + 1}番 ${participant.name}を下へ`} disabled={busy || index === draft.participants.length - 1} onClick={() => move(index, 1)}>↓</button>
        </div>
      </li>)}
    </ol>
    <button className="primary" disabled={busy} onClick={onStart}>この順番で開始</button>
  </section>;
}
