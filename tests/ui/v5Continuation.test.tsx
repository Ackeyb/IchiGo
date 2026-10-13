import { isZeroOneFlow } from '../../src/game/zeroOneFlow';
// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/app/App';
import { createGameStore } from '../../src/app/gameStore';
import { advanceFlow, initialFlow } from '../../src/game/gameFlow';
import type { FlowAction, FlowState } from '../../src/game/gameFlow';
import { initialSetup } from '../../src/game/setup';
import { isCompletionTargetState } from '../../src/game/completionTarget';
import { isSeriesState } from '../../src/game/series';
import { calculateSeriesProvisional } from '../../src/game/seriesProvisional';
import { roundContinuation } from '../../src/game/roundPolicy';
import type { GameMode } from '../../src/game/types';
import { SessionRecovery, SESSION_GAME_KEY, SESSION_SCHEMA_VERSION, SESSION_SOUND_KEY, SOUND_SCHEMA_VERSION, validateStoredFlowState } from '../../src/storage/sessionRecovery';
import { RulesScreen } from '../../src/app/RulesScreen';

const noDraw = { next: (): number => { throw new Error('Unexpected draw'); } };
const quiet = { play: () => undefined, dispose: () => undefined };
const encode = (faces: readonly number[]) => faces.flatMap((face) => [0.9, (face - 0.5) / 6]);
const complete = [1, 1, 1, 1, 1];
const noScore = [2, 2, 2, 2, 2];
const step = (s: FlowState, action: FlowAction) => advanceFlow(s, s.revision, action, noDraw);
function game(s: FlowState) {
  if (isZeroOneFlow(s) || s.phase === 'setup' || s.phase === 'replayPreparation') throw new Error('Game expected');
  return s.game;
}
function ready(mode: Exclude<GameMode, { type: 'zeroOne' }>): FlowState {
  const configuration = mode.type === 'completionTarget' ? { mode, rollLimit: null } : { mode, rollLimit: 1 as const };
  return step(initialFlow(), { type: 'start', setup: { ...initialSetup(), ...configuration, diceMode: 5,
    participants: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }] } });
}
function roll(s: FlowState, faces: readonly number[]) {
  const draws = encode(faces);
  return advanceFlow(s, s.revision, { type: 'roll' }, { next: () => draws.shift()! });
}
function ended(s: FlowState, faces = [complete, noScore]) {
  return roll(step(roll(s, faces[0]!), { type: 'next' }), faces[1]!);
}
function memory(s: FlowState, version: number = SESSION_SCHEMA_VERSION) {
  const values = new Map([[SESSION_GAME_KEY, JSON.stringify({ version, state: s })]]);
  return { values, getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
}
function recovered(s: FlowState, random = noDraw) {
  const storage = memory(s);
  const recovery = new SessionRecovery(() => storage);
  expect(recovery.loadGame()).toEqual({ state: s, recovered: true });
  return createGameStore(random, recovery);
}
let frames = new Map<number, FrameRequestCallback>(); let id = 0;
beforeEach(() => {
  frames = new Map(); id = 0;
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { frames.set(++id, cb); return id; });
  vi.stubGlobal('cancelAnimationFrame', (key: number) => frames.delete(key));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function paint() { act(() => { for (let i = 0; i < 2; i++) { const pending = [...frames.values()]; frames.clear(); pending.forEach((cb) => cb(0)); } }); }

describe('v5 explicit continuation and Recovery', () => {
  it.each([2, 5] as const)('goes directly through %i Series Games without Intermediate or re-adding contributions', (gameCount) => {
    let s = ready({ type: 'series', gameCount });
    for (let n = 1; n <= gameCount; n++) {
      s = ended(s);
      const store = recovered(s);
      const view = render(<App store={store} soundPlayer={quiet} />);
      const before = game(s);
      if (!isSeriesState(before)) throw new Error('Series expected');
      expect(before.cumulative).toEqual([{ playerId: 'a', cumulativeScore: n * 500, cumulativeRemainingDice: 0 },
        { playerId: 'b', cumulativeScore: 0, cumulativeRemainingDice: n * 5 }]);
      const label = n === gameCount ? '結果を見る' : '次の試合へ';
      expect(screen.queryByRole('heading', { name: /試合 .* 終了/ })).toBeNull();
      const button = screen.getByRole('button', { name: label });
      fireEvent.click(button); fireEvent.click(button); paint();
      s = store.getSnapshot().state;
      expect(s.phase).toBe(n === gameCount ? 'seriesRanking' : 'turn');
      expect(game(s)).toMatchObject({ cumulative: before.cumulative, totalCompletionCount: n });
      if (n < gameCount) {
        expect(game(s)).toMatchObject({ currentGameNumber: n + 1, currentPlayerIndex: 0 });
        expect(s).toMatchObject({ turn: { nextRollNumber: 1, player: { score: 0, activeDice: 5 } } });
        expect(advanceFlow(s, s.revision, { type: 'nextSeriesGame', currentGameNumber: n }, noDraw)).toBe(s);
        expect(advanceFlow(s, store.getSnapshot().state.revision - 1, { type: 'nextSeriesGame', currentGameNumber: n }, noDraw)).toBe(s);
      }
      view.unmount();
    }
  });

  const decisions = [
    { target: 3, faces: [complete, noScore], kind: 'nextGame', label: '次の試合へ' },
    { target: 5, faces: [complete, complete], kind: 'nextGame', label: '次の試合へ' },
    { target: 3, faces: [noScore, noScore], kind: 'nextGame', label: '次の試合へ' },
    { target: 1, faces: [complete, complete], kind: 'suddenDeath', label: 'サドンデスへ' },
    { target: 1, faces: [complete, noScore], kind: 'result', label: '結果を見る' },
  ] as const;
  it.each(decisions)('restores CT $kind for target $target and uses $label', ({ target, faces, kind, label }) => {
    const s = ended(ready({ type: 'completionTarget', targetCompletions: target }), [...faces]);
    expect(roundContinuation(game(s))).toBe(kind);
    const store = recovered(s);
    render(<App store={store} soundPlayer={quiet} />);
    expect(screen.queryByRole('heading', { name: /FINAL RANKING|SUDDEN DEATH/ })).toBeNull();
    const before = game(s);
    fireEvent.click(screen.getByRole('button', { name: label })); paint();
    const next = store.getSnapshot().state;
    expect(game(next).totalCompletionCount).toBe(before.totalCompletionCount);
    recovered(next);
    if (kind === 'result') {
      expect(next.phase).toBe('ranking');
      fireEvent.click(screen.getByRole('button', { name: '敗者発表' })); paint();
      fireEvent.click(screen.getByRole('button', { name: 'ペナルティへ' })); paint();
      expect(store.getSnapshot().state.phase).toBe('penalty');
    } else {
      expect(next).toMatchObject({ phase: 'turn', game: { currentPlayerIndex: 0, suddenDeathCount: kind === 'suddenDeath' ? 1 : 0,
        completionTargetRound: { number: 2, kind: kind === 'suddenDeath' ? 'suddenDeath' : 'regular' } },
        turn: { nextRollNumber: 1, player: { score: 0, activeDice: 5, strandedDice: 0, removedDice: 0 } } });
      expect(screen.queryByRole('heading', { name: 'SUDDEN DEATH' })).toBeNull();
    }
  });

  it('retains same-player events, overshoot and true non-complete tie SD after ordinary continuation', () => {
    let s = ended(ready({ type: 'completionTarget', targetCompletions: 3 }), [complete, complete]);
    expect(roundContinuation(game(s))).toBe('nextGame');
    s = step(s, { type: 'nextCompletionTargetGame' });
    const ordinary = s;
    s = ended(s, [complete, complete]);
    expect(game(s).totalCompletionCount).toBe(4);
    expect(roundContinuation(game(s))).toBe('suddenDeath');
    s = step(s, { type: 'startSuddenDeath' });
    expect(isCompletionTargetState(game(s))).toBe(true);
    expect(game(s).suddenDeathCount).toBe(1);
    const fresh = s;
    s = ended(s, [noScore, noScore]);
    expect(roundContinuation(game(s))).toBe('suddenDeath');
    recovered(s);
    expect(step(s, { type: 'nextCompletionTargetGame' })).toBe(s);
    const next = step(s, { type: 'startSuddenDeath' });
    expect(game(next).suddenDeathCount).toBe(2);
    expect(game(next).totalCompletionCount).toBe(4);
    expect(advanceFlow(next, ordinary.revision, { type: 'roll' }, noDraw)).toBe(next);
    expect(advanceFlow(next, fresh.revision, { type: 'startSuddenDeath' }, noDraw)).toBe(next);
    expect(step(next, { type: 'startSuddenDeath' })).toBe(next);
    recovered(next);
  });

  it.each(['missing', 'badKind', 'zero', 'wrongSD', 'future', 'oldTurnId'] as const)('rejects CT identity %s without guessing', (kind) => {
    const s = ready({ type: 'completionTarget', targetCompletions: 3 });
    if (s.phase !== 'turn' || !isCompletionTargetState(s.game)) throw new Error('CT expected');
    const progress = kind === 'missing' ? undefined : kind === 'badKind' ? { number: 1, kind: 'nextGame' }
      : { number: kind === 'zero' ? 0 : kind === 'future' ? 100 : 1, kind: kind === 'wrongSD' ? 'suddenDeath' : 'regular' };
    const invalid = { ...s, game: { ...s.game, completionTargetRound: progress },
      turn: kind === 'oldTurnId' ? { ...s.turn, turnId: '1/0/a' } : s.turn };
    expect(validateStoredFlowState(invalid)).toBe(false);
    expect(new SessionRecovery(() => memory(invalid as FlowState)).loadGame()).toMatchObject({ recovered: false, notice: 'corrupt' });
  });

  it.each([true, false])('writes schema 6 and rejects schema 4 without losing Sound %s', (enabled) => {
    expect(SESSION_SCHEMA_VERSION).toBe(6); expect(SOUND_SCHEMA_VERSION).toBe(1);
    const s = ready({ type: 'normal' }); const storage = memory(s, 4);
    storage.setItem(SESSION_SOUND_KEY, JSON.stringify({ version: 1, enabled }));
    const recovery = new SessionRecovery(() => storage);
    expect(recovery.loadGame()).toMatchObject({ recovered: false, notice: 'corrupt' });
    expect(recovery.loadSound()).toEqual({ enabled });
    recovery.saveGame(s);
    expect(JSON.parse(storage.getItem(SESSION_GAME_KEY)!)).toEqual({ version: 6, state: s });
    expect(new SessionRecovery(() => storage).loadGame()).toEqual({ state: s, recovered: true });
  });
});

describe('v5 final Series presentation mask', () => {
  function finalReady() {
    const terminal = ended(ready({ type: 'series', gameCount: 2 }), [[1, 2, 2, 2, 2], noScore]);
    return step(terminal, { type: 'nextSeriesGame', currentGameNumber: 1 });
  }
  const board = () => screen.getByRole('region', { name: '暫定順位' });
  function masked() {
    expect([...board().querySelectorAll('.rank')].map((e) => e.textContent)).toEqual(['ヒミツ', 'ヒミツ']);
    expect([...board().querySelectorAll('.rank-score strong')].map((e) => e.textContent)).toEqual(['ヒミツ', 'ヒミツ']);
    expect(board().querySelector('.bottom')).toBeNull();
    expect(within(board()).queryByText('暫定最下位')).toBeNull();
    expect([...board().querySelectorAll('li > div:not(.rank-score) > strong')].map((e) => e.textContent)).toEqual(['A', 'B']);
  }
  it('masks all players from final start through the last turn, then exposes the committed Final Ranking', () => {
    let s = finalReady();
    let view = render(<App store={recovered(s)} soundPlayer={quiet} />);
    masked(); expect(board().textContent).toContain('残り 4'); expect(board().textContent).toContain('残り 5');
    view.unmount();
    s = roll(s, complete);
    view = render(<App store={recovered(s)} soundPlayer={quiet} />); masked(); view.unmount();
    s = roll(step(s, { type: 'next' }), noScore);
    const g = game(s); if (!isSeriesState(g)) throw new Error('Series expected');
    expect(calculateSeriesProvisional(g).values).toEqual(g.cumulative);
    expect(calculateSeriesProvisional(g).rankings).toEqual([{ playerId: 'a', rank: 1 }, { playerId: 'b', rank: 2 }]);
    const store = recovered(s); render(<App store={store} soundPlayer={quiet} />); masked();
    fireEvent.click(screen.getByRole('button', { name: '結果を見る' })); paint();
    expect(screen.getAllByRole('row').slice(1).map((r) => r.textContent)).toEqual(['1位A600点4個', '2位B敗者0点10個']);
    expect(screen.queryByText('ヒミツ')).toBeNull();
    recovered(store.getSnapshot().state);
    fireEvent.click(screen.getByRole('button', { name: 'ペナルティへ' })); paint();
    recovered(store.getSnapshot().state);
  });
  it('stages cumulative Remaining until reveal while keeping rank and score hidden', async () => {
    const s = finalReady(); const draws = encode([1, 1, 1, 2, 2]);
    const store = recovered(s, { next: () => draws.shift()! });
    let finish: (() => void) | undefined;
    const renderer = { initialize: async () => undefined, present: () => new Promise<void>((resolve) => { finish = resolve; }), clear: () => undefined, dispose: () => undefined };
    render(<App store={store} soundPlayer={quiet} dicePresentation={{ createRenderer: async () => renderer, prefersReducedMotion: () => false, resultStepMs: 0 }} />);
    fireEvent.click(screen.getByRole('button', { name: 'ROLL' }));
    await waitFor(() => expect(finish).toBeTypeOf('function'));
    masked(); expect(board().textContent).toContain('残り 4');
    await act(async () => { finish!(); await Promise.resolve(); }); paint();
    masked(); expect(board().textContent).toContain('残り 6');
    expect(screen.getByRole('button', { name: '次へ' })).toBeTruthy();
  });
  it('updates the Rule Page continuation and secret-result explanations', () => {
    render(<RulesScreen onBack={() => undefined} />);
    expect(screen.getByText(/これはSudden Deathではありません/)).toBeTruthy();
    expect(within(screen.getByRole('heading', { name: '完走指定' }).closest('section')!).getByText(/「サドンデスへ」/)).toBeTruthy();
    expect(screen.getByText(/最終試合以外は「次の試合へ」/)).toBeTruthy();
    expect(screen.getByText(/最終試合中の暫定順位と累計得点は「ヒミツ」/)).toBeTruthy();
  });
});
