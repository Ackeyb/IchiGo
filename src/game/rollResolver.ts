import { INITIAL_DICE } from './rollGenerator';
import type { DieResult, PlayerTurn, RollResolution } from './types';

export function getRemainingDice(player: PlayerTurn): number {
  return player.activeDice + player.strandedDice;
}

export function assertPlayerTurn(player: PlayerTurn): void {
  const counts = [player.activeDice, player.strandedDice, player.removedDice];
  if (counts.some((count) => !Number.isInteger(count) || count < 0 || count > INITIAL_DICE)
    || counts.reduce((sum, count) => sum + count, 0) !== INITIAL_DICE) {
    throw new RangeError('Dice counts must be nonnegative integers totaling 7.');
  }
  // Every removed die contributes exactly 50 or 100 points (SPEC §10–11).
  if (!Number.isInteger(player.score) || player.score % 50 !== 0
    || player.score < player.removedDice * 50 || player.score > player.removedDice * 100) {
    throw new RangeError('Score is inconsistent with removed dice.');
  }
  if (typeof player.completed !== 'boolean' || typeof player.turnFinished !== 'boolean'
    || player.completed !== (getRemainingDice(player) === 0)
    || (player.activeDice === 0 && !player.turnFinished)) {
    throw new RangeError('Completion or turn status is inconsistent with dice counts.');
  }
}

export function resolveRoll(player: PlayerTurn, dice: readonly DieResult[]): RollResolution {
  assertPlayerTurn(player);
  if (player.turnFinished || player.activeDice === 0) {
    throw new Error('The turn cannot be rolled.');
  }
  if (dice.length !== player.activeDice) {
    throw new RangeError('Roll results must match the active dice count.');
  }

  let gainedScore = 0;
  let scoringCount = 0;
  let outCount = 0;
  for (const die of dice) {
    if (die.status === 'out' && die.value === null) {
      outCount += 1;
    } else if (die.status === 'safe' && Number.isInteger(die.value)
      && die.value >= 1 && die.value <= 6) {
      if (die.value === 1 || die.value === 5) {
        gainedScore += die.value === 1 ? 100 : 50;
        scoringCount += 1;
      }
    } else {
      throw new RangeError('Invalid die result.');
    }
  }

  const activeDice = player.activeDice - outCount - scoringCount;
  const strandedDice = player.strandedDice + outCount;
  // SPEC §63: complete, no active dice, scoring, then no-score termination.
  const outcome = activeDice === 0 && strandedDice === 0 ? 'complete'
    : activeDice === 0 ? 'turnEnd'
      : scoringCount > 0 ? 'continue' : 'turnEnd';
  const nextPlayer: PlayerTurn = {
    score: player.score + gainedScore,
    activeDice,
    strandedDice,
    removedDice: player.removedDice + scoringCount,
    completed: outcome === 'complete',
    turnFinished: outcome !== 'continue',
  };
  return {
    player: nextPlayer,
    dice: dice.map((die) => ({ ...die })),
    gainedScore,
    scoringCount,
    outCount,
    outcome,
  };
}
