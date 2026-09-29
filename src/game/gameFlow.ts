import { continueTurn, createTurn, rollTurn } from './gameEngine';
import { createPenaltyState, rollPenalty } from './penalty';
import type { PenaltyState } from './penalty';
import type { RandomSource } from './randomSource';
import { shouldStartSuddenDeath, startSuddenDeath } from './suddenDeath';
import type { SuddenDeathState } from './suddenDeath';
import { validateSetup } from './setup';
import { initialSetup } from './setup';
import type { Setup } from './setup';
import type { TurnState } from './types';

type Base = Readonly<{ revision: number; gameNumber: number }>;
type Round = Base & Readonly<{ game: SuddenDeathState }>;
export type SetupKind = 'initial' | 'newGame' | 'fullReset';
export type ReplayPreparation = Setup;
export type FlowState =
  | (Base & Readonly<{ phase: 'setup'; draft: Setup; setupKind: SetupKind }>)
  | (Base & Readonly<{ phase: 'replayPreparation'; draft: ReplayPreparation }>)
  | (Round & Readonly<{ phase: 'turn'; turn: TurnState }>)
  | (Round & Readonly<{ phase: 'ranking' | 'suddenDeath' | 'loserReveal' }>)
  | (Round & Readonly<{ phase: 'penalty' | 'finished'; penalty: PenaltyState; penaltyIndex: number }>);
export type FlowAction =
  | Readonly<{ type: 'start'; setup: Setup }>
  | Readonly<{ type: 'reorderReplay'; participantIds: readonly string[] }>
  | Readonly<{ type: 'roll' | 'next' | 'ranking' | 'reveal' | 'suddenDeath' | 'startSuddenDeath'
    | 'penalty' | 'rollPenalty' | 'nextPenalty' | 'finish' | 'replay' | 'startReplay'
    | 'newGame' | 'exitGame' | 'fullReset' }>;

export const initialFlow = (): FlowState => ({
  phase: 'setup', revision: 0, gameNumber: 0, draft: initialSetup(), setupKind: 'initial',
});

function turnFor(game: SuddenDeathState, gameNumber: number): TurnState {
  const id = game.participants[game.currentPlayerIndex]!.id;
  return createTurn({ turnId: `${gameNumber}/${game.suddenDeathCount}/${id}`, totalCompletionCount: game.totalCompletionCount, diceMode: game.diceMode }, game.throwStyle);
}

function start(state: Base, setup: Setup): FlowState {
  if (!validateSetup(setup)) throw new Error('プレイヤー設定を確認してください。');
  const gameNumber = state.gameNumber + 1;
  const participants = setup.participants.map(({ id, name }) => ({ id, name: name.trim() }));
  const game: SuddenDeathState = {
    participants, throwStyle: setup.throwStyle, diceMode: setup.diceMode,
    currentPlayerIndex: 0, totalCompletionCount: 0, suddenDeathCount: 0,
    players: participants.map(({ id }) => ({ id, ...createTurn({ turnId: `${gameNumber}/0/${id}`, totalCompletionCount: 0, diceMode: setup.diceMode }, setup.throwStyle).player })),
  };
  return { phase: 'turn', revision: state.revision, gameNumber, game, turn: turnFor(game, gameNumber) };
}

function preparationFromGame(game: SuddenDeathState): ReplayPreparation {
  return {
    participants: game.participants.map(({ id, name }) => ({ id, name })),
    diceMode: game.diceMode,
    throwStyle: game.throwStyle,
  };
}

function sameSetup(left: Setup, right: Setup): boolean {
  return left.diceMode === right.diceMode && left.throwStyle === right.throwStyle
    && left.participants.length === right.participants.length
    && left.participants.every((participant, index) => {
      const other = right.participants[index];
      return participant.id === other?.id && participant.name === other.name;
    });
}

function reorderReplay(state: Extract<FlowState, { phase: 'replayPreparation' }>, participantIds: readonly string[]): FlowState {
  const byId = new Map(state.draft.participants.map((participant) => [participant.id, participant]));
  if (participantIds.length !== byId.size || new Set(participantIds).size !== byId.size
    || participantIds.some((id) => !byId.has(id))) return state;
  const participants = participantIds.map((id) => byId.get(id)!);
  if (participants.every((participant, index) => participant === state.draft.participants[index])) return state;
  return { ...state, draft: { ...state.draft, participants } };
}

