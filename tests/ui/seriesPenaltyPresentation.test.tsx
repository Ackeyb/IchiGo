// @vitest-environment jsdom
import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/app/App';
import { DiceView } from '../../src/app/DiceView';
import { createGameStore } from '../../src/app/gameStore';
import { advanceFlow, initialFlow } from '../../src/game/gameFlow';
import type { FlowAction, FlowState } from '../../src/game/gameFlow';
import { initialSetup } from '../../src/game/setup';
import type { DiceMode, DieResult } from '../../src/game/types';
import type { DicePresentationRequest } from '../../src/dice/types';
import { getDiceGridLayout, getSeriesChunkGridLayout } from '../../src/app/diceLayout';
import { SessionRecovery } from '../../src/storage/sessionRecovery';

const noDraw = { next: (): number => { throw new Error('Unexpected draw'); } };
const quiet = { play: () => undefined, dispose: () => undefined };
const encode = (faces: readonly number[]) => faces.flatMap((face) => face === 0 ? [0] : [0.9, (face - 0.5) / 6]);
function ready(mode: DiceMode = 5, kind: 'regular' | 'allTie' | 'zero' | 'zeroTie' = 'regular', games: 2 | 5 = 5): FlowState {
  let state: FlowState = initialFlow();
  const apply = (action: FlowAction, faces?: readonly number[]) => {
    const draws = faces ? encode(faces) : [];
    state = advanceFlow(state, state.revision, action, faces ? { next: () => draws.shift()! } : noDraw);
  };
  apply({ type: 'start', setup: { ...initialSetup(), diceMode: mode, mode: { type: 'series', gameCount: games }, rollLimit: 1,
    participants: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }] } });
  for (let game = 1; game <= games; game++) {
    apply({ type: 'roll' }, kind === 'zero' || kind === 'zeroTie' ? Array<number>(mode).fill(kind === 'zeroTie' ? 5 : 1)
      : kind === 'regular' && mode === 5 && game === 1 ? [5, 2, 2, 2, 2] : Array<number>(mode).fill(2));
    apply({ type: 'next' });
    apply({ type: 'roll' }, Array<number>(mode).fill(kind === 'zero' || kind === 'zeroTie' ? 5 : kind === 'allTie' || game > 3 ? 2 : 1));
    apply({ type: 'ranking' });
    if (game < games) apply({ type: 'nextSeriesGame', currentGameNumber: game });
  }
  apply({ type: 'penalty' });
  return state;
}
function restored(state: FlowState, random = noDraw) {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  const recovery = new SessionRecovery(() => storage); recovery.saveGame(state);
  const store = createGameStore(random, recovery);
  expect(store.getSnapshot().state).toEqual(state);
  return store;
}
let frames = new Map<number, FrameRequestCallback>();
let frame = 0;
beforeEach(() => {
  vi.useFakeTimers(); frames = new Map(); frame = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++frame, callback); return frame; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(() => undefined);
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
});
afterEach(() => { cleanup(); vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function flush() { await act(async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); }); }
function paint() { act(() => { for (let i = 0; i < 2; i++) { const pending = [...frames.values()]; frames.clear(); pending.forEach((callback) => callback(0)); } }); }
async function tick(ms: number) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }
function harness(state = ready(), faces: readonly number[] = Array<number>(70).fill(2), fail = false, reduced = false, stepMs = 0) {
  const draws = encode(faces);
  const random = { next: vi.fn(() => { if (!draws.length) throw new Error('Missing draw'); return draws.shift()!; }) };
  const store = restored(state, random);
  const requests: DicePresentationRequest[] = [];
  const finishes: (() => void)[] = [];
  const renderer = { initialize: vi.fn(async () => undefined), clear: vi.fn(), dispose: vi.fn(),
    present: vi.fn((request: DicePresentationRequest) => { requests.push(request); return fail ? Promise.reject(new Error('GPU failure')) : new Promise<void>((resolve) => finishes.push(resolve)); }) };
  const factory = vi.fn(async () => renderer);
  render(<StrictMode><App store={store} soundPlayer={quiet} dicePresentation={{ createRenderer: factory, prefersReducedMotion: () => reduced, resultStepMs: stepMs, timeoutMs: 60000 }} /></StrictMode>);
  return { store, random, requests, finishes, renderer, factory };
}
function entry(store: ReturnType<typeof createGameStore>) {
  const state = store.getSnapshot().state;
  if (state.phase !== 'seriesPenalty') throw new Error('Expected Series Penalty');
  return state.seriesPenalty.entries[state.seriesPenalty.currentLoserIndex]!;
}

