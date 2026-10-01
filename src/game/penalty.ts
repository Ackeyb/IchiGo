import { DEFAULT_THROW_STYLE, rollGameDice } from './rollGenerator';
import type { RandomSource } from './randomSource';
import { calculateFinalRanking } from './ranking';
import { getRemainingDice } from './rollResolver';
import { shouldStartSuddenDeath } from './suddenDeath';
import type { SuddenDeathState } from './suddenDeath';
import { DEFAULT_DICE_MODE, isDiceMode } from './types';
import type { DiceMode, DieResult, DieValue, ThrowStyle } from './types';

export type PenaltyResult = Readonly<{
  penaltyRoll: readonly DieResult[];
  basePenalty: number;
  multiplier: number;
  finalPenalty: number;
}>;
export type PenaltyEntry = Readonly<{ playerId: string; diceCount: number }> & (
  | Readonly<{ status: 'pending' }>
  | (Readonly<{ status: 'resolved' }> & PenaltyResult)
);
export type PenaltyState = Readonly<{
  penaltyId: string;
  totalCompletionCount: number;
  penalties: readonly PenaltyEntry[];
}>;
export type DecisiveRound = Pick<SuddenDeathState, 'participants' | 'players' | 'totalCompletionCount' | 'diceMode'>;

function assertDiceCount(count: number, diceMode: DiceMode): void {
  if (!isDiceMode(diceMode)) throw new RangeError('Unknown dice mode.');
  if (!Number.isInteger(count) || count < 1 || count > diceMode) {
    throw new RangeError(`Penalty requires 1 to ${diceMode} dice.`);
  }
}

export function getPenaltyMultiplier(totalCompletionCount: number): number {
  if (!Number.isSafeInteger(totalCompletionCount) || totalCompletionCount < 0
    || !Number.isSafeInteger(totalCompletionCount + 1)) {
    throw new RangeError('Invalid committed completion count.');
  }
  return totalCompletionCount + 1;
}

/** v3 §3.2: OUT first, then a D6 draw only for SAFE; no normal scoring resolution. */
export function rollPenaltyDice(
  count: number, random: RandomSource, diceMode: DiceMode = DEFAULT_DICE_MODE,
  throwStyle: ThrowStyle = DEFAULT_THROW_STYLE,
): readonly DieResult[] {
  assertDiceCount(count, diceMode);
  return rollGameDice(count, throwStyle, random, diceMode);
}

/** v3 §3.3: conversion is for calculation only; authoritative OUT keeps value null. */
export function getPenaltyDieValue(die: DieResult): DieValue {
  if (typeof die === 'object' && die !== null) {
    if (die.status === 'out' && die.value === null) return 6;
    if (die.status === 'safe' && Number.isInteger(die.value) && die.value >= 1 && die.value <= 6) return die.value;
  }
  throw new RangeError('Invalid penalty die result.');
}

/** v3 §3.3–3.6: SAFE faces and OUT(6) are summed in committed order before multiplying. */
export function calculatePenalty(dice: readonly DieResult[], totalCompletionCount: number, diceMode: DiceMode = DEFAULT_DICE_MODE): PenaltyResult {
  assertDiceCount(dice.length, diceMode);
  const multiplier = getPenaltyMultiplier(totalCompletionCount);
  // Iteration visits sparse entries too; Array.some would silently skip them.
  let basePenalty = 0;
  for (const die of dice) basePenalty += getPenaltyDieValue(die);
  const finalPenalty = basePenalty * multiplier;
  if (!Number.isSafeInteger(finalPenalty)) {
    throw new RangeError('Penalty exceeds exact numeric representation.');
  }
  return { penaltyRoll: dice.map((die) => ({ ...die })), basePenalty, multiplier, finalPenalty };
}

/** Snapshot the decisive round's loser counts in the original fixed play order. */
export function createPenaltyState(round: DecisiveRound, penaltyId: string): PenaltyState {
  if (!penaltyId) throw new RangeError('Penalty requires a unique phase ID.');
  getPenaltyMultiplier(round.totalCompletionCount);
  const ids = new Set(round.participants.map(({ id }) => id));
  if (ids.size < 2 || ids.size > 10 || ids.size !== round.participants.length
    || round.players.length !== ids.size || round.players.some(({ id }) => !ids.has(id))) {
    throw new Error('Penalty requires the complete original roster.');
  }
  const { loserIds } = calculateFinalRanking(round.players, round.diceMode);
  if (shouldStartSuddenDeath(round.players, round.diceMode)) {
    throw new Error('A tied round requires sudden death, not penalties.');
  }
  const losers = new Set(loserIds);
  const playersById = new Map(round.players.map((player) => [player.id, player]));
  const penalties: PenaltyEntry[] = round.participants
    .filter(({ id }) => losers.has(id))
    .map(({ id }) => {
      const diceCount = getRemainingDice(playersById.get(id)!);
      assertDiceCount(diceCount, round.diceMode);
      return { playerId: id, diceCount, status: 'pending' };
    });
  return { penaltyId, totalCompletionCount: round.totalCompletionCount, penalties };
}

/** Apply to the latest state. Duplicate/out-of-order requests consume no randomness. */
export function rollPenalty(
  state: PenaltyState,
  playerId: string,
  random: RandomSource,
  expectedPenaltyId: string,
  diceMode: DiceMode = DEFAULT_DICE_MODE,
  throwStyle: ThrowStyle = DEFAULT_THROW_STYLE,
): PenaltyState {
  if (expectedPenaltyId !== state.penaltyId) return state;
  const index = state.penalties.findIndex((entry) => entry.status === 'pending');
  const pending = state.penalties[index];
  if (!pending || pending.playerId !== playerId) return state;
  getPenaltyMultiplier(state.totalCompletionCount);
  const result = calculatePenalty(
    rollPenaltyDice(pending.diceCount, random, diceMode, throwStyle),
    state.totalCompletionCount,
    diceMode,
  );
  const resolved: PenaltyEntry = { ...pending, status: 'resolved', ...result };
  return {
    penaltyId: state.penaltyId,
    totalCompletionCount: state.totalCompletionCount,
    penalties: state.penalties.map((entry, i) => i === index ? resolved : entry),
  };
}
