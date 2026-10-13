import { afterEach, describe, expect, it, vi } from 'vitest';
import { createZeroOnePlayer, isZeroOneShort, resolveZeroOneRoll, zeroOneDiceCount } from '../../src/game/zeroOne';
import type { ZeroOnePlayer, ZeroOnePreset } from '../../src/game/zeroOne';
import { calculateZeroOneRanking } from '../../src/game/zeroOneRanking';
import { advanceFlow, initialFlow } from '../../src/game/gameFlow';
import type { FlowAction, FlowState } from '../../src/game/gameFlow';
import { isZeroOneFlow } from '../../src/game/zeroOneFlow';
import { initialSetup, switchSetupMode, validateSetupDraft } from '../../src/game/setup';
import { isGameMode } from '../../src/game/types';
import type { DieResult } from '../../src/game/types';
import { createZeroOnePenalty } from '../../src/game/zeroOnePenalty';
import { seriesPenaltyResult } from '../../src/game/seriesPenalty';
import { SessionRecovery, SESSION_GAME_KEY, SESSION_SCHEMA_VERSION, SESSION_SOUND_KEY } from '../../src/storage/sessionRecovery';
import { createGameStore } from '../../src/app/gameStore';
import { captureSeriesPenaltyPresentation, createSeriesPenaltyAutoCoordinator } from '../../src/app/seriesPenaltyAutoCoordinator';

const noDraw = { next: (): number => { throw new Error('Unexpected random draw'); } };
const dice = (faces: readonly number[]): readonly DieResult[] => faces.map((value) => value === 0 ? { status: 'out', value: null } : { status: 'safe', value: value as 1 | 2 | 3 | 4 | 5 | 6 });
const encode = (faces: readonly number[]) => faces.flatMap((v) => v === 0 ? [0] : [0.9, (v - 0.5) / 6]);
const step = (s: FlowState, action: FlowAction) => advanceFlow(s, s.revision, action, noDraw);
function roll(s: FlowState, faces: readonly number[]) {
  const values = encode(faces); let calls = 0;
  const next = advanceFlow(s, s.revision, { type: 'roll' }, { next: () => { calls++; return values.shift()!; } });
  expect(calls).toBe(encode(faces).length); return next;
}
function start(preset: ZeroOnePreset = 350) {
  return step(initialFlow(), { type: 'start', setup: { ...switchSetupMode(initialSetup(), 'zeroOne'),
    mode: { type: 'zeroOne', preset }, diceMode: zeroOneDiceCount(preset), rollLimit: null,
    participants: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }] } });
}
function zero(s: FlowState) { if (!isZeroOneFlow(s)) throw Error('Zero-One expected'); return s; }
function memory(state: unknown, version: number = SESSION_SCHEMA_VERSION) {
  const values = new Map([[SESSION_GAME_KEY, JSON.stringify({ version, state })]]);
  return { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k, v); }, removeItem: (k: string) => { values.delete(k); } };
}
function restore(s: FlowState) {
  const recovery = new SessionRecovery(() => memory(s));
  expect(recovery.loadGame()).toEqual({ state: s, recovered: true });
  return createGameStore(noDraw, recovery);
}
const clear = [1, 1, 1, 5, 2];
function ended() {
  let s = roll(start(), clear);
  s = roll(step(s, { type: 'next' }), [2, 2, 2, 2, 2]);
  s = roll(step(s, { type: 'next' }), clear);
  s = roll(step(s, { type: 'next' }), clear);
  return s;
}
afterEach(() => vi.useRealTimers());

