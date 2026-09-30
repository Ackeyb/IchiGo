// @vitest-environment jsdom
import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/app/App';
import { SetupScreen } from '../../src/app/SetupScreen';
import { ReplayPreparationScreen } from '../../src/app/ReplayPreparationScreen';
import { createGameStore } from '../../src/app/gameStore';
import type { SoundCue, SoundPlayer } from '../../src/app/sound';
import type { RandomSource } from '../../src/game/randomSource';

class Sequence implements RandomSource {
  calls = 0;
  constructor(private values: number[]) {}
  next() { const value = this.values[this.calls++]; if (value === undefined) throw new Error('Unexpected draw'); return value; }
}
const normal = (...faces: (number | 'out')[]) => faces.flatMap((face) => face === 'out' ? [0] : [0.9, (face - 0.5) / 6]);
const seven = (face: number | 'out') => normal(...Array<number | 'out'>(7).fill(face));
let frames = new Map<number, FrameRequestCallback>();
let frameId = 0;
function paint() {
  act(() => {
    for (let i = 0; i < 2; i++) {
      const pending = [...frames.values()]; frames.clear(); pending.forEach((callback) => callback(0));
    }
  });
}
beforeEach(() => {
  frames = new Map(); frameId = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++frameId, callback); return frameId; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  // jsdom has no native top-layer dialog. Browser behavior is checked separately.
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('allocates setup IDs without colliding with carried participant IDs', () => {
  let submitted: unknown;
  render(<SetupScreen busy={false} focusOnMount={false} initial={{
    participants: [{ id: 'p2', name: 'A' }, { id: 'custom', name: 'B' }],
    diceMode: 7,
    throwStyle: 'normal',
  }} onDraftChange={() => undefined} onFullReset={() => undefined} onStart={(setup) => { submitted = setup; }} />);
  fireEvent.click(screen.getByRole('button', { name: 'プレイヤー追加' }));
  fireEvent.change(screen.getAllByRole('textbox')[2]!, { target: { value: 'C' } });
  fireEvent.click(screen.getByRole('button', { name: 'ゲーム開始' }));
  expect(submitted).toMatchObject({ participants: [
    { id: 'p2', name: 'A' }, { id: 'custom', name: 'B' }, { id: 'p3', name: 'C' },
  ] });
});

it('keeps replay preparation read-only except for stable-ID reordering and explicit start', () => {
  const reordered: (readonly string[])[] = [];
  let starts = 0;
  render(<ReplayPreparationScreen busy={false} draft={{
    participants: [{ id: 'a', name: '同名' }, { id: 'b', name: '同名' }, { id: 'c', name: '三人目' }],
    diceMode: 10,
    throwStyle: 'careful',
  }} onReorder={(ids) => reordered.push(ids)} onStart={() => { starts++; }} />);
  expect(screen.queryByRole('textbox')).toBeNull();
  expect(screen.queryByRole('radio')).toBeNull();
  expect(screen.queryByRole('button', { name: /追加|削除/ })).toBeNull();
  expect(screen.getByText('10 DICE')).toBeTruthy();
  expect(screen.getByText('丁寧')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '3番 三人目を上へ' }));
  expect(reordered).toEqual([['a', 'c', 'b']]);
  fireEvent.click(screen.getByRole('button', { name: 'この順番で開始' }));
  expect(starts).toBe(1);
});

class FakeSound implements SoundPlayer {
  readonly cues: SoundCue[] = [];
  disposed = 0;
  constructor(private readonly fail = false) {}
  play(cue: SoundCue) { this.cues.push(cue); if (this.fail) throw new Error('audio unavailable'); }
  dispose() { this.disposed += 1; }
}

