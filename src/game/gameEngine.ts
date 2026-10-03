import { DEFAULT_THROW_STYLE, OUT_PROBABILITIES, rollGameDice } from './rollGenerator';
import { assertPlayerTurn, assertRollRequest, resolveRoll } from './rollResolver';
import type { RandomSource } from './randomSource';
import { DEFAULT_DICE_MODE, isDiceMode } from './types';
import type { RollLimit, ThrowStyle, TurnContext, TurnState } from './types';

function assertContext(context: TurnContext): void {
  if (!context.turnId || !Number.isSafeInteger(context.totalCompletionCount)
    || context.totalCompletionCount < 0
    || !Number.isSafeInteger(context.totalCompletionCount + 1)) {
    throw new RangeError('A turn requires an ID and a valid cumulative completion count.');
  }
}

export function createTurn(context: TurnContext, throwStyle: ThrowStyle = DEFAULT_THROW_STYLE): TurnState {
  assertContext(context);
  if (!Object.hasOwn(OUT_PROBABILITIES, throwStyle)) {
    throw new RangeError('Unknown throw style.');
  }
  const diceMode = context.diceMode ?? DEFAULT_DICE_MODE;
  if (!isDiceMode(diceMode)) throw new RangeError('Unknown dice mode.');
  return {
    turnId: context.turnId,
    totalCompletionCount: context.totalCompletionCount,
    phase: 'ready',
    throwStyle,
    nextRollNumber: 1,
    player: {
      score: 0,
      activeDice: diceMode,
      strandedDice: 0,
      removedDice: 0,
      completed: false,
      turnFinished: false,
    },
  };
}

/** Apply the captured turn ID and roll number to the latest state; stale or out-of-order requests are rejected before randomness. */
export function rollTurn(
  state: TurnState,
  rollNumber: number,
  random: RandomSource,
  expectedTurnId: string,
  diceMode = DEFAULT_DICE_MODE,
  rollLimit: RollLimit = null,
): TurnState {
  if (expectedTurnId !== state.turnId || state.phase !== 'ready' || rollNumber !== state.nextRollNumber
    || state.player.turnFinished) {
    return state;
  }
  assertContext(state);
  assertRollRequest(rollNumber, rollLimit);
  assertPlayerTurn(state.player, diceMode);
  const dice = rollGameDice(state.player.activeDice, state.throwStyle, random, diceMode);
  const result = resolveRoll(state.player, dice, diceMode, rollNumber, rollLimit);
  // The committed result keeps this operation's rollNumber while nextRollNumber advances independently.
  return {
    turnId: state.turnId,
    // SPEC §22, §91: commit once with the completing roll, before presentation.
    totalCompletionCount: state.totalCompletionCount + (result.outcome === 'complete' ? 1 : 0),
    phase: 'result',
    throwStyle: state.throwStyle,
    nextRollNumber: state.nextRollNumber + 1,
    rollNumber,
    player: result.player,
    result,
  };
}

/** SPEC §83: enable the next explicit roll; never roll automatically. */
export function continueTurn(state: TurnState, rollNumber: number, expectedTurnId: string): TurnState {
  if (expectedTurnId !== state.turnId || state.phase !== 'result' || state.rollNumber !== rollNumber
    || state.result.outcome !== 'continue') {
    return state;
  }
  return {
    turnId: state.turnId,
    totalCompletionCount: state.totalCompletionCount,
    phase: 'ready',
    throwStyle: state.throwStyle,
    nextRollNumber: state.nextRollNumber,
    player: state.player,
  };
}