describe('Zero-One presets and core contracts', () => {
  it.each([[350, 5], [500, 7], [700, 10], [1000, 14]] as const)('maps %i to %i dice without UI authority', (preset, count) => {
    expect(zeroOneDiceCount(preset)).toBe(count);
    expect(zero(start(preset)).game.players[0]).toMatchObject({ remainingScore: preset, activeDice: count, accumulatedTurnCount: 0, cleanClearEligible: true });
  });
  it('discards inactive presets, keeps same-mode values, and validates fixed dice / limit', () => {
    const setup = switchSetupMode(initialSetup(), 'zeroOne');
    expect(setup).toMatchObject({ mode: { type: 'zeroOne', preset: 500 }, diceMode: 7, rollLimit: null });
    const edited = { ...setup, mode: { type: 'zeroOne' as const, preset: 1000 as const }, diceMode: 14 as const, rollLimit: null };
    expect(switchSetupMode(edited, 'zeroOne')).toBe(edited);
    expect(switchSetupMode(switchSetupMode(edited, 'normal'), 'zeroOne')).toMatchObject({ mode: { type: 'zeroOne', preset: 500 }, diceMode: 7 });
    expect(validateSetupDraft({ ...edited, diceMode: 7 })).toBe(false);
    expect(validateSetupDraft({ ...edited, rollLimit: 1 })).toBe(false);
    expect(isGameMode({ type: 'zeroOne', preset: 500, gameCount: 2 })).toBe(false);
  });
  it.each([null, 0, 351, 501, '500', undefined])('rejects unsupported preset %s', (preset) => expect(isGameMode({ type: 'zeroOne', preset })).toBe(false));
  it.each([[300, 2, true], [201, 2, true], [200, 2, false], [1, 0, true]])('uses strict Short boundary %i / %i', (remaining, active, expected) => expect(isZeroOneShort(remaining, active)).toBe(expected));
  it('scores all 1/5 and retains OUT/removals without disqualifying clean play', () => {
    const before = createZeroOnePlayer('a', 500);
    const result = resolveZeroOneRoll(before, dice([1, 5, 0, 2, 3, 4, 6]), 500);
    expect(result).toMatchObject({ rollScore: 150, outcome: 'turnEnd', player: { remainingScore: 350, activeDice: 4, strandedDice: 1, removedDice: 2, accumulatedTurnCount: 1, cleanClearEligible: true } });
    expect(before).toEqual(createZeroOnePlayer('a', 500));
  });
  it('Bust rolls back score, scoring removals and OUT but retains Turn +1 / disqualification', () => {
    const before = resolveZeroOneRoll(createZeroOnePlayer('a', 350), dice([1, 1, 5, 2, 2]), 350).player;
    const result = resolveZeroOneRoll(before, dice([1, 5]), 350);
    expect(result.player).toEqual({ ...before, accumulatedTurnCount: 2, cleanClearEligible: false });
    const outBefore = { ...before, activeDice: 3, removedDice: 2, remainingScore: 150 };
    const outBust = resolveZeroOneRoll(outBefore, dice([1, 1, 0]), 350);
    expect(outBust.player).toEqual({ ...outBefore, accumulatedTurnCount: 2, cleanClearEligible: false });
    expect(resolveZeroOneRoll(result.player, dice([1, 2]), 350).cleanClear).toBe(false);
  });
  it('Short restores all dice and score but never restores Clean Clear eligibility', () => {
    const first = resolveZeroOneRoll(createZeroOnePlayer('a', 350), dice([1, 5, 5, 5, 2]), 350).player;
    const short = resolveZeroOneRoll(first, dice([5]), 350);
    expect(short.outcome).toBe('short');
    expect(short.player).toEqual({ ...createZeroOnePlayer('a', 350), accumulatedTurnCount: 2, cleanClearEligible: false });
    expect(resolveZeroOneRoll(short.player, dice(clear), 350)).toMatchObject({ outcome: 'clear', cleanClear: false });
  });
  it('Clear and Bust both take priority over zero-active Short', () => {
    const before: ZeroOnePlayer = { ...createZeroOnePlayer('a', 350), remainingScore: 100, activeDice: 1, removedDice: 4, accumulatedTurnCount: 2 };
    expect(resolveZeroOneRoll(before, dice([1]), 350).outcome).toBe('clear');
    expect(resolveZeroOneRoll({ ...before, remainingScore: 50 }, dice([1]), 350).outcome).toBe('bust');
  });
  it('counts no-score as one Turn, retaining eligibility and dice', () => {
    expect(resolveZeroOneRoll(createZeroOnePlayer('a', 350), dice([2, 3, 4, 6, 2]), 350)).toMatchObject({ outcome: 'turnEnd', rollScore: 0, player: { accumulatedTurnCount: 1, cleanClearEligible: true, activeDice: 5 } });
  });
});

