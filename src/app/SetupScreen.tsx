import { useEffect, useRef, useState } from 'react';
import { initialSetup, nameError, validateSetup } from '../game/setup';
import type { Setup } from '../game/setup';
import type { ThrowStyle } from '../game/types';

export const styleLabels: Record<ThrowStyle, string> = { rough: '乱暴', normal: '普通', careful: '丁寧' };

export function SetupScreen({ busy, onStart, onDraftChange, focusOnMount, initial = initialSetup() }: {
  busy: boolean;
  onStart: (setup: Setup) => void;
  onDraftChange?: (setup: Setup) => void;
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
  function update(next: Setup) {
    setSetup(next);
    onDraftChange?.(next);
  }
  function move(index: number, offset: number) {
    const participants = [...setup.participants];
    const target = index + offset;
    [participants[index], participants[target]] = [participants[target]!, participants[index]!];
    update({ ...setup, participants });
  }
  return <section className="setup-layout">
    <div className="intro">
      <p className="eyebrow">7 DICE · ONE CHANCE AT A TIME</p>
      <h2>7つのダイスで、<br />最後まで。</h2>
      <p>1と5を出してダイスを減らそう。<br />全て取り除けば、完走。</p>
      <div className="rule-chips"><span>1 → 100点</span><span>5 → 50点</span><span>OUT</span></div>
      <p className="subtle">1か5が出たら、残ったダイスで続行。<br />得点がなければ、そのターンは終了です。</p>
    </div>
    <form ref={form} className="panel setup-form" noValidate onSubmit={(event) => {
      event.preventDefault();
      if (busy) return;
      setSubmitted(true);
      if (!validateSetup(setup)) {
        const index = setup.participants.findIndex((p) => nameError(p.name));
        form.current?.querySelector<HTMLInputElement>(`[name="player-${index}"]`)?.focus();
        return;
      }
      onStart(setup);
    }}>
      <h2 ref={heading} tabIndex={-1}>ゲームの準備</h2>
      <label htmlFor="player-count">プレイヤー人数</label>
      <select id="player-count" value={setup.participants.length} disabled={busy} onChange={(event) => {
        const count = Number(event.target.value);
        const participants = setup.participants.slice(0, count);
        while (participants.length < count) {
          let id: string;
          do { id = `p${nextId.current++}`; } while (participants.some((participant) => participant.id === id));
          participants.push({ id, name: '' });
        }
        update({ ...setup, participants });
      }}>{Array.from({ length: 9 }, (_, i) => <option key={i} value={i + 2}>{i + 2}人</option>)}</select>
      <p className="subtle" id="name-help">名前は1〜12文字。同じ名前も使えます。上からプレイ順です。</p>
      <ol className="setup-players">
        {setup.participants.map((p, index) => {
          const error = submitted ? nameError(p.name) : undefined;
          return <li key={p.id}>
            <div className="name-field"><label htmlFor={`name-${p.id}`}>プレイヤー {index + 1}</label>
              <input id={`name-${p.id}`} name={`player-${index}`} value={p.name} disabled={busy}
                autoComplete="off" aria-invalid={!!error} aria-describedby={error ? `error-${p.id}` : 'name-help'}
                onChange={(event) => update({ ...setup, participants: setup.participants.map((item) => item.id === p.id ? { ...item, name: event.target.value } : item) })} />
              {error && <p className="field-error" id={`error-${p.id}`}>{error}</p>}
            </div>
            <div className="order-buttons">
              <button type="button" aria-label={`プレイヤー ${index + 1}を上へ`} disabled={busy || index === 0} onClick={() => move(index, -1)}>↑</button>
              <button type="button" aria-label={`プレイヤー ${index + 1}を下へ`} disabled={busy || index === setup.participants.length - 1} onClick={() => move(index, 1)}>↓</button>
            </div>
          </li>;
        })}
      </ol>
      <fieldset disabled={busy}><legend>投げ方</legend>
        <div className="styles">{(['rough', 'normal', 'careful'] as const).map((style) => <label key={style}>
          <input type="radio" name="throw-style" value={style} checked={setup.throwStyle === style} onChange={() => update({ ...setup, throwStyle: style })} />
          {styleLabels[style]}
        </label>)}</div>
      </fieldset>
      <button className="primary" type="submit" disabled={busy} onClick={(e) => { if (e.detail > 1) e.preventDefault(); }}
        onKeyDown={(e) => { if (e.repeat) e.preventDefault(); }}>ゲーム開始</button>
      <p className="subtle">開始後はメンバー・順番・投げ方を変更できません。</p>
    </form>
  </section>;
}
