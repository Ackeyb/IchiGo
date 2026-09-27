import { DEFAULT_THROW_STYLE, INITIAL_DICE, OUT_PROBABILITIES, rollGameDice } from './rollGenerator';
import { assertPlayerTurn, resolveRoll } from './rollResolver';
import type { RandomSource } from './randomSource';
import type { ThrowStyle, TurnContext, TurnState } from './types';

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
  return {
    turnId: context.turnId,
    totalCompletionCount: context.totalCompletionCount,
    phase: 'ready',
    throwStyle,
    nextRollNumber: 1,
    player: {
      score: 0,
      activeDice: INITIAL_DICE,
      strandedDice: 0,
      removedDice: 0,
      completed: false,
      turnFinished: false,
    },
  };
}

/** Apply to the caller's latest state. Rejected commands consume no randomness. */
export function rollTurn(state: TurnState, rollNumber: number, random: RandomSource, expectedTurnId: string): TurnState {
  if (expectedTurnId !== state.turnId || state.phase !== 'ready' || rollNumber !== state.nextRollNumber
    || state.player.turnFinished) {
    return state;
  }
  assertContext(state);
  assertPlayerTurn(state.player);
  const dice = rollGameDice(state.player.activeDice, state.throwStyle, random);
  const result = resolveRoll(state.player, dice);
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