describe('Zero-One Flow, ranking and recovery', () => {
  it.each([[1, 2, 2, 2, 2], [2, 2, 2, 2, 2], [0, 2, 2, 2, 2], [1, 1, 1, 1, 1], [0, 0, 0, 0, 0], clear])('ends every ROLL once, rejects continuation and stale actions: %j', (...faces) => {
    const before = start(); const s = roll(before, faces);
    expect(zero(s).game.players[0]!.accumulatedTurnCount).toBe(1);
    expect(step(s, { type: 'roll' })).toBe(s);
    expect(advanceFlow(s, before.revision, { type: 'roll' }, noDraw)).toBe(s);
    expect(zero(step(s, { type: 'next' })).game.currentPlayerIndex).toBe(1);
    restore(s);
  });
  it('skips Clear players, rotates the last uncleared player and ranks solely by Turn count', () => {
    const s = ended(); restore(s);
    expect(calculateZeroOneRanking(zero(s).game.players)).toEqual({ rankings: [{ playerId: 'a', rank: 1 }, { playerId: 'c', rank: 1 }, { playerId: 'b', rank: 3 }], loserIds: ['b'] });
    const ranking = step(s, { type: 'ranking' }); restore(ranking);
    const penalty = step(ranking, { type: 'penalty' }); restore(penalty);
    expect(zero(penalty)).toMatchObject({ zeroOnePenalty: { entries: [{ playerId: 'b', totalDice: 1 }] } });
  });
  it('uses competition ranking and original loser order for 4 / 6 / 6', () => {
    const players = zero(ended()).game.players.map((p, i) => ({ ...p, accumulatedTurnCount: [4, 6, 6][i]! }));
    expect(calculateZeroOneRanking(players)).toEqual({ rankings: [{ playerId: 'a', rank: 1 }, { playerId: 'b', rank: 2 }, { playerId: 'c', rank: 2 }], loserIds: ['b', 'c'] });
  });
  it('resets eligibility on repeated SD while accumulating Turns and Clean Clears', () => {
    let s = start();
    for (let round = 0; round < 2; round++) {
      for (let i = 0; i < 3; i++) { s = roll(s, clear); if (i < 2) s = step(s, { type: 'next' }); }
      expect(step(s, { type: 'ranking' })).toBe(s);
      restore(s);
      const old = s; s = step(s, { type: 'startSuddenDeath' }); restore(s);
      expect(zero(s).game.players.every((p) => p.cleanClearEligible && p.accumulatedTurnCount === round + 1 && p.activeDice === 5)).toBe(true);
      expect(zero(s).game.totalCleanClearCount).toBe(3 * (round + 1));
      expect(advanceFlow(s, old.revision, { type: 'startSuddenDeath' }, noDraw)).toBe(s);
    }
  });
  it('renews eligibility only at SD after all players have actually Bust', () => {
    let s = start();
    for (const faces of [[1, 1, 1, 1, 1], clear]) for (let i = 0; i < 3; i++) {
      s = roll(s, faces);
      if (i < 2 || faces !== clear) s = step(s, { type: 'next' });
    }
    expect(zero(s).game.totalCleanClearCount).toBe(0);
    expect(zero(s).game.players.every((p) => !p.cleanClearEligible && p.accumulatedTurnCount === 2)).toBe(true);
    s = step(s, { type: 'startSuddenDeath' }); restore(s);
    for (let i = 0; i < 3; i++) { s = roll(s, clear); if (i < 2) s = step(s, { type: 'next' }); }
    expect(zero(s).game.totalCleanClearCount).toBe(3);
    expect(zero(s).game.players.every((p) => p.accumulatedTurnCount === 3)).toBe(true);
  });
  it('never increments global Clean Clear count for a no-miss Clear after Short in the same Round', () => {
    let s = roll(start(), [0, 0, 0, 0, 0]);
    expect(zero(s).game.players[0]).toMatchObject({ remainingScore: 350, activeDice: 5, cleanClearEligible: false });
    for (let i = 0; i < 2; i++) s = roll(step(s, { type: 'next' }), clear);
    expect(zero(s).game.totalCleanClearCount).toBe(2);
    s = roll(step(s, { type: 'next' }), clear);
    expect(zero(s).game.players[0]).toMatchObject({ isCleared: true, accumulatedTurnCount: 2, cleanClearEligible: false });
    expect(zero(s).game.totalCleanClearCount).toBe(2);
    restore(s);
  });
  it('keeps Replay configuration/order-only edits, carries editable New Game and restores Full Reset defaults', () => {
    let s = step(step(ended(), { type: 'ranking' }), { type: 'penalty' });
    s = advanceFlow(s, s.revision, { type: 'startZeroOnePenalty', penaltyId: '1/zeroOnePenalty', playerId: 'b', chunkIndex: 0 }, { next: () => 0.9 });
    s = step(s, { type: 'finish' }); restore(s);
    const replay = step(s, { type: 'replay' }); restore(replay);
    if (replay.phase !== 'replayPreparation') throw Error('Replay expected');
    expect(replay.draft).toMatchObject({ mode: { type: 'zeroOne', preset: 350 }, diceMode: 5, rollLimit: null });
    const reordered = step(replay, { type: 'reorderReplay', participantIds: ['c', 'b', 'a'] }); restore(reordered);
    const restarted = zero(step(reordered, { type: 'startReplay' }));
    expect(restarted.game.participants.map((p) => p.id)).toEqual(['c', 'b', 'a']);
    expect(restarted.game.players.every((p) => p.accumulatedTurnCount === 0 && p.cleanClearEligible && !p.isCleared)).toBe(true);
    expect(restarted.game.totalCleanClearCount).toBe(0);
    const fresh = step(s, { type: 'newGame' }); restore(fresh);
    expect(fresh).toMatchObject({ phase: 'setup', draft: replay.draft });
    expect(step(fresh, { type: 'fullReset' })).toMatchObject({ phase: 'setup', draft: initialSetup() });
  });
  it('restores Bust / Short / partial Clear without draws or count replay', () => {
    for (const faces of [[1, 1, 1, 1, 1], [0, 0, 0, 0, 0], clear]) {
      const s = roll(start(), faces); const store = restore(s);
      expect(store.getSnapshot()).toMatchObject({ state: s, visibleState: s, busy: false });
      const restored = store.getSnapshot().state;
      store.dispatch(s.revision, { type: 'roll' }); expect(store.getSnapshot().state).toBe(restored);
    }
  });
  it.each(['preset', 'missingEligible', 'missingCount', 'dice', 'clear', 'result', 'count', 'phase'])('rejects corrupt %s without repair', (kind) => {
    const s = structuredClone(zero(roll(start(), clear)));
    const malformed = kind === 'preset' ? { ...s, game: { ...s.game, mode: { type: 'zeroOne', preset: 501 } } }
      : kind === 'phase' ? { ...s, phase: 'turn' }
        : kind === 'count' ? { ...s, game: { ...s.game, totalCleanClearCount: 99 } }
          : kind === 'result' ? { ...s, result: { ...('result' in s ? s.result : {}), rollScore: 999 } }
            : { ...s, game: { ...s.game, players: s.game.players.map((p, i) => i ? p : { ...p,
              ...(kind === 'missingEligible' ? { cleanClearEligible: undefined } : kind === 'missingCount' ? { accumulatedTurnCount: undefined }
                : kind === 'dice' ? { activeDice: 14 } : { isCleared: false }) }) } };
    expect(new SessionRecovery(() => memory(malformed)).loadGame()).toMatchObject({ recovered: false, notice: 'corrupt' });
  });
  it.each([1, 2, 3, 4, 5])('rejects schema %i while preserving Sound 1', (version) => {
    const storage = memory(start(), version); storage.setItem(SESSION_SOUND_KEY, JSON.stringify({ version: 1, enabled: false }));
    const recovery = new SessionRecovery(() => storage);
    expect(recovery.loadGame()).toMatchObject({ recovered: false }); expect(recovery.loadSound()).toEqual({ enabled: false });
  });
});

