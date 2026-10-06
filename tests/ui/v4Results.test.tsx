// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/app/App';
import { createGameStore } from '../../src/app/gameStore';
import { advanceFlow, initialFlow } from '../../src/game/gameFlow';
import type { FlowAction, FlowState } from '../../src/game/gameFlow';
import { initialSetup } from '../../src/game/setup';
import type { GameMode, RollLimit } from '../../src/game/types';
import { SessionRecovery } from '../../src/storage/sessionRecovery';

const noDraw = { next: (): number => { throw new Error('Unexpected draw'); } };
const quiet = { play: () => undefined, dispose: () => undefined };
const encode = (faces: readonly number[]) => faces.flatMap((face) => [0.9, (face - 0.5) / 6]);
const step = (state: FlowState, action: FlowAction) => advanceFlow(state, state.revision, action, noDraw);
function ready(mode: GameMode, limit: RollLimit = null, count = 2): FlowState {
  const configuration = mode.type === 'completionTarget' ? { mode, rollLimit: null } : { mode, rollLimit: limit };
  return step(initialFlow(), { type: 'start', setup: { ...initialSetup(), ...configuration, diceMode: 5,
    participants: Array.from({ length: count }, (_, i) => ({ id: `p${i}`, name: `名前${i}` })) } });
}
function roll(state: FlowState, faces: readonly number[]) {
  const draws = encode(faces);
  return advanceFlow(state, state.revision, { type: 'roll' }, { next: () => draws.shift()! });
}
function endGame(state: FlowState, faces: readonly (readonly number[])[]) {
  for (let i = 0; i < faces.length; i++) {
    state = roll(state, faces[i]!);
    if (i < faces.length - 1) state = step(state, { type: 'next' });
  }
  return step(state, { type: 'ranking' });
}
function recovered(state: FlowState, random = noDraw) {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  const recovery = new SessionRecovery(() => storage);
  recovery.saveGame(state);
  const store = createGameStore(random, recovery);
  expect(store.getSnapshot().state).toEqual(state);
  return store;
}
let frames: FrameRequestCallback[] = [];
beforeEach(() => {
  frames = [];
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.push(callback); return frames.length; });
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function paint() { act(() => { for (let i = 0; i < 2; i++) { const pending = frames; frames = []; pending.forEach((cb) => cb(0)); } }); }
const show = (state: FlowState) => render(<App store={recovered(state)} soundPlayer={quiet} />);