describe('Series chunk layout context', () => {
  it.each([1, 5, 6, 7, 8, 9, 10])('renders %s current dice independently of original Mode 5', (count) => {
    const dice: DieResult[] = Array.from({ length: count }, () => ({ status: 'safe', value: 5 }));
    render(<DiceView dice={dice} diceMode={5} kind="penalty" seriesChunk />);
    expect(screen.getByRole('list').getAttribute('data-rows')).toBe(count > 5 ? `5,${count - 5}` : String(count));
    expect(screen.queryByText('GET')).toBeNull(); expect(screen.queryByText('SAFE')).toBeNull();
  });
  it('rejects 11 chunk dice and preserves original layout validation', () => {
    expect(() => getSeriesChunkGridLayout(11)).toThrow();
    expect(() => getDiceGridLayout(5, 10)).toThrow();
    expect(getDiceGridLayout(14, 10).rows).toEqual([7, 3]);
    expect(getDiceGridLayout(10, 10).rows).toEqual([5, 5]);
  });
});

describe('production Series Penalty presentation and auto plumbing', () => {
  it('runs 24 dice as 10,10,4 only after each reveal/paint and fresh 1500ms', async () => {
    const h = harness(ready(), [6, 5, 4, 3, 3, 2, 2, 2, 2, 2, 6, 4, 3, 3, 2, 2, 2, 2, 2, 2, 6, 4, 3, 2]);
    const button = screen.getByRole('button', { name: 'ペナルティROLL' });
    fireEvent.click(button); fireEvent.click(button); await flush();
    expect(h.requests.map((request) => request.dice.length)).toEqual([10]);
    expect(entry(h.store).committedChunks).toHaveLength(1);
    expect(h.random.next).toHaveBeenCalledTimes(20);
    await tick(10000); expect(entry(h.store).committedChunks).toHaveLength(1);
    await act(async () => h.finishes.shift()!()); await flush();
    expect(screen.getByRole('list').getAttribute('data-rows')).toBe('5,5');
    expect(screen.queryByText('FINAL')).toBeNull();
    await tick(10000); expect(entry(h.store).committedChunks).toHaveLength(1);
    paint(); await tick(1499); expect(entry(h.store).committedChunks).toHaveLength(1);
    await tick(1); await flush();
    expect(h.requests.map((request) => request.dice.length)).toEqual([10, 10]);
    await act(async () => h.finishes.shift()!()); await flush(); paint();
    await tick(1500); await flush(); expect(h.requests.map((request) => request.dice.length)).toEqual([10, 10, 4]);
    await act(async () => h.finishes.shift()!()); await flush(); paint();
    expect(entry(h.store).status).toBe('resolved');
    expect(entry(h.store).basePenalty).toBe(74);
    expect(screen.getAllByText('FINAL').length).toBeGreaterThan(0);
    expect(screen.getByText('296 pt')).toBeTruthy();
    await tick(10000); expect(h.random.next).toHaveBeenCalledTimes(48);
    fireEvent.click(screen.getByRole('button', { name: '最終結果を見る' })); paint();
    expect(screen.getByRole('heading', { name: '連続試合 FINAL RESULT' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '同じメンバーでもう一度' })).toBeTruthy();
  });
  it.each([5, 7, 14] as const)('keeps original Mode %s while rendering only ten-die chunks', async (mode) => {
    const h = harness(ready(mode)); fireEvent.click(screen.getByRole('button', { name: 'ペナルティROLL' })); await flush();
    expect(h.requests[0]!.dice).toHaveLength(10);
    const state = h.store.getSnapshot().state;
    expect(state.phase === 'seriesPenalty' && state.game.diceMode).toBe(mode);
    await act(async () => h.finishes.shift()!()); await flush(); paint();
    expect(screen.getByRole('list').getAttribute('data-rows')).toBe('5,5');
  });
  it('falls back with the same ordered OUT chunk and no extra draw', async () => {
    const h = harness(ready(), [0, 2, 5, 0, 1, 2, 3, 4, 5, 6, ...Array<number>(14).fill(2)], true);
    fireEvent.click(screen.getByRole('button', { name: 'ペナルティROLL' })); await flush(); paint();
    expect(h.requests[0]!.dice).toBe(entry(h.store).committedChunks[0]);
    expect(h.requests[0]!.dice[0]).toEqual({ status: 'out', value: null });
    expect(document.querySelector('.penalty-dice-expression')?.textContent).toBe('OUT(6) + 2 + 5 + OUT(6) + 1 + 2 + 3 + 4 + 5 + 6 = 40');
    expect(screen.getAllByLabelText('OUT')).toHaveLength(2);
    expect(h.random.next).toHaveBeenCalledTimes(18);
    await tick(1500); await flush(); paint();
    expect(entry(h.store).committedChunks).toHaveLength(2);
    expect(h.requests).toHaveLength(1); // Failed renderer remains unavailable; same committed dice use 2D.
  });
  it('restores a running chunk without reroll/animation and waits for paint plus fresh 1500ms', async () => {
    const pending = ready();
    if (pending.phase !== 'seriesPenalty') throw new Error('Penalty expected');
    const state = advanceFlow(pending, pending.revision, { type: 'startSeriesPenalty', penaltyId: pending.seriesPenalty.penaltyId, playerId: 'a', chunkIndex: 0 }, { next: () => 0.9 });
    const h = harness(state);
    expect(screen.getByRole('list').children).toHaveLength(10);
    expect(h.factory).not.toHaveBeenCalled(); expect(h.random.next).not.toHaveBeenCalled();
    await tick(10000); expect(entry(h.store).committedChunks).toHaveLength(1);
    paint(); await tick(1499); expect(h.random.next).not.toHaveBeenCalled();
    await tick(1); await flush(); expect(entry(h.store).committedChunks).toHaveLength(2);
    expect(h.requests[0]!.dice).toHaveLength(10);
  });
  it.each(['cancel', 'accept'] as const)('pauses the actual UI sequence for blocking confirmation %s', async (choice) => {
    const h = harness(); fireEvent.click(screen.getByRole('button', { name: 'ペナルティROLL' })); await flush();
    await act(async () => h.finishes.shift()!()); await flush(); paint(); await tick(1000);
    fireEvent.click(screen.getByRole('button', { name: 'ゲームを終了する' })); await tick(5000);
    expect(h.random.next).toHaveBeenCalledTimes(20);
    fireEvent.click(screen.getByRole('button', { name: choice === 'cancel' ? 'キャンセル' : '確認して進む' }));
    if (choice === 'cancel') {
      await tick(1499); expect(h.random.next).toHaveBeenCalledTimes(20);
      await tick(1); await flush(); expect(h.random.next).toHaveBeenCalledTimes(40);
    } else { await tick(10000); expect(h.store.getSnapshot().state.phase).toBe('setup'); expect(h.random.next).toHaveBeenCalledTimes(20); }
  });
  it('keeps zero-dice losers visible without renderer, ROLL, or timer', async () => {
    const h = harness(ready(5, 'zero'));
    expect(screen.getByRole('heading', { name: 'ペナルティ：B' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'ペナルティROLL' })).toBeNull();
    expect(screen.queryByRole('list')).toBeNull();
    expect(screen.getByText('ROLL不要', { exact: false })).toBeTruthy();
    expect(screen.getByText('FINAL')).toBeTruthy();
    expect(screen.getAllByText('0').length).toBeGreaterThan(0);
    paint(); await tick(10000);
    expect(h.factory).not.toHaveBeenCalled(); expect(h.random.next).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('resolves a single chunk once and restores its FINAL without renderer or timer', async () => {
    const h = harness(ready(5, 'regular', 2));
    fireEvent.click(screen.getByRole('button', { name: 'ペナルティROLL' })); await flush();
    expect(h.requests[0]!.dice).toHaveLength(9);
    await act(async () => h.finishes.shift()!()); await flush(); paint();
    expect(entry(h.store).status).toBe('resolved');
    await tick(10000); expect(h.random.next).toHaveBeenCalledTimes(18);
    const saved = h.store.getSnapshot().state;
    cleanup(); const restored = harness(saved);
    expect(screen.getByText('54 pt')).toBeTruthy();
    paint(); await tick(10000);
    expect(restored.factory).not.toHaveBeenCalled(); expect(restored.random.next).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('reveals BASE, accumulated BASE, then FINAL before paint acknowledgment', async () => {
    const h = harness(ready(5, 'regular', 2), Array<number>(9).fill(2), false, false, 180);
    fireEvent.click(screen.getByRole('button', { name: 'ペナルティROLL' })); await flush();
    await act(async () => h.finishes.shift()!()); await flush();
    expect(screen.queryByText('CHUNK BASE')).toBeNull(); expect(screen.queryByText('FINAL')).toBeNull();
    await tick(180); expect(screen.getByText('CHUNK BASE')).toBeTruthy(); expect(screen.queryByText('54 pt')).toBeNull();
    await tick(180); expect(document.querySelector('.penalty-equation')?.textContent).toContain('TOTAL BASE18');
    expect(screen.queryByText('54 pt')).toBeNull();
    await tick(180); expect(screen.getByText('54 pt')).toBeTruthy();
    expect(h.store.getSnapshot().busy).toBe(true);
    await tick(180); expect(h.store.getSnapshot().busy).toBe(true);
    paint(); expect(h.store.getSnapshot().busy).toBe(false);
  });
  it('advances from a zero-dice loser only by the explicit next-loser action', async () => {
    const h = harness(ready(5, 'zeroTie'));
    expect(screen.getByRole('heading', { name: 'ペナルティ：A' })).toBeTruthy();
    await tick(10000); expect(entry(h.store).playerId).toBe('a');
    fireEvent.click(screen.getByRole('button', { name: '次の敗者へ' })); paint();
    expect(screen.getByRole('heading', { name: 'ペナルティ：B' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'ペナルティROLL' })).toBeNull();
    expect(screen.getByRole('button', { name: '最終結果を見る' })).toBeTruthy();
    expect(h.random.next).not.toHaveBeenCalled(); expect(h.factory).not.toHaveBeenCalled();
  });
  it('caps every presentation of the 70-dice boundary at ten dice', async () => {
    const h = harness(ready(14));
    fireEvent.click(screen.getByRole('button', { name: 'ペナルティROLL' })); await flush();
    for (let i = 0; i < 7; i++) {
      expect(h.requests[i]!.dice).toHaveLength(10);
      await act(async () => h.finishes.shift()!()); await flush(); paint();
      if (i < 6) { await tick(1500); await flush(); }
    }
    expect(entry(h.store).status).toBe('resolved');
    expect(h.requests).toHaveLength(7); expect(h.random.next).toHaveBeenCalledTimes(140);
  });
  it('requires a new first tap for each loser and keeps previous results', async () => {
    const h = harness(ready(5, 'allTie'), Array<number>(100).fill(2), false, true);
    fireEvent.click(screen.getByRole('button', { name: 'ペナルティROLL' })); await flush(); paint();
    await tick(1500); await flush(); paint(); await tick(1500); await flush(); paint();
    expect(entry(h.store).status).toBe('resolved');
    await tick(10000); expect(h.random.next).toHaveBeenCalledTimes(50);
    fireEvent.click(screen.getByRole('button', { name: '次の敗者へ' })); paint();
    expect(screen.getByRole('heading', { name: 'ペナルティ：B' })).toBeTruthy();
    expect(entry(h.store).status).toBe('pending');
    await tick(10000); expect(h.random.next).toHaveBeenCalledTimes(50);
    const state = h.store.getSnapshot().state;
    expect(state.phase === 'seriesPenalty' && state.seriesPenalty.entries[0]!.basePenalty).toBe(50);
    expect(screen.getByRole('button', { name: 'ペナルティROLL' }).hasAttribute('disabled')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'ペナルティROLL' })); await flush(); paint();
    const saved = h.store.getSnapshot().state;
    cleanup(); const resumed = harness(saved);
    expect(screen.getByRole('heading', { name: 'ペナルティ：B' })).toBeTruthy();
    expect(entry(resumed.store).basePenalty).toBe(20);
    expect(resumed.random.next).not.toHaveBeenCalled();
    paint(); await tick(1499); expect(resumed.random.next).not.toHaveBeenCalled();
    await tick(1); await flush(); expect(entry(resumed.store).committedChunks).toHaveLength(2);
    const restoredState = resumed.store.getSnapshot().state;
    expect(restoredState.phase === 'seriesPenalty' && restoredState.seriesPenalty.entries[0]!.basePenalty).toBe(50);
  });
});
