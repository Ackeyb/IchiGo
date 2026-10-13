import { createZeroOnePlayer, nextZeroOnePlayer, resetZeroOneSuddenDeath, rollZeroOne } from './zeroOne';
import type { ZeroOneGame, ZeroOneRoll } from './zeroOne';
import { calculateZeroOneRanking } from './zeroOneRanking';
import { createZeroOnePenalty } from './zeroOnePenalty';
import { commitSeriesPenaltyChunk, nextSeriesPenaltyLoser } from './seriesPenalty';
import type { SeriesPenaltyState } from './seriesPenalty';
import type { FinalRanking } from './ranking';
import type { Setup } from './setup';
import type { FlowAction } from './gameFlow';
import type { RandomSource } from './randomSource';

type Base = Readonly<{ revision: number; gameNumber: number; game: ZeroOneGame }>;
export type ZeroOneFlowState =
  | (Base & Readonly<{ phase: 'zeroOneTurn'; result?: ZeroOneRoll }>)
  | (Base & Readonly<{ phase: 'zeroOneRanking'; ranking: FinalRanking }>)
  | (Base & Readonly<{ phase: 'zeroOnePenalty' | 'zeroOneFinished'; ranking: FinalRanking; zeroOnePenalty: SeriesPenaltyState }>);
export function isZeroOneFlow(state: { phase: string }): state is ZeroOneFlowState {
  return ['zeroOneTurn', 'zeroOneRanking', 'zeroOnePenalty', 'zeroOneFinished'].includes(state.phase);
}
export function startZeroOne(setup: Setup, revision: number, gameNumber: number): ZeroOneFlowState {
  if (setup.mode.type !== 'zeroOne') throw new Error('Zero-One configuration required.');
  const { preset } = setup.mode;
  const participants = setup.participants.map((p) => ({ ...p, name: p.name.trim() }));
  return { phase: 'zeroOneTurn', revision, gameNumber, game: { mode: setup.mode, participants, throwStyle: setup.throwStyle,
    players: participants.map((p) => createZeroOnePlayer(p.id, preset)),
    currentPlayerIndex: 0, suddenDeathCount: 0, totalCleanClearCount: 0 } };
}
/** A result ends one Turn, not the player's entire game. NEXT rotates only after presentation unlock. */
export function advanceZeroOne(state: ZeroOneFlowState, action: FlowAction, random: RandomSource): ZeroOneFlowState {
  const { game } = state;
  if (state.phase === 'zeroOneTurn') {
    if (action.type === 'roll' && !state.result) {
      const result = rollZeroOne(game, random);
      const totalCleanClearCount = game.totalCleanClearCount + Number(result.cleanClear);
      if (!Number.isSafeInteger(totalCleanClearCount)) throw new RangeError('Clean Clear count overflow.');
      return { ...state, result, game: { ...game, totalCleanClearCount,
        players: game.players.map((p) => p.id === result.player.id ? result.player : p) } };
    }
    if (!state.result) return state;
    const next = nextZeroOnePlayer(game);
    if (action.type === 'next' && next !== undefined) {
      return { phase: 'zeroOneTurn', revision: state.revision, gameNumber: state.gameNumber, game: { ...game, currentPlayerIndex: next } };
    }
    if (next !== undefined) return state;
    const ranking = calculateZeroOneRanking(game.players);
    const tied = ranking.rankings.every((r) => r.rank === 1);
    if (action.type === 'startSuddenDeath' && tied) return { phase: 'zeroOneTurn', revision: state.revision,
      gameNumber: state.gameNumber, game: resetZeroOneSuddenDeath(game) };
    if (action.type === 'ranking' && !tied) return { phase: 'zeroOneRanking', revision: state.revision, gameNumber: state.gameNumber, game, ranking };
    return state;
  }
  if (state.phase === 'zeroOneRanking') return action.type === 'penalty'
    ? { ...state, phase: 'zeroOnePenalty', zeroOnePenalty: createZeroOnePenalty(game, `${state.gameNumber}/zeroOnePenalty`) } : state;
  if (state.phase === 'zeroOneFinished') return state;
  if (action.type === 'startZeroOnePenalty' || action.type === 'nextZeroOnePenaltyChunk') {
    const next = commitSeriesPenaltyChunk(state.zeroOnePenalty, action, action.type === 'startZeroOnePenalty', game.throwStyle, random, Number.MAX_SAFE_INTEGER);
    return next === state.zeroOnePenalty ? state : { ...state, zeroOnePenalty: next };
  }
  if (action.type === 'nextZeroOnePenaltyLoser') {
    const next = nextSeriesPenaltyLoser(state.zeroOnePenalty, action.penaltyId, action.playerId);
    return next === state.zeroOnePenalty ? state : { ...state, zeroOnePenalty: next };
  }
  if (action.type === 'finish' && state.zeroOnePenalty.currentLoserIndex === state.zeroOnePenalty.entries.length - 1
    && state.zeroOnePenalty.entries.every((p) => p.status === 'resolved')) return { ...state, phase: 'zeroOneFinished' };
  return state;
}
