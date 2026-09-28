// @vitest-environment jsdom
import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/app/App';
import { DicePresentation } from '../../src/app/DicePresentation';
import { createGameStore } from '../../src/app/gameStore';
import type { DiceRenderer } from '../../src/dice/types';
import type { RandomSource } from '../../src/game/randomSource';

class Sequence implements RandomSource {
  calls = 0;
  constructor(private readonly values: readonly number[]) {}
  next() { return this.values[this.calls++] ?? 0.9; }
}

const normal = (...faces: number[]) => faces.flatMap((face) => [0.9, (face - 0.5) / 6]);
let frames = new Map<number, FrameRequestCallback>();
let frameId = 0;
function paint() {
  act(() => {
    for (let index = 0; index < 2; index++) {
      const pending = [...frames.values()];
      frames.clear();
      pending.forEach((callback) => callback(performance.now()));
    }
  });
}

beforeEach(() => {
  frames = new Map();
  frameId = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++frameId, callback); return frameId; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function renderer(overrides: Partial<DiceRenderer> = {}): DiceRenderer {
  return {
    initialize: vi.fn(async () => undefined),
    present: vi.fn(async () => undefined),
    clear: vi.fn(),
    dispose: vi.fn(),
    ...overrides,
  };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

describe('3D dice React integration', () => {
  it('does not duplicate renderer initialization in StrictMode', async () => {
    const instance = renderer();
    const factory = vi.fn(async () => instance);
    const onPresented = vi.fn();
    const onReveal = vi.fn();
    render(<StrictMode><DicePresentation dice={[{ status: 'safe', value: 2 }]} kind="normal" revision={7} busy
      onReveal={onReveal} onPresented={onPresented} config={{ createRenderer: factory, prefersReducedMotion: () => false }} /></StrictMode>);
    await waitFor(() => expect(instance.present).toHaveBeenCalledOnce());
    expect(factory).toHaveBeenCalledOnce();
    expect(instance.initialize).toHaveBeenCalledOnce();
    paint();
    expect(onPresented).toHaveBeenCalledWith(7);
  });

  it('ignores an old presentation completion after a newer revision is rendered', async () => {
    const animations = [deferred(), deferred()];
    let index = 0;
    const instance = renderer({ present: vi.fn(() => animations[index++]!.promise) });
    const onReveal = vi.fn();
    const onPresented = vi.fn();
    const config = { createRenderer: async () => instance, prefersReducedMotion: () => false };
    const view = render(<DicePresentation dice={[{ status: 'safe', value: 1 }]} kind="normal" revision={1} busy
      onReveal={onReveal} onPresented={onPresented} config={config} />);
    await waitFor(() => expect(instance.present).toHaveBeenCalledTimes(1));
    view.rerender(<DicePresentation dice={[{ status: 'safe', value: 5 }]} kind="normal" revision={2} busy
      onReveal={onReveal} onPresented={onPresented} config={config} />);
    await waitFor(() => expect(instance.present).toHaveBeenCalledTimes(2));

    await act(async () => { animations[0]!.resolve(); await animations[0]!.promise; });
    expect(onReveal).not.toHaveBeenCalled();
    expect(screen.queryByRole('list', { name: '確定したダイスの出目' })).toBeNull();

    await act(async () => { animations[1]!.resolve(); await animations[1]!.promise; });
    await waitFor(() => expect(onReveal).toHaveBeenCalledWith(2));
    expect(screen.getByText('5')).toBeTruthy();
    expect(screen.queryByText('1')).toBeNull();
  });

  it('falls back with the committed roll and never consumes RandomSource again', async () => {
    const random = new Sequence(normal(1, 2, 3, 4, 5, 6, 2));
    const store = createGameStore(random);
    const failing = renderer({ present: vi.fn(async () => { throw new Error('animation failure'); }) });
    render(<App store={store} dicePresentation={{ createRenderer: async () => failing, prefersReducedMotion: () => false }} />);
    fireEvent.change(screen.getByLabelText('プレイヤー 1', { exact: true }), { target: { value: 'A' } });
    fireEvent.change(screen.getByLabelText('プレイヤー 2', { exact: true }), { target: { value: 'B' } });
    fireEvent.click(screen.getByRole('button', { name: 'ゲーム開始' }));
    paint();
    fireEvent.click(screen.getByRole('button', { name: 'ROLL' }));
    await waitFor(() => expect(screen.getByText('3D表示を完了できないため2D表示')).toBeTruthy());
    expect(random.calls).toBe(14);
    expect(screen.getByRole('list', { name: '確定したダイスの出目' })).toBeTruthy();
    expect(screen.getAllByText('得点・除外')).toHaveLength(2);
    paint();
    expect((screen.getByRole('button', { name: '続けてROLL' }) as HTMLButtonElement).disabled).toBe(false);
    expect(random.calls).toBe(14);
  });

  it('reveals the committed result and unlocks after renderer initialization times out', async () => {
    const random = new Sequence(normal(1, 2, 3, 4, 5, 6, 2));
    const store = createGameStore(random);
    const stalled = renderer({ initialize: vi.fn(() => new Promise<void>(() => undefined)) });
    render(<App store={store} dicePresentation={{
      createRenderer: async () => stalled,
      prefersReducedMotion: () => false,
      timeoutMs: 5,
    }} />);
    fireEvent.change(screen.getByLabelText('プレイヤー 1', { exact: true }), { target: { value: 'A' } });
    fireEvent.change(screen.getByLabelText('プレイヤー 2', { exact: true }), { target: { value: 'B' } });
    fireEvent.click(screen.getByRole('button', { name: 'ゲーム開始' }));
    paint();
    fireEvent.click(screen.getByRole('button', { name: 'ROLL' }));

    await waitFor(() => expect(screen.getByText('3D表示が時間内に完了しないため2D表示')).toBeTruthy());
    expect(screen.getByRole('list', { name: '確定したダイスの出目' })).toBeTruthy();
    expect(random.calls).toBe(14);
    paint();
    expect((screen.getByRole('button', { name: '続けてROLL' }) as HTMLButtonElement).disabled).toBe(false);
    expect(stalled.present).not.toHaveBeenCalled();
    expect(stalled.dispose).toHaveBeenCalledOnce();
  });

  it('reuses one renderer across consecutive ROLL presentations', async () => {
    const random = new Sequence([
      ...normal(1, 2, 2, 2, 2, 2, 2),
      ...normal(2, 2, 2, 2, 2, 2),
    ]);
    const store = createGameStore(random);
    const instance = renderer();
    const factory = vi.fn(async () => instance);
    render(<App store={store} dicePresentation={{ createRenderer: factory, prefersReducedMotion: () => false }} />);
    fireEvent.change(screen.getByLabelText('プレイヤー 1', { exact: true }), { target: { value: 'A' } });
    fireEvent.change(screen.getByLabelText('プレイヤー 2', { exact: true }), { target: { value: 'B' } });
    fireEvent.click(screen.getByRole('button', { name: 'ゲーム開始' }));
    paint();

    fireEvent.click(screen.getByRole('button', { name: 'ROLL' }));
    await waitFor(() => expect(instance.present).toHaveBeenCalledTimes(1));
    paint();
    fireEvent.click(screen.getByRole('button', { name: '続けてROLL' }));
    await waitFor(() => expect(instance.present).toHaveBeenCalledTimes(2));
    paint();

    expect(factory).toHaveBeenCalledOnce();
    expect(instance.initialize).toHaveBeenCalledOnce();
    expect(random.calls).toBe(26);
  });

  it('keeps committed normal and penalty results hidden until each animation completes', async () => {
    const random = new Sequence([
      ...normal(1, 1, 1, 1, 1, 1, 1),
      ...Array<number>(7).fill(0),
      ...[1, 2, 3, 4, 5, 6, 1].map((value) => (value - 0.5) / 6),
    ]);
    const store = createGameStore(random);
    const animations = [deferred(), deferred(), deferred()];
    let animationIndex = 0;
    const instance = renderer({ present: vi.fn(() => animations[animationIndex++]!.promise) });
    render(<App store={store} dicePresentation={{ createRenderer: async () => instance, prefersReducedMotion: () => false }} />);
    fireEvent.change(screen.getByLabelText('プレイヤー 1', { exact: true }), { target: { value: 'A' } });
    fireEvent.change(screen.getByLabelText('プレイヤー 2', { exact: true }), { target: { value: 'B' } });
    fireEvent.click(screen.getByRole('button', { name: 'ゲーム開始' }));
    paint();

    fireEvent.click(screen.getByRole('button', { name: 'ROLL' }));
    await waitFor(() => expect(instance.present).toHaveBeenCalledTimes(1));
    const committed = store.getSnapshot().state;
    expect(committed.phase === 'turn' && committed.turn.player.completed).toBe(true);
    expect(screen.queryByText('COMPLETE!! 完走')).toBeNull();
    expect(screen.queryByText('今回の獲得：700点')).toBeNull();
    expect(screen.queryByRole('list', { name: '確定したダイスの出目' })).toBeNull();
    expect(screen.getByText('現在ROLL可能：7個')).toBeTruthy();
    expect(screen.getByLabelText('現在のプレイヤー状態').textContent).toContain('SCORE0点');
    await act(async () => { animations[0]!.resolve(); await animations[0]!.promise; });
    await waitFor(() => expect(screen.getByText('COMPLETE!! 完走')).toBeTruthy());
    expect(screen.getByRole('list', { name: '確定したダイスの出目' })).toBeTruthy();
    paint();

    fireEvent.click(screen.getByRole('button', { name: '次へ' }));
    paint();
    fireEvent.click(screen.getByRole('button', { name: 'ROLL' }));
    await waitFor(() => expect(instance.present).toHaveBeenCalledTimes(2));
    expect(screen.queryByText('TURN END · ターン終了')).toBeNull();
    expect(screen.queryByText('OUTあり・完走不能。OUTダイスは再ROLLされません。')).toBeNull();
    expect(screen.getByText('現在ROLL可能：7個')).toBeTruthy();
    await act(async () => { animations[1]!.resolve(); await animations[1]!.promise; });
    await waitFor(() => expect(screen.getByText('TURN END · ターン終了')).toBeTruthy());
    expect(screen.getByText('OUTあり・完走不能。OUTダイスは再ROLLされません。')).toBeTruthy();
    paint();

    fireEvent.click(screen.getByRole('button', { name: '結果を見る' }));
    paint();
    fireEvent.click(screen.getByRole('button', { name: '敗者発表' }));
    paint();
    fireEvent.click(screen.getByRole('button', { name: 'ペナルティへ' }));
    paint();
    fireEvent.click(screen.getByRole('button', { name: 'ペナルティROLL' }));
    await waitFor(() => expect(instance.present).toHaveBeenCalledTimes(3));
    expect(screen.queryByText('BASE PENALTY')).toBeNull();
    expect(screen.queryByText('22')).toBeNull();
    expect(screen.queryByRole('list', { name: '確定したダイスの出目' })).toBeNull();
    await act(async () => { animations[2]!.resolve(); await animations[2]!.promise; });
    await waitFor(() => expect(screen.getByText('BASE PENALTY')).toBeTruthy());
    const penaltyMetrics = screen.getByText('BASE PENALTY').closest('dl');
    expect(penaltyMetrics?.textContent).toContain('BASE PENALTY22');
    expect(penaltyMetrics?.textContent).toContain('FINAL PENALTY44pt');
    expect(random.calls).toBe(28);
  });
});