describe('v4 Play progress', () => {
  it('shows initial Completion Target progress in the existing PLAYER row', () => {
    const view = show(ready({ type: 'completionTarget', targetCompletions: 5 }));
    expect(screen.getByText('完走 0 / 5').closest('.player-roll-line')?.textContent).toContain('PLAYER 1 / 2');
    expect(view.container.querySelector('.roll-counter')).toBeNull();
    expect(view.container.querySelector('.turn-action-slot')).toBeTruthy();
  });
  it('keeps committed completion hidden until the dice reveal', async () => {
    let finish: (() => void) | undefined;
    const draws = encode([1, 1, 1, 1, 1]);
    const store = recovered(ready({ type: 'completionTarget', targetCompletions: 1 }), { next: () => draws.shift()! });
    const renderer = { initialize: async () => undefined, present: () => new Promise<void>((resolve) => { finish = resolve; }), clear: () => undefined, dispose: () => undefined };
    render(<App store={store} soundPlayer={quiet} dicePresentation={{ createRenderer: async () => renderer, prefersReducedMotion: () => false, resultStepMs: 0 }} />);
    fireEvent.click(screen.getByRole('button', { name: 'ROLL' }));
    await waitFor(() => expect(finish).toBeTypeOf('function'));
    const committed = store.getSnapshot().state;
    expect(committed.phase === 'turn' && committed.game.totalCompletionCount).toBe(1);
    expect(screen.getByText('完走 0 / 1')).toBeTruthy();
    await act(async () => { finish!(); await Promise.resolve(); });
    paint();
    expect(screen.getByText('完走 1 / 1')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '次へ' }));
    paint();
    expect(screen.getByRole('button', { name: 'ROLL' })).toBeTruthy();
    expect(screen.queryByText('FINAL RANKING')).toBeNull();
  });
  it('restores an unclamped overshoot during the same Round', () => {
    let state = ready({ type: 'completionTarget', targetCompletions: 3 }, null, 5);
    for (let i = 0; i < 4; i++) { state = roll(state, [1, 1, 1, 1, 1]); state = step(state, { type: 'next' }); }
    show(state);
    expect(screen.getByText('完走 4 / 3')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'ROLL' })).toBeTruthy();
  });
  it('shows repeated completion by the same player in a later Round', () => {
    let state = endGame(ready({ type: 'completionTarget', targetCompletions: 5 }), [[1, 1, 1, 1, 1], [2, 2, 2, 2, 2]]);
    state = step(state, { type: 'startSuddenDeath' });
    show(roll(state, [1, 1, 1, 1, 1]));
    expect(screen.getByText('完走 2 / 5')).toBeTruthy();
  });
  it.each([null, 3] as const)('shows Series progress with limit %s without changing the Action structure', (limit) => {
    const view = show(ready({ type: 'series', gameCount: 2 }, limit));
    expect(screen.getByText('試合 1 / 2')).toBeTruthy();
    expect(!!view.container.querySelector('.roll-counter')).toBe(limit !== null);
    const play = view.container.querySelector('.play')!;
    expect(Array.from(play.children).map((node) => node.className)).toEqual(['eyebrow player-roll-line', 'current-player', 'dice-field', 'metrics', 'turn-message', 'turn-action-slot']);
    expect(view.container.querySelector('.mode-progress')?.closest('.player-roll-line')).toBeTruthy();
    expect(screen.queryByText(/完走 \d+ \/ /)).toBeNull();
  });
  it('adds no mode progress to Normal', () => {
    const view = show(ready({ type: 'normal' }, 3));
    expect(view.container.querySelector('.mode-progress')).toBeNull();
    expect(screen.getByText('ROLL 1/3')).toBeTruthy();
  });
  it('restores Series Game 2 / 5 without changing the finite roll ordinal', () => {
    let state = endGame(ready({ type: 'series', gameCount: 5 }, 3), [[2, 2, 2, 2, 2], [2, 2, 2, 2, 2]]);
    state = step(state, { type: 'nextSeriesGame', currentGameNumber: 1 });
    show(state);
    expect(screen.getByText('試合 2 / 5')).toBeTruthy();
    expect(screen.getByText('ROLL 1/3')).toBeTruthy();
  });
  it('retains the last Series roll presentation before explicit Intermediate entry', async () => {
    let state = roll(ready({ type: 'series', gameCount: 2 }, 1), [2, 2, 2, 2, 2]);
    state = step(state, { type: 'next' });
    const draws = encode([1, 2, 2, 2, 2]);
    const store = recovered(state, { next: () => draws.shift()! });
    let finish: (() => void) | undefined;
    const renderer = { initialize: async () => undefined, present: () => new Promise<void>((resolve) => { finish = resolve; }), clear: () => undefined, dispose: () => undefined };
    render(<App store={store} soundPlayer={quiet} dicePresentation={{ createRenderer: async () => renderer, prefersReducedMotion: () => false, resultStepMs: 0 }} />);
    fireEvent.click(screen.getByRole('button', { name: 'ROLL' }));
    await waitFor(() => expect(finish).toBeTypeOf('function'));
    expect(screen.getByText('ROLL 1/1')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: '試合 1 / 2 終了' })).toBeNull();
    await act(async () => { finish!(); await Promise.resolve(); });
    expect(screen.getByRole('button', { name: '結果を見る' }).hasAttribute('disabled')).toBe(true);
    paint();
    fireEvent.click(screen.getByRole('button', { name: '結果を見る' })); paint();
    expect(screen.getByRole('heading', { name: '試合 1 / 2 終了' })).toBeTruthy();
  });
});

