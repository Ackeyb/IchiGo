import { describe, expect, it } from 'vitest';
import { continueTurn, createTurn, rollTurn } from '../../src/game/gameEngine';
import { advanceFlow, initialFlow } from '../../src/game/gameFlow';
import type { FlowAction, FlowState } from '../../src/game/gameFlow';
import { calculateFinalRanking } from '../../src/game/ranking';
import { getRemainingDice, resolveRoll } from '../../src/game/rollResolver';
import { initialSetup, validateSetupDraft } from '../../src/game/setup';
import { DEFAULT_ROLL_LIMIT, isRollLimit } from '../../src/game/types';
import type { DieResult, DieValue, RollLimit } from '../../src/game/types';

const safe = (value: DieValue): DieResult => ({ status: 'safe', value });
const out: DieResult = { status: 'out', value: null };
const dice = (...values: DieValue[]) => values.map(safe);
const initial = () => createTurn({ turnId: 'limit-turn', totalCompletionCount: 0 });
const setup = { ...initialSetup(), participants: [{ id: 'b', name: 'B' }, { id: 'a', name: 'A' }], rollLimit: 3 as const };

class Sequence {
  calls = 0;
  constructor(private readonly values: readonly number[] = []) {}
  next() {
    const value = this.values[this.calls++];
    if (value === undefined) throw new Error('Unexpected random draw');
    return value;
  }
}
const faces = (...values: DieValue[]) => new Sequence(values.flatMap((value) => [0.9, (value - 0.5) / 6]));
const act = (state: FlowState, action: FlowAction, random = new Sequence()) => advanceFlow(state, state.revision, action, random);

describe('RollLimit domain', () => {
  it.each([null, 1, 2, 3, 4, 5])('accepts only an explicit allowed limit %s', (value) => {
    expect(isRollLimit(value)).toBe(true);
    expect(validateSetupDraft({ ...setup, rollLimit: value })).toBe(true);
  });
  it.each([undefined, 0, -1, 6, 14, 1.5, NaN, Infinity, -Infinity, '3', '∞', true, {}, []])('rejects %s', (value) => {
    expect(isRollLimit(value)).toBe(false);
    expect(validateSetupDraft({ ...setup, rollLimit: value })).toBe(false);
  });
  it('defaults to unlimited without storing a per-turn or per-player limit/counter', () => {
    expect(DEFAULT_ROLL_LIMIT).toBeNull();
    expect(initialSetup()).toMatchObject({ rollLimit: null, diceMode: 7, throwStyle: 'normal' });
    expect(initial()).not.toHaveProperty('rollLimit');
    expect(initial()).not.toHaveProperty('rollsUsed');
    expect(initial().player).not.toHaveProperty('rollLimit');
  });
});

