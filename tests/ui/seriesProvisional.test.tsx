// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/app/App';
import { RankingBoard } from '../../src/app/RankingBoard';
import { createGameStore } from '../../src/app/gameStore';
import { advanceFlow, initialFlow } from '../../src/game/gameFlow';
import type { FlowAction, FlowState } from '../../src/game/gameFlow';
import { initialSetup } from '../../src/game/setup';
import { isSeriesState } from '../../src/game/series';
import type { SeriesState } from '../../src/game/series';
import { calculateSeriesProvisional } from '../../src/game/seriesProvisional';
import { calculateSeriesRanking } from '../../src/game/seriesRanking';
import { SessionRecovery } from '../../src/storage/sessionRecovery';
import type { GameMode } from '../../src/game/types';

const noDraw = { next: (): number => { throw new Error('Unexpected draw'); } };
const quiet = { play: () => undefined, dispose: () => undefined };
const encode = (faces: readonly number[]) => faces.flatMap((face) => face === 0 ? [0] : [0.9, (face - 0.5) / 6]);
const step = (state: FlowState, action: FlowAction) => advanceFlow(state, state.revision, action, noDraw);
function ready(count = 3, mode: GameMode = { type: 'series', gameCount: 2 }): FlowState {
  const configuration = mode.type === 'completionTarget' ? { mode, rollLimit: null } : { mode, rollLimit: 1 as const };
  return step(initialFlow(), { type: 'start', setup: { ...initialSetup(), ...configuration, diceMode: 7,
    participants: Array.from({ length: count }, (_, i) => ({ id: `p${i}`, name: `P${i}` })) } });
}
function roll(state: FlowState, faces: readonly number[]) {
  const draws = encode(faces);
  return advanceFlow(state, state.revision, { type: 'roll' }, { next: () => draws.shift()! });
}
function game(state: FlowState): SeriesState {
  if (state.phase === 'setup' || state.phase === 'replayPreparation' || !isSeriesState(state.game)) throw new Error('Series expected');
  return state.game;
}
function secondGame() {
  let state = ready();
  for (const faces of [[1, 2, 2, 2, 2, 2, 2], [1, 1, 1, 2, 2, 2, 2], [1, 1, 1, 1, 1, 1, 1]]) {
    state = roll(state, faces);
    if (game(state).currentPlayerIndex < 2) state = step(state, { type: 'next' });
  }
  state = step(state, { type: 'ranking' });
  return step(state, { type: 'nextSeriesGame', currentGameNumber: 1 });
}
function partiallyFinished() {
  let state = roll(secondGame(), [1, 1, 2, 2, 2, 2, 2]);
  state = step(state, { type: 'next' });
  return roll(state, [5, 2, 2, 2, 2, 2, 2]);
}
function storeFor(state: FlowState, random = noDraw) {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  const recovery = new SessionRecovery(() => storage); recovery.saveGame(state);
  const store = createGameStore(random, recovery);
  expect(store.getSnapshot().state).toEqual(state);
  return store;
}
const row = (name: string) => screen.getByRole('region', { name: '暫定順位' }).querySelector('ol')!
  .querySelectorAll('li')[Array.from(screen.getByRole('region', { name: '暫定順位' }).querySelectorAll('ol > li')).findIndex((li) => li.querySelector('strong')?.textContent === name)]!;
