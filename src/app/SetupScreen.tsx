import { useEffect, useRef, useState } from 'react';
import { initialSetup, nameError, validateSetup } from '../game/setup';
import type { Setup } from '../game/setup';
import type { DiceMode, RollLimit, ThrowStyle } from '../game/types';

export const styleLabels: Record<ThrowStyle, string> = { rough: '乱暴', normal: '普通', careful: '丁寧' };
const diceModes: readonly DiceMode[] = [5, 7, 10, 14];
const rollLimits: readonly RollLimit[] = [null, 1, 2, 3, 4, 5];

export function SetupScreen({ busy, onStart, onDraftChange, onFullReset, focusOnMount, initial = initialSetup() }: {
  busy: boolean;
  onStart: (setup: Setup) => void;
  onDraftChange: (setup: Setup) => void;
  onFullReset: (opener: HTMLButtonElement) => void;
  focusOnMount: boolean;
  initial?: Setup;
}) {
  const [setup, setSetup] = useState(() => initial);
  const [submitted, setSubmitted] = useState(false);
  const nextId = useRef(2);
  const form = useRef<HTMLFormElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (focusOnMount) heading.current?.focus(); }, [focusOnMount]);
  useEffect(() => { setSetup(initial); }, [initial]);

  // Publish edits as recoverable drafts, not running-game state; blank names are valid drafts and START validates separately.
  function update(next: Setup) {
    setSetup(next);
    onDraftChange(next);
  }
  function move(index: number, offset: number) {
    const participants = [...setup.participants];
    const target = index + offset;
    [participants[index], participants[target]] = [participants[target]!, participants[index]!];
    update({ ...setup, participants });
  }
  function addPlayer() {
    if (setup.participants.length >= 10) return;
    // Allocate new identity independently of row position/name; preserve carried IDs and skip collisions.
    let id: string;
    do { id = `p${nextId.current++}`; } while (setup.participants.some((participant) => participant.id === id));
    update({ ...setup, participants: [...setup.participants, { id, name: '' }] });
  }
  function removePlayer(id: string) {
    if (setup.participants.length <= 2) return;
    update({ ...setup, participants: setup.participants.filter((participant) => participant.id !== id) });
  }

  return <section className="setup-layout">
    <div className="intro">
      <p className="eyebrow">ONE ROLL AT A TIME</p>
      <h2>最後のダイスまで。</h2>
      <p>1と5を出してダイスを減らそう。<br />全て取り除けば、完走。</p>
      <div className="rule-chips"><span>1 → 100点</span><span>5 → 50点</span><span>OUT</span></div>
      <p className="subtle">1か5が出たら、残ったダイスで続行。<br />得点がなければ、そのターンは終了です。</p>
    </div>
    <form ref={form} className="panel setup-form" noValidate onSubmit={(event) => {
      event.preventDefault();
      if (busy) return;
      setSubmitted(true);
      if (!validateSetup(setup)) {
        const index = setup.participants.findIndex((participant) => nameError(participant.name));
        form.current?.querySelector<HTMLInputElement>(`[name="player-${index}"]`)?.focus();
        return;
      }
      onStart(setup);
    }}>
      <h2 ref={heading} tabIndex={-1}>ゲームの準備</h2>
      <div className="setup-section-heading">
        <div><h3>プレイヤー</h3><p className="subtle" id="name-help">2〜10人。名前は1〜12文字、同じ名前も使えます。</p></div>
        <span aria-label={`現在${setup.participants.length}人`}>{setup.participants.length}人</span>
      </div>
      <ol className="setup-players">
        {setup.participants.map((participant, index) => {
          const error = submitted ? nameError(participant.name) : undefined;
          return <li className="setup-player-row" key={participant.id}>
            <div className="name-field"><label htmlFor={`name-${participant.id}`}>プレイヤー {index + 1}</label>
              <input id={`name-${participant.id}`} name={`player-${index}`} value={participant.name} disabled={busy}
                autoComplete="off" aria-invalid={!!error} aria-describedby={error ? `error-${participant.id}` : 'name-help'}
                onChange={(event) => update({ ...setup, participants: setup.participants.map((item) => item.id === participant.id
                  ? { ...item, name: event.target.value } : item) })} />
              {error && <p className="field-error" id={`error-${participant.id}`}>{error}</p>}
            </div>
            <div className="player-controls">
              <button type="button" aria-label={`プレイヤー ${index + 1}を上へ`} disabled={busy || index === 0} onClick={() => move(index, -1)}>↑</button>
              <button type="button" aria-label={`プレイヤー ${index + 1}を下へ`} disabled={busy || index === setup.participants.length - 1} onClick={() => move(index, 1)}>↓</button>
              <button type="button" className="delete-player" aria-label={`プレイヤー ${index + 1}を削除`}
                disabled={busy || setup.participants.length <= 2} onClick={() => removePlayer(participant.id)}>削除</button>
            </div>
          </li>;
        })}
      </ol>
      <button type="button" className="add-player" disabled={busy || setup.participants.length >= 10} onClick={addPlayer}>
        プレイヤー追加{setup.participants.length >= 10 ? '（最大10人）' : ''}
      </button>

      <fieldset disabled={busy}><legend>Dice Mode</legend>
        <div className="styles dice-modes">{diceModes.map((mode) => <label key={mode}>
          <input type="radio" name="dice-mode" value={mode} checked={setup.diceMode === mode}
            onChange={() => update({ ...setup, diceMode: mode })} />{mode} DICE
        </label>)}</div>
      </fieldset>
      <fieldset disabled={busy}><legend>投げ方</legend>
        <div className="styles">{(['rough', 'normal', 'careful'] as const).map((style) => <label key={style}>
          <input type="radio" name="throw-style" value={style} checked={setup.throwStyle === style}
            onChange={() => update({ ...setup, throwStyle: style })} />{styleLabels[style]}
        </label>)}</div>
      </fieldset>
      <fieldset disabled={busy}><legend>ROLL上限</legend>
        <div className="styles roll-limits">{rollLimits.map((limit) => <label key={limit ?? 'infinity'}>
          <input type="radio" name="roll-limit" value={limit ?? 'infinity'}
            aria-label={limit === null ? 'ROLL上限 無制限' : `ROLL上限 ${limit}回`}
            checked={setup.rollLimit === limit} onChange={() => update(setup.mode.type === 'completionTarget'
              ? { ...setup, mode: setup.mode, rollLimit: null } : { ...setup, mode: setup.mode, rollLimit: limit })} />
          <span aria-hidden="true">{limit ?? '∞'}</span>
        </label>)}</div>
      </fieldset>
      <button className="primary" type="submit" disabled={busy} onClick={(event) => { if (event.detail > 1) event.preventDefault(); }}
        onKeyDown={(event) => { if (event.repeat) event.preventDefault(); }}>ゲーム開始</button>
      <p className="subtle">開始後はメンバー・順番・Dice Mode・投げ方・ROLL上限を変更できません。</p>
      <button type="button" className="full-reset-button" disabled={busy} onClick={(event) => onFullReset(event.currentTarget)}>
        すべて初期状態に戻す
      </button>
    </form>
  </section>;
}