describe('authoritative turn resolution', () => {
  it('ends a scoring, incomplete first roll at limit 1', () => {
    const result = resolveRoll(initial().player, dice(1, 2, 2, 2, 2, 2, 2), 7, 1, 1);
    expect(result).toMatchObject({ outcome: 'turnEnd', reason: 'rollLimit', player: { score: 100, activeDice: 6, removedDice: 1, turnFinished: true } });
  });
  it('prioritizes COMPLETE on the final permitted roll and commits completion only once', () => {
    const random = faces(1, 1, 1, 1, 1, 1, 1);
    const result = rollTurn(initial(), 1, random, 'limit-turn', 7, 1);
    if (result.phase !== 'result') throw new Error('Expected result');
    expect(result.result.outcome).toBe('complete');
    expect(result.result).not.toHaveProperty('reason');
    expect(result.totalCompletionCount).toBe(1);
    expect(rollTurn(result, 1, random, result.turnId, 7, 1)).toBe(result);
    expect(random.calls).toBe(14);
  });
  it.each([{ results: dice(2, 2, 2, 2, 2, 2, 2) }, { results: Array<DieResult>(7).fill(out) }])('prioritizes no-score over limit and no-active', ({ results }) => {
    expect(resolveRoll(initial().player, results, 7, 1, 1)).toMatchObject({ outcome: 'turnEnd', reason: 'noScore' });
  });
  it('continues rolls 1 and 2, then ends roll 3 with committed score and dice', () => {
    const first = rollTurn(initial(), 1, faces(1, 2, 2, 2, 2, 2, 2), 'limit-turn', 7, 3);
    expect(first).toMatchObject({ nextRollNumber: 2, rollNumber: 1, result: { outcome: 'continue' } });
    const second = rollTurn(continueTurn(first, 1, 'limit-turn'), 2, faces(5, 2, 2, 2, 2, 2), 'limit-turn', 7, 3);
    expect(second).toMatchObject({ nextRollNumber: 3, rollNumber: 2, result: { outcome: 'continue' } });
    const third = rollTurn(continueTurn(second, 2, 'limit-turn'), 3, faces(1, 2, 2, 2, 2), 'limit-turn', 7, 3);
    expect(third).toMatchObject({ nextRollNumber: 4, rollNumber: 3, result: { outcome: 'turnEnd', reason: 'rollLimit' }, player: { score: 250, removedDice: 3, activeDice: 4 } });
    expect(continueTurn(third, 3, 'limit-turn')).toBe(third);
  });
  it('commits 1, OUT, 3 on roll 3 before ending for the limit', () => {
    const player = { ...initial().player, score: 400, removedDice: 4, activeDice: 3 };
    const result = resolveRoll(player, [safe(1), out, safe(3)], 7, 3, 3);
    expect(result).toMatchObject({ outcome: 'turnEnd', reason: 'rollLimit', gainedScore: 100, scoringCount: 1, outCount: 1 });
    expect(result.player).toEqual({ score: 500, removedDice: 5, strandedDice: 1, activeDice: 1, completed: false, turnFinished: true });
    expect(getRemainingDice(result.player)).toBe(2);
  });
  it('prioritizes the limit over no-active while unlimited retains noActiveDice', () => {
    const player = { ...initial().player, score: 500, removedDice: 5, activeDice: 2 };
    expect(resolveRoll(player, [safe(5), out], 7, 3, 3)).toMatchObject({ outcome: 'turnEnd', reason: 'rollLimit' });
    expect(resolveRoll(player, [safe(5), out], 7, 3, null)).toMatchObject({ outcome: 'turnEnd', reason: 'noActiveDice' });
  });
  it.each([null, 4, 5] as const)('continues roll 3 when the limit is %s', (limit) => {
    const result = resolveRoll(initial().player, dice(1, 2, 2, 2, 2, 2, 2), 7, 3, limit);
    expect(result.outcome).toBe('continue');
    expect(result).not.toHaveProperty('reason');
  });
  it('rejects an over-limit request before any random draw', () => {
    const ready = { ...initial(), nextRollNumber: 4 };
    const random = new Sequence();
    expect(() => rollTurn(ready, 4, random, ready.turnId, 7, 3)).toThrow(RangeError);
    expect(() => resolveRoll(ready.player, dice(1, 2, 2, 2, 2, 2, 2), 7, 4, 3)).toThrow(RangeError);
    expect(random.calls).toBe(0);
  });
  it('rejects ended, stale ID and stale number requests without consuming randomness', () => {
    const ended = rollTurn(initial(), 1, faces(1, 2, 2, 2, 2, 2, 2), 'limit-turn', 7, 1);
    const random = new Sequence();
    expect(rollTurn(ended, 2, random, ended.turnId, 7, 1)).toBe(ended);
    expect(rollTurn(initial(), 1, random, 'old-turn', 7, 3)).toEqual(initial());
    const ready = initial();
    expect(rollTurn(ready, 2, random, ready.turnId, 7, 3)).toBe(ready);
    expect(random.calls).toBe(0);
  });
  it('does not use limit or roll number as a ranking tiebreaker', () => {
    const first = resolveRoll(initial().player, dice(1, 2, 2, 2, 2, 2, 2), 7, 1, 1);
    const third = resolveRoll(initial().player, dice(1, 2, 2, 2, 2, 2, 2), 7, 3, 3);
    expect(calculateFinalRanking([{ id: 'a', ...first.player }, { id: 'b', ...third.player }]).rankings)
      .toEqual([{ playerId: 'a', rank: 1 }, { playerId: 'b', rank: 1 }]);
  });
});

