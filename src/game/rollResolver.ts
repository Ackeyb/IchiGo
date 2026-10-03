import { DEFAULT_DICE_MODE, isDiceMode, isRollLimit } from './types';
import type { DiceMode, DieResult, PlayerTurn, RollLimit, RollOutcome, RollResolution } from './types';

export function getRemainingDice(player: PlayerTurn): number {
  return player.activeDice + player.strandedDice;
}

export function assertPlayerTurn(player: PlayerTurn, diceMode: DiceMode = DEFAULT_DICE_MODE): void {
  if (!isDiceMode(diceMode)) throw new RangeError('Unknown dice mode.');
  // diceMode is authoritative; the three buckets must account for every die without inferring a mode from counts.
  const counts = [player.activeDice, player.strandedDice, player.removedDice];
  if (counts.some((count) => !Number.isInteger(count) || count < 0 || count > diceMode)
    || counts.reduce((sum, count) => sum + count, 0) !== diceMode) {
    throw new RangeError(`Dice counts must be nonnegative integers totaling ${diceMode}.`);
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

export function assertRollRequest(rollNumber: number, rollLimit: RollLimit): void {
  if (!isRollLimit(rollLimit) || !Number.isSafeInteger(rollNumber) || rollNumber < 1
    || (rollLimit !== null && rollNumber > rollLimit)) {
    throw new RangeError('Invalid roll number or roll limit.');
  }
}

export function resolveRoll(
  player: PlayerTurn, dice: readonly DieResult[], diceMode: DiceMode = DEFAULT_DICE_MODE,
  rollNumber = 1, rollLimit: RollLimit = null,
): RollResolution {
  assertRollRequest(rollNumber, rollLimit);
  assertPlayerTurn(player, diceMode);
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
  // Classify termination only after calculating this roll's score and dice changes.
  // Priority is contractual: COMPLETE > no-score > ROLL limit > no active dice > continue.
  // In particular, no-score wins over the limit, and the limit wins over no active dice.
  const ending: RollOutcome = activeDice === 0 && strandedDice === 0
    ? { outcome: 'complete' }
    : scoringCount === 0 ? { outcome: 'turnEnd', reason: 'noScore' }
      : rollLimit !== null && rollNumber === rollLimit ? { outcome: 'turnEnd', reason: 'rollLimit' }
        : activeDice === 0 ? { outcome: 'turnEnd', reason: 'noActiveDice' }
          : { outcome: 'continue' };
  const nextPlayer: PlayerTurn = {
    score: player.score + gainedScore,
    activeDice,
    strandedDice,
    removedDice: player.removedDice + scoringCount,
    completed: ending.outcome === 'complete',
    turnFinished: ending.outcome !== 'continue',
  };
  return {
    player: nextPlayer,
    dice: dice.map((die) => ({ ...die })),
    gainedScore,
    scoringCount,
    outCount,
    ...ending,
  };
}
