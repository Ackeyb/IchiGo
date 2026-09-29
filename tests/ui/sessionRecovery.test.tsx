// @vitest-environment jsdom
import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/app/App';
import { createGameStore } from '../../src/app/gameStore';
import { advanceFlow, initialFlow } from '../../src/game/gameFlow';
import type { FlowAction, FlowState } from '../../src/game/gameFlow';
import { SessionRecovery } from '../../src/storage/sessionRecovery';
import type { StorageAdapter } from '../../src/storage/sessionRecovery';
import type { RandomSource } from '../../src/game/randomSource';

class MemoryStorage implements StorageAdapter {
  readonly values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

class Sequence implements RandomSource {
  calls = 0;
  constructor(private readonly values: readonly number[]) {}
  next() { return this.values[this.calls++] ?? 0.9; }
}

const normal = (...faces: number[]) => faces.flatMap((face) => [0.9, (face - 0.5) / 6]);
const setup = { participants: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], throwStyle: 'normal' as const, diceMode: 7 as const };
const perform = (state: FlowState, action: FlowAction, random: RandomSource) => advanceFlow(state, state.revision, action, random);
let frames = new Map<number, FrameRequestCallback>();
let frameId = 0;
function paint() {
  act(() => {
    for (let index = 0; index < 2; index++) {
      const pending = [...frames.values()]; frames.clear(); pending.forEach((callback) => callback(0));
    }
  });
}

