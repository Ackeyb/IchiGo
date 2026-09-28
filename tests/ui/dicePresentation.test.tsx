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

describe('3D dice React integration', () => {
  it('does not duplicate renderer initialization in StrictMode', async () => {
    const instance = renderer();
    const factory = vi.fn(async () => instance);
    const onPresented = vi.fn();
    render(<StrictMode><DicePresentation dice={[{ status: 'safe', value: 2 }]} kind="normal" revision={7} busy
      onPresented={onPresented} config={{ createRenderer: factory, prefersReducedMotion: () => false }} /></StrictMode>);
    await waitFor(() => expect(instance.present).toHaveBeenCalledOnce());
    expect(factory).toHaveBeenCalledOnce();
    expect(instance.initialize).toHaveBeenCalledOnce();
    paint();
    expect(onPresented).toHaveBeenCalledWith(7);
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
});