let frames = new Map<number, FrameRequestCallback>(); let frame = 0;
beforeEach(() => {
  frames = new Map(); frame = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++frame, callback); return frame; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function paint() { act(() => { for (let i = 0; i < 2; i++) { const pending = [...frames.values()]; frames.clear(); pending.forEach((callback) => callback(0)); } }); }

describe('pure Series provisional cumulative derivation', () => {
  // Arithmetic examples isolate display derivation; real Flow/Recovery boundaries are tested below.
  function sample(scores: readonly number[], remaining: readonly number[], pastScores: readonly number[], pastRemaining: readonly number[]) {
    const base = game(ready(scores.length + 1));
    return { ...base, currentGameNumber: 2, cumulative: base.cumulative.map((entry, i) => ({ ...entry,
      cumulativeScore: pastScores[i] ?? 0, cumulativeRemainingDice: pastRemaining[i] ?? 0 })),
      players: base.players.map((player, i) => i < scores.length ? { ...player, score: scores[i]!, activeDice: remaining[i]!,
        removedDice: 7 - remaining[i]!, turnFinished: true, completed: remaining[i] === 0 } : player) };
  }
  it('adds the requested 300/4 + 200/2 example without mutating authority', () => {
    const state = sample([200], [2], [300], [4]); const before = structuredClone(state);
    const result = calculateSeriesProvisional(state);
    expect(result.values[0]).toEqual({ playerId: 'p0', cumulativeScore: 500, cumulativeRemainingDice: 6 });
    expect(result.rankings).toEqual([{ playerId: 'p0', rank: 1 }]); expect(state).toEqual(before);
  });
  it('reverses current Game ranking using cumulative score', () => {
    const result = calculateSeriesProvisional(sample([200, 50], [2, 1], [300, 500], [4, 8]));
    expect(result.values.slice(0, 2)).toEqual([
      { playerId: 'p0', cumulativeScore: 500, cumulativeRemainingDice: 6 },
      { playerId: 'p1', cumulativeScore: 550, cumulativeRemainingDice: 9 },
    ]);
    expect(result.rankings).toEqual([{ playerId: 'p1', rank: 1 }, { playerId: 'p0', rank: 2 }]);
    expect(result.bottomIds).toEqual(['p0']);
  });
  it('uses cumulative remaining rather than current remaining as the tiebreak', () => {
    const result = calculateSeriesProvisional(sample([200, 200], [1, 3], [300, 300], [8, 2]));
    expect(result.rankings.map((entry) => entry.playerId)).toEqual(['p1', 'p0']);
    expect(result.values.map((entry) => entry.cumulativeRemainingDice)).toEqual([9, 5, 0]);
  });
  it('keeps exact ties and competition ranks', () => {
    const result = calculateSeriesProvisional(sample([200, 100, 150, 50], [2, 1, 2, 3], [300, 300, 250, 250], [2, 3, 2, 1]));
    expect(result.rankings.map((entry) => entry.rank)).toEqual([1, 2, 2, 4]);
  });
  it('highlights every tied cumulative bottom player', () => {
    const result = calculateSeriesProvisional(sample([200, 100, 50], [2, 1, 2], [300, 300, 350], [2, 3, 2]));
    expect(result.bottomIds).toEqual(['p1', 'p2']);
  });
  it('retains past remaining for Complete and ranks a higher scoring non-complete player first', () => {
    const result = calculateSeriesProvisional(sample([200, 300], [0, 2], [300, 300], [6, 6]));
    expect(result.values[0]!.cumulativeRemainingDice).toBe(6);
    expect(result.rankings.map((entry) => entry.playerId)).toEqual(['p1', 'p0']);
  });
  it('adds active plus stranded OUT dice to remaining', () => {
    const base = sample([200], [2], [300], [4]);
    const state = { ...base, players: base.players.map((player, i) => i === 0 ? { ...player, strandedDice: 1, removedDice: 4 } : player) };
    expect(calculateSeriesProvisional(state).values[0]!.cumulativeRemainingDice).toBe(7);
  });
  it('excludes unfinished players even with a larger past or current score', () => {
    const base = sample([200], [2], [300, 7000], [4, 70]);
    const state = { ...base, players: base.players.map((player, i) => i === 1 ? { ...player, score: 700 } : player) };
    const result = calculateSeriesProvisional(state);
    expect(result.rankings).toEqual([{ playerId: 'p0', rank: 1 }]);
    expect(result.values[1]!.cumulativeScore).toBe(7000);
  });
});

describe('Series provisional Play, staged visibility and Recovery', () => {
  it('shows cumulative values/ranks after mid-Series reload, keeping unfinished players unplayed', () => {
    const state = partiallyFinished();
    const view = render(<App store={storeFor(state)} soundPlayer={quiet} />);
    expect(row('P0').querySelector('.rank')?.textContent).toBe('2位');
    expect(row('P0').querySelector('.rank-score')?.textContent).toBe('300点残り 11 · OUT 0');
    expect(row('P1').querySelector('.rank')?.textContent).toBe('1位');
    expect(row('P1').querySelector('.rank-score')?.textContent).toBe('350点残り 10 · OUT 0');
    expect(row('P0').classList.contains('bottom')).toBe(true);
    expect(row('P2').querySelector('.rank')?.textContent).toBe('—');
    expect(row('P2').textContent).toContain('未プレイ');
    expect(Array.from(view.container.querySelector('.play')!.children).map((node) => node.className)).toEqual([
      'eyebrow player-roll-line', 'current-player', 'dice-field', 'metrics', 'turn-message', 'turn-action-slot',
    ]);
    expect(view.container.querySelector('.game-layout')!.lastElementChild?.className).toBe('panel ranking');
  });
  it('does not give current-Game Complete priority or zero past remaining', () => {
    let state = roll(secondGame(), Array<number>(7).fill(5));
    state = step(state, { type: 'next' }); state = roll(state, [1, 1, 1, 1, 1, 2, 2]);
    render(<App store={storeFor(state)} soundPlayer={quiet} />);
    expect(row('P0').querySelector('.rank-score')?.textContent).toBe('450点残り 6 · OUT 0');
    expect(row('P0').classList.contains('complete')).toBe(false);
    expect(row('P1').querySelector('.rank')?.textContent).toBe('1位');
  });
  it('keeps cumulative base but ranks nobody immediately after Next Game', () => {
    const state = secondGame();
    render(<App store={storeFor(state)} soundPlayer={quiet} />);
    expect(row('P0').querySelector('.rank-score')?.textContent).toBe('100点残り 6 · OUT 0');
    expect(screen.getByRole('region', { name: '暫定順位' }).querySelectorAll('.rank')).toHaveLength(3);
    expect(Array.from(screen.getByRole('region', { name: '暫定順位' }).querySelectorAll('.rank')).every((node) => node.textContent === '—')).toBe(true);
    expect(game(state).cumulative[0]!.cumulativeScore).toBe(100);
  });
  it('does not double count the last terminal commit or expose it before reveal, and matches Final Ranking', async () => {
    const prior = step(partiallyFinished(), { type: 'next' });
    const draws = encode([5, 2, 2, 2, 2, 2, 2]);
    const store = storeFor(prior, { next: () => draws.shift()! });
    let finish: (() => void) | undefined;
    const renderer = { initialize: async () => undefined, present: () => new Promise<void>((resolve) => { finish = resolve; }), clear: () => undefined, dispose: () => undefined };
    render(<App store={store} soundPlayer={quiet} dicePresentation={{ createRenderer: async () => renderer, prefersReducedMotion: () => false, resultStepMs: 0 }} />);
    fireEvent.click(screen.getByRole('button', { name: 'ROLL' }));
    await waitFor(() => expect(finish).toBeTypeOf('function'));
    const committed = game(store.getSnapshot().state);
    expect(committed.players.every((player) => player.turnFinished)).toBe(true);
    expect(calculateSeriesProvisional(committed).values).toEqual(committed.cumulative);
    expect(row('P2').querySelector('.rank')?.textContent).toBe('—');
    expect(row('P0').querySelector('.rank-score')?.textContent).toBe('300点残り 11 · OUT 0');
    await act(async () => { finish!(); await Promise.resolve(); }); paint();
    expect(row('P0').querySelector('.rank-score')?.textContent).toBe('300点残り 11 · OUT 0');
    expect(row('P1').querySelector('.rank-score')?.textContent).toBe('350点残り 10 · OUT 0');
    expect(row('P2').querySelector('.rank-score')?.textContent).toBe('750点残り 6 · OUT 0');
    const provisional = calculateSeriesProvisional(game(store.getSnapshot().visibleState));
    expect(provisional.rankings).toEqual(calculateSeriesRanking(committed.cumulative).rankings);
    fireEvent.click(screen.getByRole('button', { name: '結果を見る' })); paint();
    expect(screen.getByRole('heading', { name: '連続試合 FINAL RANKING' })).toBeTruthy();
    expect(screen.getAllByRole('row').slice(1).map((node) => node.textContent)).toEqual([
      '1位P2750点6個', '2位P1350点10個', '3位P0敗者300点11個',
    ]);
  });
  it('matches Intermediate values after the Game 1 atomic contribution', () => {
    let state = ready(2); state = roll(state, [1, 2, 2, 2, 2, 2, 2]); state = step(state, { type: 'next' });
    state = roll(state, [5, 2, 2, 2, 2, 2, 2]);
    const projected = calculateSeriesProvisional(game(state));
    expect(projected.values).toEqual(game(state).cumulative);
    const intermediate = step(state, { type: 'ranking' });
    expect(intermediate.phase).toBe('seriesIntermediate');
    expect(projected.values).toEqual(game(intermediate).cumulative);
    render(<App store={storeFor(state)} soundPlayer={quiet} />);
    expect(row('P0').querySelector('.rank-score')?.textContent).toBe('100点残り 6 · OUT 0');
  });
  it.each([{ type: 'normal' }, { type: 'completionTarget', targetCompletions: 1 }] as const)('retains %s Complete-first current Round ranking', (mode) => {
    let state = ready(3, mode); state = roll(state, Array<number>(7).fill(5)); state = step(state, { type: 'next' });
    state = roll(state, [1, 1, 1, 1, 1, 0, 0]);
    if (state.phase !== 'turn') throw new Error('Turn expected');
    render(<RankingBoard game={state.game} />);
    expect(row('P0').querySelector('.rank')?.textContent).toBe('1位');
    expect(row('P0').classList.contains('complete')).toBe(true);
    expect(row('P0').querySelector('.rank-score')?.textContent).toBe('350点残り 0 · OUT 0');
    expect(row('P1').querySelector('.rank')?.textContent).toBe('2位');
    expect(within(row('P1')).getByText('暫定最下位')).toBeTruthy();
  });
});
