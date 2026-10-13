import { rollGameDice } from './rollGenerator';
import type { RandomSource } from './randomSource';
import type { Participant } from './suddenDeath';
import type { DiceMode, DieResult, ThrowStyle } from './types';

export type ZeroOnePreset = 350 | 500 | 700 | 1000;
export const isZeroOnePreset = (value: unknown): value is ZeroOnePreset => value === 350 || value === 500 || value === 700 || value === 1000;
export function zeroOneDiceCount(preset: ZeroOnePreset): DiceMode {
  if (!isZeroOnePreset(preset)) throw new RangeError('Unknown Zero-One preset.');
  return ({ 350: 5, 500: 7, 700: 10, 1000: 14 } as const)[preset];
}
export type ZeroOnePlayer = Readonly<{
  id: string; remainingScore: number; activeDice: number; strandedDice: number; removedDice: number;
  accumulatedTurnCount: number; isCleared: boolean; cleanClearEligible: boolean;
}>;
export type ZeroOneGame = Readonly<{
  mode: Readonly<{ type: 'zeroOne'; preset: ZeroOnePreset }>;
  participants: readonly Participant[]; throwStyle: ThrowStyle; players: readonly ZeroOnePlayer[];
  currentPlayerIndex: number; suddenDeathCount: number; totalCleanClearCount: number;
}>;
export type ZeroOneRoll = Readonly<{
  before: ZeroOnePlayer; player: ZeroOnePlayer; dice: readonly DieResult[];
  rollScore: number; outcome: 'clear' | 'bust' | 'short' | 'turnEnd'; cleanClear: boolean;
}>;
export function createZeroOnePlayer(id: string, preset: ZeroOnePreset): ZeroOnePlayer {
  return { id, remainingScore: preset, activeDice: zeroOneDiceCount(preset), strandedDice: 0, removedDice: 0,
    accumulatedTurnCount: 0, isCleared: false, cleanClearEligible: true };
}
export function assertZeroOnePlayer(player: ZeroOnePlayer, preset: ZeroOnePreset): void {
  const counts = [player.activeDice, player.strandedDice, player.removedDice];
  if (!player.id || counts.some((n) => !Number.isSafeInteger(n) || n < 0)
    || counts.reduce((a, b) => a + b, 0) !== zeroOneDiceCount(preset)
    || !Number.isSafeInteger(player.remainingScore) || player.remainingScore < 0 || player.remainingScore > preset
    || player.remainingScore % 50 !== 0 || !Number.isSafeInteger(player.accumulatedTurnCount) || player.accumulatedTurnCount < 0
    || typeof player.isCleared !== 'boolean' || typeof player.cleanClearEligible !== 'boolean'
    || player.isCleared !== (player.remainingScore === 0)
    || (!player.isCleared && (player.activeDice === 0 || isZeroOneShort(player.remainingScore, player.activeDice)))
    || preset - player.remainingScore < player.removedDice * 50 || preset - player.remainingScore > player.removedDice * 100) {
    throw new RangeError('Invalid Zero-One player.');
  }
}
export const isZeroOneShort = (remaining: number, active: number): boolean => remaining > active * 100;

/** Resolve against the pre-Turn snapshot; Bust never commits temporary removals. Short does not renew eligibility. */
export function resolveZeroOneRoll(before: ZeroOnePlayer, dice: readonly DieResult[], preset: ZeroOnePreset): ZeroOneRoll {
  assertZeroOnePlayer(before, preset);
  if (before.isCleared || dice.length !== before.activeDice) throw new Error('Zero-One Turn cannot roll.');
  let rollScore = 0, scoring = 0, out = 0;
  for (const die of dice) {
    if (die.status === 'out' && die.value === null) out++;
    else if (die.status === 'safe' && Number.isInteger(die.value) && die.value >= 1 && die.value <= 6) {
      if (die.value === 1 || die.value === 5) { rollScore += die.value === 1 ? 100 : 50; scoring++; }
    } else throw new RangeError('Invalid die.');
  }
  const count = before.accumulatedTurnCount + 1;
  if (!Number.isSafeInteger(count)) throw new RangeError('Turn count overflow.');
  let player: ZeroOnePlayer = { ...before, accumulatedTurnCount: count };
  let outcome: ZeroOneRoll['outcome'];
  // Clear > Bust > Short > ordinary end is independent of Normal's continuation policy.
  if (rollScore > before.remainingScore) { outcome = 'bust'; player = { ...player, cleanClearEligible: false }; }
  else {
    player = { ...player, remainingScore: before.remainingScore - rollScore, activeDice: before.activeDice - scoring - out,
      removedDice: before.removedDice + scoring, strandedDice: before.strandedDice + out };
    if (player.remainingScore === 0) { outcome = 'clear'; player = { ...player, isCleared: true }; }
    else if (isZeroOneShort(player.remainingScore, player.activeDice)) {
      outcome = 'short'; player = { ...createZeroOnePlayer(before.id, preset), accumulatedTurnCount: count, cleanClearEligible: false };
    } else outcome = 'turnEnd';
  }
  assertZeroOnePlayer(player, preset);
  return { before: { ...before }, player, dice: dice.map((die) => ({ ...die })), rollScore, outcome,
    cleanClear: outcome === 'clear' && before.cleanClearEligible };
}
export function rollZeroOne(game: ZeroOneGame, random: RandomSource): ZeroOneRoll {
  const player = game.players[game.currentPlayerIndex]!;
  assertZeroOnePlayer(player, game.mode.preset);
  if (player.isCleared) throw new Error('Cleared player cannot roll.');
  return resolveZeroOneRoll(player, rollGameDice(player.activeDice, game.throwStyle, random, zeroOneDiceCount(game.mode.preset)), game.mode.preset);
}
export function nextZeroOnePlayer(game: ZeroOneGame): number | undefined {
  for (let offset = 1; offset <= game.players.length; offset++) {
    const index = (game.currentPlayerIndex + offset) % game.players.length;
    if (!game.players[index]!.isCleared) return index;
  }
  return undefined;
}
export function resetZeroOneSuddenDeath(game: ZeroOneGame): ZeroOneGame {
  if (!game.players.every((p) => p.isCleared) || new Set(game.players.map((p) => p.accumulatedTurnCount)).size !== 1) return game;
  if (!Number.isSafeInteger(game.suddenDeathCount + 1)) throw new RangeError('Sudden Death overflow.');
  return { ...game, currentPlayerIndex: 0, suddenDeathCount: game.suddenDeathCount + 1,
    players: game.players.map((p) => ({ ...createZeroOnePlayer(p.id, game.mode.preset), accumulatedTurnCount: p.accumulatedTurnCount })) };
}
