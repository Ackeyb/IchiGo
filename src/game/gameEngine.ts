import { DEFAULT_THROW_STYLE, INITIAL_DICE, OUT_PROBABILITIES, rollGameDice } from './rollGenerator';
import { assertPlayerTurn, resolveRoll } from './rollResolver';
import type { RandomSource } from './randomSource';
import type { ThrowStyle, TurnState } from './types';

export function createTurn(throwStyle: ThrowStyle = DEFAULT_THROW_STYLE): TurnState {
  if (!Object.hasOwn(OUT_PROBABILITIES, throwStyle)) {
    throw new RangeError('Unknown throw style.');
  }
  return {
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
export function rollTurn(state: TurnState, rollNumber: number, random: RandomSource): TurnState {
  if (state.phase !== 'ready' || rollNumber !== state.nextRollNumber
    || state.player.turnFinished) {
    return state;
  }
  assertPlayerTurn(state.player);
  const dice = rollGameDice(state.player.activeDice, state.throwStyle, random);
  const result = resolveRoll(state.player, dice);
  return {
    phase: 'result',
    throwStyle: state.throwStyle,
    nextRollNumber: state.nextRollNumber + 1,
    rollNumber,
    player: result.player,
    result,
  };
}

/** SPEC §83: enable the next explicit roll; never roll automatically. */
export function continueTurn(state: TurnState, rollNumber: number): TurnState {
  if (state.phase !== 'result' || state.rollNumber !== rollNumber
    || state.result.outcome !== 'continue') {
    return state;
  }
  return {
    phase: 'ready',
    throwStyle: state.throwStyle,
    nextRollNumber: state.nextRollNumber,
    player: state.player,
  };
}
