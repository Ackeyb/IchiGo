// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/app/App';
import { DicePresentation } from '../../src/app/DicePresentation';
import { createGameStore } from '../../src/app/gameStore';
import { advanceFlow, initialFlow } from '../../src/game/gameFlow';
import type { FlowState } from '../../src/game/gameFlow';
import { initialSetup } from '../../src/game/setup';
import type { DieResult, RollLimit } from '../../src/game/types';
import { SessionRecovery } from '../../src/storage/sessionRecovery';

let frames: FrameRequestCallback[] = [];
beforeEach(() => {
  frames = [];
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.push(callback); return frames.length; });
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const noDraw = { next: (): number => { throw new Error('Unexpected draw'); } };
const encode = (faces: readonly number[]) => faces.flatMap((face) => face === 0 ? [0] : [0.9, (face - 0.5) / 6]);
function ready(limit: RollLimit = 3) {
  return advanceFlow(initialFlow(), 0, { type: 'start', setup: { ...initialSetup(), diceMode: 14, rollLimit: limit,
    participants: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }] } }, noDraw);
}
function rolled(state: FlowState, faces: readonly number[]) {
  const draws = encode(faces);
  return advanceFlow(state, state.revision, { type: 'roll' }, { next: () => draws.shift()! });
}
function recoveredStore(state: FlowState, random = noDraw) {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  new SessionRecovery(() => storage).saveGame(state);
  return createGameStore(random, new SessionRecovery(() => storage));
}
const quiet = { play: () => undefined, dispose: () => undefined };
function paint() { act(() => { for (let i = 0; i < 2; i++) { const pending = frames; frames = []; pending.forEach((cb) => cb(0)); } }); }

describe('v3 Play presentation', () => {
  it.each([1, 3, 5] as const)('shows ROLL 1/%s in the PLAYER row', (limit) => {
    render(<App store={recoveredStore(ready(limit))} soundPlayer={quiet} />);
    expect(screen.getByText(`ROLL 1/${limit}`).closest('.eyebrow')?.textContent).toContain('PLAYER 1 / 2');
    expect(screen.getByLabelText('ROLL可能なダイス 14個').children).toHaveLength(14);
  });
  it('omits the counter DOM for an unlimited game', () => {
    const view = render(<App store={recoveredStore(ready(null))} soundPlayer={quiet} />);
    expect(view.container.querySelector('.roll-counter')).toBeNull();
  });
  it.each([1, 2])('restores the next roll after %s committed rolls without new draws', (count) => {
    let state = ready();
    for (let i = 0; i < count; i++) state = rolled(state, [1, ...Array<number>(13 - i).fill(2)]);
    render(<App store={recoveredStore(state)} soundPlayer={quiet} />);
    expect(screen.getByText(`ROLL ${count + 1}/3`)).toBeTruthy();
    expect(screen.getByRole('list', { name: '確定したダイスの出目' }).getAttribute('data-rows')).toBe(`7,${7 - count + 1}`);
    expect(screen.getByRole('button', { name: '続けてROLL' }).hasAttribute('disabled')).toBe(false);
  });
  it('holds each roll number through animation and reveal until unlock', async () => {
    let finish: (() => void) | undefined;
    const draws = [...encode([1, ...Array<number>(13).fill(2)]), ...encode([1, ...Array<number>(12).fill(2)])];
    const store = recoveredStore(ready(), { next: () => draws.shift()! });
    const renderer = { initialize: async () => undefined, present: () => new Promise<void>((resolve) => { finish = resolve; }),
      clear: () => undefined, dispose: () => undefined };
    render(<App store={store} soundPlayer={quiet} dicePresentation={{ createRenderer: async () => renderer, prefersReducedMotion: () => false, resultStepMs: 0 }} />);
    for (let roll = 1; roll <= 2; roll++) {
      finish = undefined;
      fireEvent.click(screen.getByRole('button', { name: roll === 1 ? 'ROLL' : '続けてROLL' }));
      await waitFor(() => expect(finish).toBeTypeOf('function'));
      expect(screen.getByText(`ROLL ${roll}/3`)).toBeTruthy();
      await act(async () => { finish!(); await Promise.resolve(); });
      expect(screen.getByText(`ROLL ${roll}/3`)).toBeTruthy();
      paint();
      expect(screen.getByText(`ROLL ${roll + 1}/3`)).toBeTruthy();
    }
  });
  it.each([
    [1, [1, ...Array<number>(13).fill(2)], 'ROLL上限に到達しました'],
    [1, Array<number>(14).fill(2), 'TURN END · ターン終了'],
    [3, [1, ...Array<number>(13).fill(0)], 'TURN END · ターン終了'],
    [1, Array<number>(14).fill(1), 'COMPLETE!! 完走'],
  ] as const)('maps committed ending with limit %s to %s', (limit, faces, message) => {
    const view = render(<App store={recoveredStore(rolled(ready(limit), faces))} soundPlayer={quiet} />);
    expect(screen.getByText(message)).toBeTruthy();
    if (message !== 'ROLL上限に到達しました') expect(screen.queryByText('ROLL上限に到達しました')).toBeNull();
    expect(view.container.querySelector('.roll-counter')).toBeNull();
  });
});

describe('v3 ordered Penalty expression', () => {
  it.each([
    [[2, 5], 7, '2 + 5 = 7'],
    [[0, 2, 5, 0], 19, 'OUT(6) + 2 + 5 + OUT(6) = 19'],
    [Array<number>(14).fill(0), 84, `${Array<string>(14).fill('OUT(6)').join(' + ')} = 84`],
  ] as const)('shows committed terms %j after settled recovery', (faces, base, expression) => {
    const dice: DieResult[] = faces.map((face) => face === 0 ? { status: 'out', value: null } : { status: 'safe', value: face as 2 | 5 });
    const view = render(<DicePresentation dice={dice} diceMode={14} kind="penalty" revision={1} busy={false}
      onReveal={() => undefined} onPresented={() => undefined} presentation={{ kind: 'penalty', basePenalty: base, multiplier: 2, finalPenalty: base * 2 }} />);
    expect(view.container.querySelector('.penalty-dice-expression')?.textContent).toBe(expression);
    expect(view.container.querySelectorAll('.die-status, .die-points')).toHaveLength(0);
    expect(screen.queryAllByLabelText('OUT').length).toBe(faces.filter((face) => face === 0).length);
  });
});