describe('Zero-One chunk authority and auto sequencing', () => {
  function penalty(count = 23) {
    const finished = zero(ended());
    const game = { ...finished.game, players: finished.game.players.map((p, i) => ({ ...p, accumulatedTurnCount: i === 0 ? 4 : 4 + count })) };
    const s: FlowState = { phase: 'zeroOnePenalty', revision: 1000, gameNumber: 1, game, ranking: calculateZeroOneRanking(game.players), zeroOnePenalty: createZeroOnePenalty(game, '1/zeroOnePenalty') };
    return s;
  }
  it.each([1, 10, 11, 23, 71, 101])('commits %i dice in <=10 chunks without a Series maximum', (count) => {
    let s: FlowState = penalty(count); restore(s); let calls = 0;
    const random = { next: () => calls++ % 2 === 0 ? 0.9 : 0.2 };
    for (let j = 0; j < Math.ceil(count / 10); j++) {
      const old = s;
      s = advanceFlow(s, s.revision, { type: j ? 'nextZeroOnePenaltyChunk' : 'startZeroOnePenalty', penaltyId: '1/zeroOnePenalty', playerId: 'b', chunkIndex: j }, random);
      restore(s);
      expect(advanceFlow(s, old.revision, { type: 'nextZeroOnePenaltyChunk', penaltyId: '1/zeroOnePenalty', playerId: 'b', chunkIndex: j }, noDraw)).toBe(s);
    }
    expect(calls).toBe(count * 2);
    const current = zero(s); if (current.phase !== 'zeroOnePenalty') throw Error('Penalty expected');
    expect(current.zeroOnePenalty.entries[0]!.committedChunks.map((c) => c.length)).toEqual(Array.from({ length: Math.ceil(count / 10) }, (_, i) => Math.min(10, count - i * 10)));
    expect(seriesPenaltyResult(current.zeroOnePenalty.entries[0]!, 3)).toMatchObject({ basePenalty: count * 2, multiplier: 4, finalPenalty: count * 8 });
  });
  it('uses OUT/null and ordered BASE, with one final multiplier', () => {
    const s = penalty(3); const values = encode([0, 2, 5]);
    const next = zero(advanceFlow(s, s.revision, { type: 'startZeroOnePenalty', penaltyId: '1/zeroOnePenalty', playerId: 'b', chunkIndex: 0 }, { next: () => values.shift()! }));
    restore(next); if (next.phase !== 'zeroOnePenalty') throw Error('Penalty expected');
    expect(next.zeroOnePenalty.entries[0]).toMatchObject({ committedChunks: [dice([0, 2, 5])], basePenalty: 13 });
    expect(seriesPenaltyResult(next.zeroOnePenalty.entries[0]!, 3)!.finalPenalty).toBe(52);
  });
  it('waits after paint, cancels for confirmation, resumes fresh and never auto-starts another loser', () => {
    vi.useFakeTimers(); let calls = 0;
    const s = penalty(); const store = createGameStore({ next: () => calls++ % 2 === 0 ? 0.9 : 0.2 }, new SessionRecovery(() => memory(s)));
    const auto = createSeriesPenaltyAutoCoordinator(store);
    store.dispatch(s.revision, { type: 'startZeroOnePenalty', penaltyId: '1/zeroOnePenalty', playerId: 'b', chunkIndex: 0 });
    const ack = () => { const id = captureSeriesPenaltyPresentation(store)!; store.reveal(id.revision); auto.presented(id); };
    ack(); vi.advanceTimersByTime(1499); expect(calls).toBe(20);
    auto.setBlockingConfirmation(true); vi.advanceTimersByTime(5000); expect(calls).toBe(20);
    auto.setBlockingConfirmation(false); vi.advanceTimersByTime(1500); expect(calls).toBe(40);
    ack(); vi.advanceTimersByTime(1500); expect(calls).toBe(46); ack(); vi.advanceTimersByTime(10000); expect(calls).toBe(46);
    const current = store.getSnapshot().state;
    store.dispatch(current.revision, { type: 'nextZeroOnePenaltyLoser', penaltyId: '1/zeroOnePenalty', playerId: 'b' });
    store.presented(store.getSnapshot().state.revision); vi.advanceTimersByTime(10000); expect(calls).toBe(46);
    auto.dispose();
  });
  it('restores a running prefix, waits fresh after paint and rejects disposed / accepted-exit callbacks before draws', () => {
    vi.useFakeTimers();
    const s = penalty(); let firstCalls = 0;
    const committed = advanceFlow(s, s.revision, { type: 'startZeroOnePenalty', penaltyId: '1/zeroOnePenalty', playerId: 'b', chunkIndex: 0 }, { next: () => firstCalls++ % 2 === 0 ? 0.9 : 0.2 });
    let calls = 0;
    const store = createGameStore({ next: () => calls++ % 2 === 0 ? 0.9 : 0.2 }, new SessionRecovery(() => memory(committed)));
    const auto = createSeriesPenaltyAutoCoordinator(store);
    vi.advanceTimersByTime(9999); expect(calls).toBe(0);
    auto.presented(captureSeriesPenaltyPresentation(store)!);
    vi.advanceTimersByTime(1499); expect(calls).toBe(0);
    vi.advanceTimersByTime(1); expect(calls).toBe(20);
    const current = store.getSnapshot().state;
    store.reveal(current.revision); auto.presented(captureSeriesPenaltyPresentation(store)!);
    auto.setBlockingConfirmation(true);
    store.dispatch(current.revision, { type: 'exitGame' }); auto.setBlockingConfirmation(false);
    vi.advanceTimersByTime(9999); expect(calls).toBe(20);
    auto.dispose();
  });
  it.each(['base', 'status', 'chunkSize', 'player', 'cursor', 'futureLoser'])('rejects malformed saved penalty %s without repair', (kind) => {
    const s = penalty(3); const values = encode([0, 2, 5]);
    const state = zero(advanceFlow(s, s.revision, { type: 'startZeroOnePenalty', penaltyId: '1/zeroOnePenalty', playerId: 'b', chunkIndex: 0 }, { next: () => values.shift()! }));
    if (state.phase !== 'zeroOnePenalty') throw Error('Penalty expected');
    const invalid = { ...state, zeroOnePenalty: { ...state.zeroOnePenalty,
      currentLoserIndex: kind === 'cursor' ? 9 : 0,
      entries: state.zeroOnePenalty.entries.map((e, i) => i ? kind === 'futureLoser' ? { ...e, status: 'running' } : e : { ...e,
        ...(kind === 'base' ? { basePenalty: 99 } : kind === 'status' ? { status: 'pending' }
          : kind === 'chunkSize' ? { committedChunks: [dice(Array<number>(11).fill(2))] } : kind === 'player' ? { playerId: 'a' } : {}) }) } };
    expect(new SessionRecovery(() => memory(invalid)).loadGame()).toMatchObject({ recovered: false });
  });
});
