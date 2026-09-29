// @vitest-environment jsdom
import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/app/App';
import { createGameStore } from '../../src/app/gameStore';
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