function mount(values: number[] = [], soundPlayer?: SoundPlayer) {
  const random = new Sequence(values);
  const store = createGameStore(random);
  render(<StrictMode><App store={store} {...(soundPlayer ? { soundPlayer } : {})} /></StrictMode>);
  return { store, random };
}
function click(name: string) {
  const button = screen.getByRole('button', { name });
  expect((button as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(button);
  paint();
}
function names(values = ['あき', 'はる']) {
  while (screen.getAllByRole('textbox').length < values.length) fireEvent.click(screen.getByRole('button', { name: 'プレイヤー追加' }));
  values.forEach((value, index) => fireEvent.change(screen.getByLabelText(`プレイヤー ${index + 1}`, { exact: true }), { target: { value } }));
}
function expectHeading(name: string) { expect(screen.getByRole('heading', { name })).toBeTruthy(); }

describe('Setup', () => {
  it('renders two initial rows with 7 DICE and normal selected', () => {
    mount();
    expect(screen.getAllByRole('textbox')).toHaveLength(2);
    expect((screen.getByLabelText('7 DICE') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText('普通') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('button', { name: 'プレイヤー 1を削除' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getAllByText('ONE ROLL AT A TIME').length).toBeGreaterThan(0);
    expect(screen.getByRole('heading', { name: '最後のダイスまで。' })).toBeTruthy();
  });

  it('adds unique players to ten, disables further additions, and deletes a middle row without renumbering IDs', () => {
    const { store } = mount();
    for (let index = 0; index < 8; index++) fireEvent.click(screen.getByRole('button', { name: /プレイヤー追加/ }));
    expect(screen.getAllByRole('textbox')).toHaveLength(10);
    expect((screen.getByRole('button', { name: /プレイヤー追加/ }) as HTMLButtonElement).disabled).toBe(true);
    let state = store.getSnapshot().state;
    if (state.phase !== 'setup') throw new Error('Expected setup');
    const before = state.draft.participants;
    expect(new Set(before.map((participant) => participant.id)).size).toBe(10);
    fireEvent.change(screen.getAllByRole('textbox')[4]!, { target: { value: '中間' } });
    fireEvent.change(screen.getAllByRole('textbox')[5]!, { target: { value: '次' } });
    fireEvent.click(screen.getByRole('button', { name: 'プレイヤー 5を削除' }));
    state = store.getSnapshot().state;
    if (state.phase !== 'setup') throw new Error('Expected setup');
    expect(state.draft.participants.map((participant) => participant.id)).toEqual(before.filter((_, index) => index !== 4).map((participant) => participant.id));
    expect(state.draft.participants[4]?.name).toBe('次');
  });

  it('reorders duplicate names by stable ID and passes the selected Dice Mode to START', () => {
    const { store } = mount();
    names(['同名', '同名', '三人目']);
    const before = store.getSnapshot().state;
    if (before.phase !== 'setup') throw new Error('Expected setup');
    fireEvent.click(screen.getByRole('button', { name: 'プレイヤー 3を上へ' }));
    fireEvent.click(screen.getByLabelText('10 DICE'));
    fireEvent.click(screen.getByLabelText('乱暴'));
    click('ゲーム開始');
    const state = store.getSnapshot().state;
    if (state.phase !== 'turn') throw new Error('Expected turn');
    expect(state.game.participants.map((participant) => participant.id)).toEqual([
      before.draft.participants[0]!.id, before.draft.participants[2]!.id, before.draft.participants[1]!.id,
    ]);
    expect(state.game.diceMode).toBe(10);
    expect(state.game.throwStyle).toBe('rough');
    expect(state.game.players.every((player) => player.activeDice === 10)).toBe(true);
  });

  it('validates blank / trimmed / grapheme names, allows identical names and focuses the invalid field', () => {
    const { store } = mount();
    click('ゲーム開始');
    expect(store.getSnapshot().state.phase).toBe('setup');
    expect(document.activeElement).toBe(screen.getByLabelText('プレイヤー 1', { exact: true }));
    names(['  ', 'x'.repeat(13)]);
    click('ゲーム開始');
    expect(screen.getAllByText('名前は前後の空白を除いて1〜12文字で入力してください。')).toHaveLength(2);
    const name = '👨‍👩‍👧‍👦'.repeat(12);
    names([` ${name} `, name]);
    click('ゲーム開始');
    const state = store.getSnapshot().state;
    expect(state.phase).toBe('turn');
    if (state.phase !== 'turn') throw new Error('Expected turn');
    expect(state.game.participants.map((p) => p.name)).toEqual([name, name]);
    expect(new Set(state.game.participants.map((p) => p.id)).size).toBe(2);
    expect(state.game.throwStyle).toBe('normal');
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('supports ten players, changing order and selecting the throw style', () => {
    const { store, random } = mount(Array.from({ length: 10 }, () => seven(2)).flat());
    names(Array.from({ length: 10 }, (_, index) => `名前${index}`));
    click('プレイヤー 2を上へ');
    expect(document.body.textContent).not.toContain('%');
    expect(screen.queryByText('再ROLL不可')).toBeNull();
    fireEvent.click(screen.getByLabelText('丁寧'));
    click('ゲーム開始');
    expectHeading('現在プレイヤー：名前1');
    const state = store.getSnapshot().state;
    if (state.phase !== 'turn') throw new Error('Expected turn');
    expect(state.game.participants.map((p) => p.name)).toEqual(['名前1', '名前0', ...Array.from({ length: 8 }, (_, i) => `名前${i + 2}`)]);
    expect(state.game.throwStyle).toBe('careful');
    expect(random.calls).toBe(0);
    expect(screen.getAllByText(/未プレイ/)).toHaveLength(10);
    for (let index = 0; index < 10; index++) {
      click('ROLL');
      if (index < 9) click('次へ');
    }
    click('結果を見る'); expectHeading('FINAL RANKING');
    click('サドンデスへ'); click('開始');
    expectHeading('現在プレイヤー：名前1');
    expect(random.calls).toBe(140);
  });
});

describe('playable flows', () => {
  it('plays a two-player game through continuation, complete, ranking, loser, penalty and replay', () => {
    const { store, random } = mount([...normal(1, 2, 2, 2, 2, 2, 2), ...normal(2, 2, 2, 2, 2, 2), ...seven(1), ...[1, 2, 3, 4, 5, 6].map((face) => (face - 0.5) / 6)]);
    click('サウンド ON');
    names(); fireEvent.click(screen.getByLabelText('乱暴')); click('ゲーム開始');
    expectHeading('現在プレイヤー：あき');
    expect(random.calls).toBe(0);
    click('ROLL');
    expect(screen.getByText('今回の獲得：100点')).toBeTruthy();
    expect(screen.getByText('現在ROLL可能：6個')).toBeTruthy();
    expect(screen.getByText('GET')).toBeTruthy();
    expect(screen.queryByText('直前のROLL · 確定結果')).toBeNull();
    expect(screen.queryByText(/得点ダイス.*個を除外/)).toBeNull();
    expect(document.body.textContent).not.toContain('%');
    expect(within(screen.getByRole('region', { name: '暫定順位' })).queryByText('1位')).toBeNull();
    expect(random.calls).toBe(14);
    click('続けてROLL');
    expect(screen.getByText('TURN END · ターン終了')).toBeTruthy();
    expectHeading('現在プレイヤー：あき');
    expect(screen.getByText('暫定最下位')).toBeTruthy();
    click('次へ');
    expectHeading('現在プレイヤー：はる');
    click('ROLL');
    expect(screen.getByText('COMPLETE!! 完走')).toBeTruthy();
    expect(screen.getByText('累積完走：1')).toBeTruthy();
    expect(screen.getByText('ペナルティ倍率 ×2')).toBeTruthy();
    expect(screen.queryByText('FINAL RANKING')).toBeNull();
    click('結果を見る'); expectHeading('FINAL RANKING');
    click('敗者発表'); expectHeading('LOSER REVEAL');
    click('ペナルティへ'); expectHeading('ペナルティ：あき');
    expect(screen.getByText('ペナルティダイス：6個')).toBeTruthy();
    expect(screen.queryByText(/OUT分を含む/)).toBeNull();
    expect(screen.queryByText(/通常のD6を1回/)).toBeNull();
    click('ペナルティROLL');
    expect(screen.getByText('42')).toBeTruthy();
    expect(screen.queryByText('GET')).toBeNull();
    expect(screen.queryByRole('button', { name: 'ペナルティROLL' })).toBeNull();
    click('最終結果を見る'); expectHeading('FINAL RESULT');
    expect(screen.getByText('42 pt')).toBeTruthy();
    const finished = store.getSnapshot().state;
    click('同じメンバーでもう一度'); click('確認して進む');
    expectHeading('再戦の準備');
    click('この順番で開始');
    const replay = store.getSnapshot().state;
    if (finished.phase !== 'finished' || replay.phase !== 'turn') throw new Error('Unexpected phase');
    expect(replay.game.participants).toEqual(finished.game.participants);
    expect(replay.game.throwStyle).toBe('rough');
    expect(replay.game.totalCompletionCount).toBe(0);
    expect(replay.game.suddenDeathCount).toBe(0);
    expect(replay.game.players.every((p) => p.score === 0 && p.activeDice === 7 && !p.turnFinished)).toBe(true);
    expect(replay.gameNumber).toBe(finished.gameNumber + 1);
    expect(replay).not.toHaveProperty('penalty');
    expect(random.calls).toBe(46);
    expect(screen.getByRole('button', { name: 'サウンド OFF' })).toBeTruthy();
  });

  it('requires an explicit start for repeated sudden death and preserves completion totals', () => {
    const { store, random } = mount([...seven(1), ...seven(5), ...seven('out'), ...seven('out')]);
    click('サウンド ON'); names(); click('ゲーム開始');
    for (let round = 0; round < 2; round++) {
      click('ROLL'); click('次へ'); click('ROLL'); click('結果を見る');
      expectHeading('FINAL RANKING');
      expect(screen.queryByRole('button', { name: '敗者発表' })).toBeNull();
      click('サドンデスへ'); expectHeading('SUDDEN DEATH');
      expect(screen.getByText('全プレイヤー参加')).toBeTruthy();
      expect(screen.getByText('score / dice / OUTをリセット')).toBeTruthy();
      expect(screen.getByText(/累積完走 2を維持/)).toBeTruthy();
      expect(screen.getByText(/倍率 ×3を維持/)).toBeTruthy();
      const calls = random.calls;
      expect(store.getSnapshot().state.phase).toBe('suddenDeath');
      click('開始');
      expect(random.calls).toBe(calls);
      expectHeading('現在プレイヤー：あき');
      expect(screen.getByText('累積完走：2')).toBeTruthy();
      const state = store.getSnapshot().state;
      if (state.phase !== 'turn') throw new Error('Expected turn');
      expect(state.game.suddenDeathCount).toBe(round + 1);
      expect(state.game.players.every((p) => p.activeDice === 7 && p.score === 0 && p.strandedDice === 0 && !p.turnFinished)).toBe(true);
      expect(screen.getByRole('button', { name: 'サウンド OFF' })).toBeTruthy();
    }
  });

  it('reveals all tied losers and rolls their independent penalties in the fixed order', () => {
    const { random } = mount([...seven(1), ...seven('out'), ...seven(2), ...Array<number>(7).fill(0), ...Array<number>(7).fill(0.99)]);
    click('サウンド ON'); names(['勝者', '敗者A', '敗者B']); click('ゲーム開始');
    click('ROLL'); click('次へ'); click('ROLL');
    expect(screen.getByText('OUTあり・完走不能。OUTダイスは再ROLLされません。')).toBeTruthy();
    click('次へ'); click('ROLL');
    expect(screen.getAllByText('暫定最下位')).toHaveLength(2);
    click('結果を見る'); click('敗者発表');
    expect(screen.getByText('敗者A')).toBeTruthy(); expect(screen.getByText('敗者B')).toBeTruthy();
    click('ペナルティへ'); expectHeading('ペナルティ：敗者A');
    click('ペナルティROLL'); expect(screen.getByText('14')).toBeTruthy();
    expectHeading('ペナルティ：敗者A');
    click('次の敗者へ'); expectHeading('ペナルティ：敗者B');
    click('ペナルティROLL'); expect(screen.getByText('84')).toBeTruthy();
    click('最終結果を見る');
    expect(screen.getByText('14 pt')).toBeTruthy(); expect(screen.getByText('84 pt')).toBeTruthy();
    expect(random.calls).toBe(49);
    click('新しいゲーム'); click('確認して進む');
    expect(screen.getAllByRole('textbox')).toHaveLength(3);
    expect(screen.getAllByRole('textbox').map((input) => (input as HTMLInputElement).value)).toEqual(['勝者', '敗者A', '敗者B']);
    expect((screen.getByLabelText('普通') as HTMLInputElement).checked).toBe(true);
    expect(document.body.textContent).not.toContain('%');
    expect(screen.getByRole('button', { name: 'サウンド OFF' })).toBeTruthy();
    fireEvent.change(screen.getAllByRole('textbox')[0]!, { target: { value: '編集した勝者' } });
    fireEvent.click(screen.getByRole('button', { name: 'プレイヤー追加' }));
    fireEvent.click(screen.getByRole('button', { name: 'プレイヤー 2を削除' }));
    fireEvent.click(screen.getByRole('button', { name: 'プレイヤー 3を上へ' }));
    fireEvent.click(screen.getByLabelText('5 DICE'));
    fireEvent.click(screen.getByLabelText('丁寧'));
    expect((screen.getByLabelText('5 DICE') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText('丁寧') as HTMLInputElement).checked).toBe(true);
    const reset = screen.getByRole('button', { name: 'すべて初期状態に戻す' });
    fireEvent.click(reset);
    expect(screen.getByText(/Sound設定は維持されます/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }));
    expect(document.activeElement).toBe(reset);
    expect(screen.getAllByRole('textbox')).toHaveLength(3);
    click('すべて初期状態に戻す');
    click('初期状態に戻す'); paint();
    expect(screen.getAllByRole('textbox')).toHaveLength(2);
    expect(screen.getAllByRole('textbox').map((input) => (input as HTMLInputElement).value)).toEqual(['', '']);
    expect((screen.getByLabelText('7 DICE') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText('普通') as HTMLInputElement).checked).toBe(true);
    expect(screen.getByRole('button', { name: 'サウンド OFF' })).toBeTruthy();
  });
});

describe('sound presentation', () => {
  it('starts ON, toggles accessibly, and emits distinct gameplay cues', () => {
    const sound = new FakeSound();
    mount(seven('out'), sound);
    const toggle = screen.getByRole('button', { name: 'サウンド ON' });
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    names(); click('ゲーム開始'); click('ROLL');
    expect(sound.cues).toContain('roll');
    expect(sound.cues).toContain('impact');
    expect(sound.cues).toContain('out');
    expect(sound.cues).toContain('turn-end');

    click('サウンド ON');
    expect(screen.getByRole('button', { name: 'サウンド OFF' }).getAttribute('aria-pressed')).toBe('false');
    const cueCount = sound.cues.length;
    click('次へ');
    expect(sound.cues).toHaveLength(cueCount);
  });

  it('keeps gameplay moving when the sound subsystem throws', () => {
    const sound = new FakeSound(true);
    const { store } = mount([...seven('out'), ...seven(2)], sound);
    names(); click('ゲーム開始'); click('ROLL');
    expectHeading('現在プレイヤー：あき');
    expect(screen.getByText('TURN END · ターン終了')).toBeTruthy();
    click('次へ'); click('ROLL');
    expectHeading('現在プレイヤー：はる');
    const state = store.getSnapshot().state;
    expect(state.phase === 'turn' && state.turn.player.turnFinished).toBe(true);
  });

  it('uses distinct cues for scoring, completion, OUT, loser reveal, and penalty', () => {
    const sound = new FakeSound();
    mount([...seven(1), ...seven('out'), ...Array<number>(7).fill(0)], sound);
    names(); click('ゲーム開始');
    click('ROLL'); click('次へ'); click('ROLL'); click('結果を見る');
    click('敗者発表'); click('ペナルティへ'); click('ペナルティROLL');
    expect(sound.cues).toEqual(expect.arrayContaining([
      'roll', 'impact', 'scoring', 'complete', 'out', 'turn-end', 'loser-reveal', 'penalty',
    ]));
  });
});

describe('interaction and accessibility', () => {
  it('locks until the committed paint, rejects duplicate/stale requests and ignores double-click events', () => {
    const { store, random } = mount(normal(1, 2, 2, 2, 2, 2, 2));
    names(); click('ゲーム開始');
    const before = store.getSnapshot().state;
    const button = screen.getByRole('button', { name: 'ROLL' });
    fireEvent.click(button);
    expect((screen.getByRole('button', { name: '続けてROLL' }) as HTMLButtonElement).disabled).toBe(true);
    act(() => {
      store.dispatch(before.revision, { type: 'roll' });
      store.dispatch(store.getSnapshot().state.revision, { type: 'roll' });
    });
    expect(random.calls).toBe(14);
    paint();
    act(() => store.dispatch(before.revision, { type: 'roll' }));
    fireEvent.click(screen.getByRole('button', { name: '続けてROLL' }), { detail: 2 });
    expect(random.calls).toBe(14);
    expect(store.getSnapshot().state.revision).toBe(before.revision + 1);
  });

  it('supports keyboard play, confirmation cancellation and focus restoration', async () => {
    const user = userEvent.setup();
    mount(seven('out')); names();
    screen.getByRole('button', { name: 'ゲーム開始' }).focus();
    await user.keyboard('{Enter}'); paint();
    const heading = screen.getByRole('heading', { name: '現在プレイヤー：あき' });
    expect(document.activeElement).toBe(heading);
    const headingFocus = vi.spyOn(heading, 'focus');
    await user.tab(); expect(document.activeElement).toBe(screen.getByRole('button', { name: 'ROLL' }));
    await user.keyboard(' '); paint();
    expect(headingFocus).toHaveBeenCalledWith({ preventScroll: true });
    expect(screen.getByText('TURN END · ターン終了')).toBeTruthy();
    const exit = screen.getByRole('button', { name: 'ゲームを終了する' });
    await user.click(exit);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'キャンセル' }));
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '確認して進む' }));
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'キャンセル' }));
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '確認して進む' }));
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(exit);
    expectHeading('現在プレイヤー：あき');
  });
});