describe('Flow configuration ownership and carry-over', () => {
  it('recognizes a rollLimit-only setup edit and starts with that setting', () => {
    const edited = act(initialFlow(), { type: 'updateSetup', draft: { ...initialSetup(), rollLimit: 2 } });
    expect(edited).toMatchObject({ revision: 1, draft: { rollLimit: 2 } });
    const started = act(edited, { type: 'start', setup: { ...setup, rollLimit: 2 } });
    expect(started).toMatchObject({ game: { rollLimit: 2 }, turn: { nextRollNumber: 1 } });
  });
  it('maintains the limit, order and cumulative completions through sudden death; each turn starts at 1', () => {
    let state = act(initialFlow(), { type: 'start', setup: { ...setup, rollLimit: 1 } });
    state = act(state, { type: 'roll' }, faces(1, 1, 1, 1, 1, 1, 1));
    state = act(state, { type: 'next' });
    expect(state).toMatchObject({ turn: { nextRollNumber: 1 } });
    state = act(state, { type: 'roll' }, faces(1, 1, 1, 1, 1, 1, 1));
    for (const type of ['ranking', 'suddenDeath', 'startSuddenDeath'] as const) state = act(state, { type });
    expect(state).toMatchObject({ phase: 'turn', game: { rollLimit: 1, diceMode: 7, throwStyle: 'normal', participants: setup.participants, totalCompletionCount: 2 }, turn: { nextRollNumber: 1 } });
  });
  it.each([null, 1, 2, 3, 4, 5] as readonly RollLimit[])('carries %s through replay and new game; full reset restores null', (rollLimit) => {
    let finished = act(initialFlow(), { type: 'start', setup: { ...setup, rollLimit } });
    finished = act(finished, { type: 'roll' }, faces(1, 1, 1, 1, 1, 1, 1));
    finished = act(finished, { type: 'next' });
    finished = act(finished, { type: 'roll' }, faces(2, 2, 2, 2, 2, 2, 2));
    for (const type of ['ranking', 'reveal', 'penalty'] as const) finished = act(finished, { type });
    finished = act(finished, { type: 'rollPenalty' }, new Sequence(Array<number>(7).fill(0)));
    finished = act(finished, { type: 'finish' });
    expect(finished.phase).toBe('finished');
    const replay = act(finished, { type: 'replay' });
    expect(replay).toMatchObject({ draft: { rollLimit }, replaySource: { rollLimit } });
    const reordered = act(replay, { type: 'reorderReplay', participantIds: ['a', 'b'] });
    expect(act(reordered, { type: 'updateSetup', draft: { ...setup, rollLimit: rollLimit === 1 ? 2 : 1 } })).toBe(reordered);
    expect(act(reordered, { type: 'startReplay' })).toMatchObject({ game: { rollLimit }, turn: { nextRollNumber: 1 } });
    const newGame = act(finished, { type: 'newGame' });
    expect(newGame).toMatchObject({ phase: 'setup', draft: { rollLimit } });
    expect(act(newGame, { type: 'fullReset' })).toMatchObject({ draft: { rollLimit: null, diceMode: 7, throwStyle: 'normal' } });
  });
  it('uses the engine limit and rejects ended/stale Flow ROLL requests without draws', () => {
    const started = act(initialFlow(), { type: 'start', setup: { ...setup, rollLimit: 1 } });
    const ended = act(started, { type: 'roll' }, faces(1, 2, 2, 2, 2, 2, 2));
    expect(ended).toMatchObject({ turn: { result: { outcome: 'turnEnd', reason: 'rollLimit' } } });
    const random = new Sequence();
    expect(act(ended, { type: 'roll' }, random)).toBe(ended);
    expect(advanceFlow(ended, started.revision, { type: 'roll' }, random)).toBe(ended);
    expect(random.calls).toBe(0);
  });
});