describe('Series results and explicit actions', () => {
  const intermediate = () => endGame(ready({ type: 'series', gameCount: 3 }, 1), [[2, 2, 2, 2, 2], [1, 2, 2, 2, 2]]);
  it('restores Intermediate cumulative data in original order with no final outcome', () => {
    show(intermediate());
    expect(screen.getByRole('heading', { name: '試合 1 / 3 終了' })).toBeTruthy();
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows.map((row) => row.textContent)).toEqual(['名前00点5個', '名前1100点4個']);
    expect(screen.getByRole('button', { name: '次の試合へ' }).hasAttribute('disabled')).toBe(false);
    for (const text of ['敗者', 'SUDDEN DEATH', '最終順位', 'ペナルティへ']) expect(screen.queryByText(text)).toBeNull();
  });
  it('advances exactly one game on explicit action, preserving cumulative data and resetting the turn', () => {
    const initial = intermediate();
    if (initial.phase !== 'seriesIntermediate') throw new Error('Expected Intermediate');
    const store = recovered(initial);
    render(<App store={store} soundPlayer={quiet} />);
    const next = screen.getByRole('button', { name: '次の試合へ' });
    fireEvent.click(next); fireEvent.click(next); paint();
    expect(screen.getByText('試合 2 / 3')).toBeTruthy();
    expect(screen.getByText('ROLL 1/1')).toBeTruthy();
    const state = store.getSnapshot().state;
    expect(state.phase).toBe('turn');
    if (state.phase !== 'turn') throw new Error('Expected turn');
    expect(state.game.currentPlayerIndex).toBe(0);
    expect(state.turn.nextRollNumber).toBe(1);
    expect(state.turn.player.score).toBe(0);
    expect('cumulative' in state.game && state.game.cumulative).toEqual(initial.game.cumulative);
  });
  function final(faces: readonly (readonly number[])[]) {
    let state = endGame(ready({ type: 'series', gameCount: 2 }, 1, faces.length), faces);
    state = step(state, { type: 'nextSeriesGame', currentGameNumber: 1 });
    return endGame(state, faces);
  }
  it('renders committed competition ranking, without Complete priority styling', () => {
    const state = final([[1, 1, 1, 1, 1], [5, 5, 5, 5, 5], [5, 5, 5, 5, 5], [2, 2, 2, 2, 2]]);
    const view = show(state);
    expect(screen.getAllByRole('row').slice(1).map((row) => row.textContent)).toEqual(['1位名前01000点0個', '2位名前1500点0個', '2位名前2500点0個', '4位名前3敗者0点10個']);
    expect(view.container.querySelector('.complete')).toBeNull();
    expect(screen.queryByText(/サドンデスへ/)).toBeNull();
  });
  it('displays the domain remaining-dice tiebreak and order', () => {
    show(final([[1, 5, 2, 2, 2], [5, 5, 5, 2, 2]]));
    expect(screen.getAllByRole('row').slice(1).map((row) => row.textContent)).toEqual(['1位名前1300点4個', '2位名前0敗者300点6個']);
  });
  it.each([
    { faces: [[1, 1, 1, 1, 1], [2, 2, 2, 2, 2], [2, 2, 2, 2, 2]] },
    { faces: [[2, 2, 2, 2, 2], [2, 2, 2, 2, 2]] },
    { faces: [[1, 1, 1, 1, 1], [5, 5, 5, 5, 5]] },
  ])('keeps every committed loser, including all ties and zero-dice losers, at Penalty Ready', ({ faces }) => {
    const state = final(faces);
    if (state.phase !== 'seriesRanking') throw new Error('Expected final ranking');
    const store = recovered(state);
    render(<App store={store} soundPlayer={quiet} />);
    expect(screen.getAllByText('敗者')).toHaveLength(state.ranking.loserIds.length);
    fireEvent.click(screen.getByRole('button', { name: 'ペナルティへ' })); paint();
    expect(screen.getByRole('heading', { name: '連続試合 ペナルティ準備' })).toBeTruthy();
    const list = screen.getByRole('list');
    expect(within(list).getAllByRole('listitem').map((item) => item.textContent)).toEqual(state.ranking.loserIds.map((id) => state.game.participants.find((p) => p.id === id)!.name));
    const saved = store.getSnapshot().state;
    expect(saved.phase).toBe('seriesPenalty');
    expect(screen.queryByRole('button', { name: /ROLL/ })).toBeNull();
    cleanup(); show(saved);
    expect(screen.getByRole('heading', { name: '連続試合 ペナルティ準備' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /ROLL/ })).toBeNull();
  });
});