/** Only orchestration: scoring, ranking, eligibility and penalties remain in their engines. */
function apply(state: FlowState, action: FlowAction, random: RandomSource): FlowState {
  if (state.phase === 'setup') {
    if (action.type === 'start') return start(state, action.setup);
    if (action.type === 'fullReset') {
      const draft = initialSetup();
      if (state.setupKind === 'fullReset' && sameSetup(state.draft, draft)) return state;
      return { ...state, draft, setupKind: 'fullReset' };
    }
    return state;
  }
  if (state.phase === 'replayPreparation') {
    if (action.type === 'reorderReplay') return reorderReplay(state, action.participantIds);
    if (action.type === 'startReplay') return start(state, state.draft);
    return state;
  }
  const { game, gameNumber, revision } = state;
  if (action.type === 'replay' && state.phase === 'finished') {
    return { phase: 'replayPreparation', revision, gameNumber, draft: preparationFromGame(game) };
  }
  if (action.type === 'newGame' && state.phase === 'finished') {
    return { phase: 'setup', revision, gameNumber, draft: preparationFromGame(game), setupKind: 'newGame' };
  }
  if (action.type === 'exitGame' && state.phase !== 'finished') {
    return { phase: 'setup', revision, gameNumber, draft: initialSetup(), setupKind: 'initial' };
  }
  if (state.phase === 'turn') {
    const { turn } = state;
    if (action.type === 'roll' && !turn.player.turnFinished) {
      const ready = turn.phase === 'result' ? continueTurn(turn, turn.rollNumber, turn.turnId) : turn;
      const next = rollTurn(ready, ready.nextRollNumber, random, turn.turnId, game.diceMode);
      if (next === ready) return state;
      const id = game.participants[game.currentPlayerIndex]!.id;
      return { ...state, turn: next, game: { ...game,
        totalCompletionCount: next.totalCompletionCount,
        players: game.players.map((p) => p.id === id ? { id, ...next.player } : p),
      } };
    }
    if (!turn.player.turnFinished) return state;
    if (action.type === 'next' && game.currentPlayerIndex < game.participants.length - 1) {
      const next = { ...game, currentPlayerIndex: game.currentPlayerIndex + 1 };
      return { ...state, game: next, turn: turnFor(next, gameNumber) };
    }
    if (action.type === 'ranking' && game.players.every((p) => p.turnFinished)) {
      return { phase: 'ranking', game, gameNumber, revision };
    }
  }
  if (state.phase === 'ranking') {
    const tied = shouldStartSuddenDeath(game.players, game.diceMode);
    if (action.type === 'suddenDeath' && tied) return { ...state, phase: 'suddenDeath' };
    if (action.type === 'reveal' && !tied) return { ...state, phase: 'loserReveal' };
  }
  if (state.phase === 'suddenDeath' && action.type === 'startSuddenDeath') {
    const next = startSuddenDeath(game, game.suddenDeathCount);
    if (next === game) return state;
    return { phase: 'turn', game: next, turn: turnFor(next, gameNumber), gameNumber, revision };
  }
  if (state.phase === 'loserReveal' && action.type === 'penalty') {
    return { phase: 'penalty', game, gameNumber, revision,
      penalty: createPenaltyState(game, `${gameNumber}/penalty`), penaltyIndex: 0 };
  }
  if (state.phase === 'penalty') {
    const entry = state.penalty.penalties[state.penaltyIndex]!;
    if (action.type === 'rollPenalty' && entry.status === 'pending') {
      return { ...state, penalty: rollPenalty(state.penalty, entry.playerId, random, state.penalty.penaltyId, game.diceMode) };
    }
    if (entry.status !== 'resolved') return state;
    if (action.type === 'nextPenalty' && state.penaltyIndex < state.penalty.penalties.length - 1) {
      return { ...state, penaltyIndex: state.penaltyIndex + 1 };
    }
    if (action.type === 'finish' && state.penalty.penalties.every((p) => p.status === 'resolved')) {
      return { ...state, phase: 'finished' };
    }
  }
  return state;
}

/** Requests capture the rendered revision; never rebind an old request to new state. */
export function advanceFlow(state: FlowState, expectedRevision: number, action: FlowAction, random: RandomSource): FlowState {
  if (expectedRevision !== state.revision) return state;
  const next = apply(state, action, random);
  return next === state ? state : { ...next, revision: state.revision + 1 };
}
