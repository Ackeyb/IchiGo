import { createTurn } from './gameEngine';
import { assertPlayerTurn, getRemainingDice } from './rollResolver';
import { DEFAULT_DICE_MODE, isDiceMode } from './types';
import type { DiceMode, PlayerTurn, ThrowStyle } from './types';

export type Participant = Readonly<{ id: string; name: string }>;
export type RoundPlayer = PlayerTurn & Readonly<{ id: string }>;

/** participants is the original roster in the play order fixed at game start. */
export type SuddenDeathState = Readonly<{
  participants: readonly Participant[];
  players: readonly RoundPlayer[];
  currentPlayerIndex: number;
  throwStyle: ThrowStyle;
  diceMode: DiceMode;
  totalCompletionCount: number;
  suddenDeathCount: number;
}>;

/** SPEC §29–30, §65. Never evaluate an unfinished round as a tie. */
export function shouldStartSuddenDeath(players: readonly PlayerTurn[], diceMode: DiceMode = DEFAULT_DICE_MODE): boolean {
  if (players.length < 2 || players.length > 10) return false;
  players.forEach((player) => assertPlayerTurn(player, diceMode));
  if (players.some((player) => !player.turnFinished)) return false;
  if (players.every((player) => player.completed)) return true;
  if (players.some((player) => player.completed)) return false;
  const first = players[0]!;
  return players.every((player) => player.score === first.score
    && getRemainingDice(player) === getRemainingDice(first));
}

function assertRound(state: SuddenDeathState): void {
  const ids = new Set(state.participants.map((participant) => participant.id));
  if (state.participants.length < 2 || state.participants.length > 10
    || ids.size !== state.participants.length
    || state.players.length !== ids.size
    || new Set(state.players.map((player) => player.id)).size !== ids.size
    || state.players.some((player) => !ids.has(player.id))) {
    throw new Error('The round must contain every original participant exactly once.');
  }
  if (!isDiceMode(state.diceMode)
    || !Number.isSafeInteger(state.totalCompletionCount) || state.totalCompletionCount < 0
    || !Number.isSafeInteger(state.suddenDeathCount) || state.suddenDeathCount < 0
    || !Number.isInteger(state.currentPlayerIndex) || state.currentPlayerIndex < 0
    || state.currentPlayerIndex >= state.players.length) {
    throw new RangeError('Invalid round counters or current player index.');
  }
}

/**
 * Explicit start command (SPEC §84). Apply to the latest state, with the count
 * seen when requesting the start, so duplicate/stale commands cannot reset a later round.
 * Completion counts must already be committed by the caller; reset never adds them again.
 */
export function startSuddenDeath(
  state: SuddenDeathState,
  expectedSuddenDeathCount: number,
): SuddenDeathState {
  assertRound(state);
  if (expectedSuddenDeathCount !== state.suddenDeathCount
    || !shouldStartSuddenDeath(state.players, state.diceMode)) return state;
  if (!Number.isSafeInteger(state.suddenDeathCount + 1)) {
    throw new RangeError('Sudden death counter exceeds exact numeric representation.');
  }

  // SPEC §31, §98: whitelist retained fields; never spread old player/round results.
  return {
    participants: state.participants.map(({ id, name }) => ({ id, name })),
    players: state.participants.map(({ id }) => ({
      id,
      ...createTurn({ turnId: id, totalCompletionCount: state.totalCompletionCount, diceMode: state.diceMode }, state.throwStyle).player,
    })),
    currentPlayerIndex: 0,
    throwStyle: state.throwStyle,
    diceMode: state.diceMode,
    totalCompletionCount: state.totalCompletionCount,
    suddenDeathCount: state.suddenDeathCount + 1,
  };
}
