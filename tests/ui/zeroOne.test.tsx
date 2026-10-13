// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/app/App';
import { createGameStore } from '../../src/app/gameStore';
import { initialFlow, advanceFlow } from '../../src/game/gameFlow';
import type { FlowState } from '../../src/game/gameFlow';
import { initialSetup, switchSetupMode } from '../../src/game/setup';
import { RulesScreen } from '../../src/app/RulesScreen';
import { SessionRecovery, SESSION_GAME_KEY } from '../../src/storage/sessionRecovery';

const quiet = { play: () => undefined, dispose: () => undefined };
const noDraw = { next: (): number => { throw Error('Unexpected draw'); } };
const setup = { ...switchSetupMode(initialSetup(), 'zeroOne'), mode: { type: 'zeroOne' as const, preset: 350 as const }, diceMode: 5 as const, rollLimit: null,
  participants: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }] };
const ready = () => advanceFlow(initialFlow(), 0, { type: 'start', setup }, noDraw);
const encode = (faces: readonly number[]) => faces.flatMap((n) => n === 0 ? [0] : [0.9, (n - 0.5) / 6]);
function storeFor(state: FlowState, faces: readonly number[]) {
  const draws = encode(faces);
  const storage = new Map([[SESSION_GAME_KEY, JSON.stringify({ version: 6, state })]]);
  const recovery = new SessionRecovery(() => ({ getItem: (k) => storage.get(k) ?? null,
    setItem: (k, v) => { storage.set(k, v); }, removeItem: (k) => { storage.delete(k); } }));
  return createGameStore({ next: () => { const value = draws.shift(); if (value === undefined) throw Error('Unexpected draw'); return value; } }, recovery);
}
let frames = new Map<number, FrameRequestCallback>(); let id = 0;
beforeEach(() => {
  frames = new Map(); id = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++id, callback); return id; });
  vi.stubGlobal('cancelAnimationFrame', (key: number) => frames.delete(key));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function paint() { act(() => { for (let i = 0; i < 2; i++) { const pending = [...frames.values()]; frames.clear(); pending.forEach((cb) => cb(0)); } }); }

describe('Zero-One Setup, staged Play and rules', () => {
  it('shows presets / throw only, resets on mode return and retains Rule Page draft', () => {
    const store = createGameStore(noDraw);
    render(<App store={store} soundPlayer={quiet} />);
    fireEvent.click(screen.getByLabelText('ゼロワン'));
    expect(screen.getByRole('group', { name: 'ゼロワン preset' })).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Dice Mode' })).toBeNull();
    expect(screen.queryByRole('group', { name: 'ROLL上限' })).toBeNull();
    expect(screen.getByRole('group', { name: '投げ方' })).toBeTruthy();
    fireEvent.click(screen.getByLabelText('ゼロワン 1000'));
    const before = store.getSnapshot().state;
    fireEvent.click(screen.getByRole('button', { name: 'ルール説明' }));
    fireEvent.click(screen.getByRole('button', { name: '戻る' }));
    expect(store.getSnapshot().state).toBe(before);
    expect((screen.getByLabelText('ゼロワン 1000') as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByLabelText('ノーマル'));
    fireEvent.click(screen.getByLabelText('ゼロワン'));
    expect((screen.getByLabelText('ゼロワン 500') as HTMLInputElement).checked).toBe(true);
  });
  it.each([
    { faces: [1, 1, 1, 1, 1], outcome: 'BUST', remaining: 350 },
    { faces: [0, 0, 0, 0, 0], outcome: 'SHORT', remaining: 350 },
    { faces: [1, 1, 1, 5, 2], outcome: 'CLEAR', remaining: 0 },
    { faces: [1, 2, 2, 2, 2], outcome: 'TURN END', remaining: 250 },
  ])('presents $outcome with unchanged Action regions and no same-Turn continuation', async ({ faces, outcome, remaining }) => {
    let finish: (() => void) | undefined;
    const store = storeFor(ready(), faces);
    const renderer = { initialize: async () => undefined, present: () => new Promise<void>((resolve) => { finish = resolve; }), clear: () => undefined, dispose: () => undefined };
    const view = render(<App store={store} soundPlayer={quiet} dicePresentation={{ createRenderer: async () => renderer, prefersReducedMotion: () => false, resultStepMs: 0 }} />);
    const play = view.container.querySelector('.play')!;
    const slots = ['.dice-field', '.turn-message', '.turn-action-slot'].map((selector) => play.querySelector(selector));
    fireEvent.click(screen.getByRole('button', { name: 'ROLL' }));
    await waitFor(() => expect(finish).toBeTypeOf('function'));
    expect(store.getSnapshot().busy).toBe(true);
    expect(store.getSnapshot().visibleState).not.toBe(store.getSnapshot().state);
    await act(async () => finish!());
    paint();
    expect(store.getSnapshot().busy).toBe(false);
    expect(view.container.querySelector('.turn-message')!.textContent).toContain(outcome);
    expect(view.container.querySelector('.metrics')!.textContent).toContain(String(remaining));
    expect(screen.queryByRole('button', { name: '続けてROLL' })).toBeNull();
    expect(screen.getByRole('button', { name: '次へ' })).toBeTruthy();
    expect(slots).toEqual(['.dice-field', '.turn-message', '.turn-action-slot'].map((selector) => play.querySelector(selector)));
    fireEvent.click(screen.getByRole('button', { name: '次へ' })); paint();
    expect(view.container.querySelector('.current-player')!.textContent).toContain('B');
    expect(screen.getByRole('button', { name: 'ROLL' })).toBeTruthy();
  });
  it('explains Short, Round-scoped eligibility, Turn ranking and the Turn-difference penalty', () => {
    render(<RulesScreen onBack={() => undefined} />);
    const section = screen.getByRole('heading', { name: 'ゼロワン' }).closest('section')!;
    expect(section.textContent).toContain('1 ROLL = 1 Turn');
    expect(section.textContent).toContain('Short');
    expect(section.textContent).toContain('同Round中は資格が戻りません');
    expect(section.textContent).toContain('Sudden Death開始時');
    expect(section.textContent).toContain('最下位のターン数 - トップのターン数');
    expect(section.textContent).toContain('Clean Clear累積数 + 1');
  });
});