beforeEach(() => {
  frames = new Map(); frameId = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++frameId, callback); return frameId; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('session recovery UI', () => {
  it('restores an in-progress setup draft without treating blank names as corrupt', () => {
    const storage = new MemoryStorage();
    const first = render(<App recovery={new SessionRecovery(() => storage)} />);
    fireEvent.change(screen.getByLabelText('プレイヤー 1', { exact: true }), { target: { value: '編集中' } });
    fireEvent.click(screen.getByRole('button', { name: 'プレイヤー追加' }));
    fireEvent.change(screen.getByLabelText('プレイヤー 3', { exact: true }), { target: { value: '追加' } });
    fireEvent.click(screen.getByRole('button', { name: 'プレイヤー 3を上へ' }));
    fireEvent.click(screen.getByLabelText('10 DICE'));
    fireEvent.click(screen.getByLabelText('丁寧'));
    first.unmount();

    render(<App recovery={new SessionRecovery(() => storage)} />);
    expect((screen.getByLabelText('プレイヤー 1', { exact: true }) as HTMLInputElement).value).toBe('編集中');
    expect(screen.getAllByRole('textbox').map((input) => (input as HTMLInputElement).value)).toEqual(['編集中', '追加', '']);
    expect((screen.getByLabelText('10 DICE') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText('丁寧') as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText('ゲームを復旧しました。')).toBeTruthy();
    expect(screen.queryByText(/ゲームデータを復旧できませんでした/)).toBeNull();
  });

  it('restores a replay reorder without exposing forbidden edits and starts explicitly', () => {
    const storage = new MemoryStorage();
    const random = new Sequence([...normal(1, 1, 1, 1, 1, 1, 1), ...Array<number>(7).fill(0), ...Array<number>(7).fill(0)]);
    let state = perform(initialFlow(), { type: 'start', setup }, random);
    for (const type of ['roll', 'next', 'roll', 'ranking', 'reveal', 'penalty', 'rollPenalty', 'finish', 'replay'] as const) {
      state = perform(state, { type }, random);
    }
    new SessionRecovery(() => storage).saveGame(state);
    const first = render(<App recovery={new SessionRecovery(() => storage)} />);
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('radio')).toBeNull();
    expect(screen.getByText('7 DICE')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '2番 Bを上へ' }));
    first.unmount();

    render(<App recovery={new SessionRecovery(() => storage)} />);
    expect(screen.getAllByRole('listitem').map((item) => item.textContent?.replace(/[↑↓]/g, ''))).toEqual(['1B', '2A']);
    fireEvent.click(screen.getByRole('button', { name: 'この順番で開始' })); paint();
    expect(screen.getByRole('heading', { name: '現在プレイヤー：B' })).toBeTruthy();
  });

  it('persists full reset defaults across reload while preserving Sound OFF', () => {
    const storage = new MemoryStorage();
    const first = render(<App recovery={new SessionRecovery(() => storage)} />);
    fireEvent.click(screen.getByRole('button', { name: 'サウンド ON' }));
    fireEvent.click(screen.getByRole('button', { name: 'プレイヤー追加' }));
    fireEvent.click(screen.getByLabelText('10 DICE'));
    fireEvent.click(screen.getByLabelText('乱暴'));
    fireEvent.click(screen.getByRole('button', { name: 'すべて初期状態に戻す' }));
    fireEvent.click(screen.getByRole('button', { name: '初期状態に戻す' })); paint();
    first.unmount();

    render(<App recovery={new SessionRecovery(() => storage)} />);
    expect(screen.getAllByRole('textbox')).toHaveLength(2);
    expect(screen.getAllByRole('textbox').map((input) => (input as HTMLInputElement).value)).toEqual(['', '']);
    expect((screen.getByLabelText('7 DICE') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText('普通') as HTMLInputElement).checked).toBe(true);
    expect(screen.getByRole('button', { name: 'サウンド OFF' })).toBeTruthy();
  });

  it('shows a committed animation-time roll immediately after reload without consuming RandomSource', () => {
    const storage = new MemoryStorage();
    const first = createGameStore(new Sequence(normal(1, 2, 2, 2, 2, 2, 2)), new SessionRecovery(() => storage));
    first.dispatch(0, { type: 'start', setup }); first.presented(1); first.dispatch(1, { type: 'roll' });
    expect(first.getSnapshot().busy).toBe(true);

    const random = new Sequence([]);
    render(<App random={random} recovery={new SessionRecovery(() => storage)} />);
    expect(screen.getByText('ゲームを復旧しました。')).toBeTruthy();
    expect(screen.getByText('今回の獲得：100点')).toBeTruthy();
    expect(screen.getByText('現在ROLL可能：6個')).toBeTruthy();
    expect((screen.getByRole('button', { name: '続けてROLL' }) as HTMLButtonElement).disabled).toBe(false);
    expect(random.calls).toBe(0);
  });

  it('persists Sound OFF across a reload independently from game state', () => {
    const storage = new MemoryStorage();
    const first = render(<App recovery={new SessionRecovery(() => storage)} />);
    fireEvent.click(screen.getByRole('button', { name: 'サウンド ON' }));
    expect(screen.getByRole('button', { name: 'サウンド OFF' })).toBeTruthy();
    first.unmount();

    render(<App recovery={new SessionRecovery(() => storage)} />);
    expect(screen.getByRole('button', { name: 'サウンド OFF' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('warns non-modally and remains playable when storage access fails', () => {
    const random = new Sequence(Array<number>(7).fill(0));
    render(<App random={random} recovery={new SessionRecovery(() => { throw new Error('blocked'); })} />);
    expect(screen.getByText(/一時保存を利用できません/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('プレイヤー 1', { exact: true }), { target: { value: 'A' } });
    fireEvent.change(screen.getByLabelText('プレイヤー 2', { exact: true }), { target: { value: 'B' } });
    fireEvent.click(screen.getByRole('button', { name: 'ゲーム開始' })); paint();
    fireEvent.click(screen.getByRole('button', { name: 'ROLL' })); paint();
    expect(screen.getByText('TURN END · ターン終了')).toBeTruthy();
    expect(random.calls).toBe(7);
  });

  it('reports corrupt data consistently through a StrictMode remount', () => {
    const storage = new MemoryStorage();
    storage.values.set('ichi-go:game', '{broken');
    const recovery = new SessionRecovery(() => storage);
    render(<StrictMode><App recovery={recovery} /></StrictMode>);
    expect(screen.getByText(/ゲームデータを復旧できませんでした/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'ゲーム開始' })).toBeTruthy();
  });

  it('does not change the recovery checkpoint when leaving is cancelled', () => {
    const storage = new MemoryStorage();
    const recovery = new SessionRecovery(() => storage);
    const seed = createGameStore(new Sequence([]), recovery);
    seed.dispatch(0, { type: 'start', setup });
    const before = storage.values.get('ichi-go:game');
    render(<App recovery={new SessionRecovery(() => storage)} />);
    fireEvent.click(screen.getByRole('button', { name: 'ゲームを終了する' }));
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }));
    expect(storage.values.get('ichi-go:game')).toBe(before);
    expect(screen.getByRole('heading', { name: '現在プレイヤー：A' })).toBeTruthy();
  });
});
