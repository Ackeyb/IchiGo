import { nextRandom } from './randomSource';
import type { RandomSource } from './randomSource';
import { calculateFinalRanking } from './ranking';
import { getRemainingDice } from './rollResolver';
import { shouldStartSuddenDeath } from './suddenDeath';
import type { SuddenDeathState } from './suddenDeath';
import { DEFAULT_DICE_MODE, isDiceMode } from './types';
import type { DiceMode, DieValue } from './types';

export type PenaltyResult = Readonly<{
  penaltyRoll: readonly DieValue[];
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

/** SPEC §35: exactly one D6 draw per die, with no OUT or normal scoring rules. */
export function rollPenaltyDice(count: number, random: RandomSource, diceMode: DiceMode = DEFAULT_DICE_MODE): readonly DieValue[] {
  assertDiceCount(count, diceMode);
  return Array.from({ length: count }, () => (Math.floor(nextRandom(random) * 6) + 1) as DieValue);
}

/** SPEC §36, §66: all faces, including 1 and 5, contribute only their face value. */
export function calculatePenalty(dice: readonly DieValue[], totalCompletionCount: number, diceMode: DiceMode = DEFAULT_DICE_MODE): PenaltyResult {
  assertDiceCount(dice.length, diceMode);
  const multiplier = getPenaltyMultiplier(totalCompletionCount);
  // Iteration visits sparse entries too; Array.some would silently skip them.
  for (const value of dice) {
    if (!Number.isInteger(value) || value < 1 || value > 6) {
      throw new RangeError('Penalty results must be D6 values.');
    }
  }
  const basePenalty = dice.reduce<number>((sum, value) => sum + value, 0);
  const finalPenalty = basePenalty * multiplier;
  if (!Number.isSafeInteger(finalPenalty)) {
    throw new RangeError('Penalty exceeds exact numeric representation.');
  }
  return { penaltyRoll: [...dice], basePenalty, multiplier, finalPenalty };
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
): PenaltyState {
  if (expectedPenaltyId !== state.penaltyId) return state;
  const index = state.penalties.findIndex((entry) => entry.status === 'pending');
  const pending = state.penalties[index];
  if (!pending || pending.playerId !== playerId) return state;
  getPenaltyMultiplier(state.totalCompletionCount);
  const result = calculatePenalty(
    rollPenaltyDice(pending.diceCount, random, diceMode),
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
