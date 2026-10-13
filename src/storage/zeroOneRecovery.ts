import { validateSetup } from '../game/setup';
import { isGameMode } from '../game/types';
import type { DieResult } from '../game/types';
import { assertZeroOnePlayer, resolveZeroOneRoll, zeroOneDiceCount } from '../game/zeroOne';
import type { ZeroOneGame, ZeroOnePlayer, ZeroOneRoll } from '../game/zeroOne';
import { calculateZeroOneRanking } from '../game/zeroOneRanking';
import { createZeroOnePenalty } from '../game/zeroOnePenalty';
import { seriesChunkBase, seriesPenaltyResult } from '../game/seriesPenalty';
import type { SeriesPenaltyEntry } from '../game/seriesPenalty';

const record = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const count = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0;
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
function die(v: unknown): v is DieResult {
  return record(v) && (v.status === 'out' ? v.value === null : v.status === 'safe' && Number.isInteger(v.value) && Number(v.value) >= 1 && Number(v.value) <= 6);
}
function player(v: unknown, game: ZeroOneGame): v is ZeroOnePlayer {
  if (!record(v) || typeof v.id !== 'string') return false;
  try {
    assertZeroOnePlayer(v as ZeroOnePlayer, game.mode.preset);
    return game.throwStyle !== 'careful' || v.strandedDice === 0;
  } catch { return false; }
}
/** Validate snapshots and committed chunks without generating, repairing or replaying historical Turns. */
export function validateZeroOneRecovery(value: Record<string, unknown>): boolean {
  try {
    if (!record(value.game) || !isGameMode(value.game.mode) || value.game.mode.type !== 'zeroOne') return false;
    const raw = value.game;
    if (value.turn !== undefined || value.penalty !== undefined || value.seriesPenalty !== undefined
      || raw.cumulative !== undefined || raw.currentGameNumber !== undefined || raw.completionTargetRound !== undefined) return false;
    if (!Array.isArray(raw.players) || !Array.isArray(raw.participants)
      || !count(raw.totalCleanClearCount) || !count(raw.suddenDeathCount) || !count(raw.currentPlayerIndex)
      || raw.currentPlayerIndex >= raw.players.length || raw.suddenDeathCount > Number(value.revision)
      || raw.totalCompletionCount !== undefined || raw.diceMode !== undefined || raw.rollLimit !== undefined
      || !validateSetup({ participants: raw.participants as never, throwStyle: raw.throwStyle as never,
        mode: value.game.mode, rollLimit: null, diceMode: zeroOneDiceCount(value.game.mode.preset) })
      || raw.participants.some((p) => !record(p) || typeof p.name !== 'string' || p.name !== p.name.trim())
      || raw.players.length !== raw.participants.length) return false;
    const game = raw as unknown as ZeroOneGame;
    if (raw.players.some((p, i) => !player(p, game) || p.id !== game.participants[i]!.id || p.accumulatedTurnCount > Number(value.revision)
      || p.accumulatedTurnCount < game.suddenDeathCount
      || (p.accumulatedTurnCount === 0 && (!p.cleanClearEligible || p.activeDice !== zeroOneDiceCount(game.mode.preset) || p.remainingScore !== game.mode.preset))
      || (p.isCleared && p.accumulatedTurnCount <= game.suddenDeathCount))) return false;
    const currentClean = game.players.filter((p) => p.isCleared && p.cleanClearEligible).length;
    const maxClean = game.players.length * (game.suddenDeathCount + 1);
    if (!Number.isSafeInteger(maxClean) || game.totalCleanClearCount < currentClean || game.totalCleanClearCount > maxClean
      || game.totalCleanClearCount - currentClean > game.players.length * game.suddenDeathCount) return false;
    if (value.phase === 'zeroOneTurn') {
      if (value.ranking !== undefined || value.zeroOnePenalty !== undefined) return false;
      const current = game.players[game.currentPlayerIndex]!;
      if (value.result === undefined) return !current.isCleared;
      if (!record(value.result) || !player(value.result.before, game) || !Array.isArray(value.result.dice)
        || !value.result.dice.every(die) || value.result.before.id !== current.id
        || (game.throwStyle === 'careful' && value.result.dice.some((d) => d.status === 'out'))) return false;
      const result = value.result as unknown as ZeroOneRoll;
      return same(result.player, current) && same(resolveZeroOneRoll(result.before, result.dice, game.mode.preset), result);
    }
    if (!game.players.every((p) => p.isCleared) || value.result !== undefined) return false;
    const ranking = calculateZeroOneRanking(game.players);
    if (ranking.rankings.every((r) => r.rank === 1) || !same(value.ranking, ranking)) return false;
    if (value.phase === 'zeroOneRanking') return value.zeroOnePenalty === undefined;
    if (value.phase !== 'zeroOnePenalty' && value.phase !== 'zeroOneFinished') return false;
    const penalty = value.zeroOnePenalty;
    const expected = createZeroOnePenalty(game, `${value.gameNumber}/zeroOnePenalty`);
    if (!record(penalty) || penalty.penaltyId !== expected.penaltyId || !Array.isArray(penalty.entries)
      || penalty.entries.length !== expected.entries.length || !count(penalty.currentLoserIndex)
      || penalty.currentLoserIndex >= penalty.entries.length) return false;
    const cursor = penalty.currentLoserIndex;
    const entries = penalty.entries;
    return entries.every((e: unknown, i: number) => {
      const source = expected.entries[i]!;
      if (!record(e) || e.playerId !== source.playerId || e.totalDice !== source.totalDice
        || !Array.isArray(e.committedChunks) || !count(e.basePenalty) || e.multiplier !== undefined || e.finalPenalty !== undefined) return false;
      const chunks = e.committedChunks;
      const total = Math.ceil(source.totalDice / 10);
      if (chunks.length > total) return false;
      let base = 0;
      for (let j = 0; j < chunks.length; j++) {
        const chunk: unknown = chunks[j];
        if (!Array.isArray(chunk) || chunk.length !== Math.min(10, source.totalDice - j * 10)
          || !chunk.every(die) || (game.throwStyle === 'careful' && chunk.some((d) => d.status === 'out'))) return false;
        base += seriesChunkBase(chunk);
      }
      if (base !== e.basePenalty) return false;
      const status = chunks.length === total ? 'resolved' : chunks.length ? 'running' : 'pending';
      if (e.status !== status || (i < cursor && status !== 'resolved') || (i > cursor && status !== 'pending')) return false;
      if (status === 'resolved') seriesPenaltyResult(e as SeriesPenaltyEntry, game.totalCleanClearCount);
      return value.phase !== 'zeroOneFinished' || (cursor === entries.length - 1 && status === 'resolved');
    });
  } catch { return false; }
}
