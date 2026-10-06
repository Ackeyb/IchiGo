import { createPenaltyState, calculatePenalty } from '../game/penalty';
import { resolveRoll, assertPlayerTurn } from '../game/rollResolver';
import { validateSetup, validateSetupDraft } from '../game/setup';
import { shouldStartNextRound } from '../game/roundPolicy';
import type { FlowState } from '../game/gameFlow';
import type { PenaltyEntry } from '../game/penalty';
import { isDiceMode, isRollLimit, isModeConfiguration, sameGameMode } from '../game/types';
import type { DiceMode, DieResult, PlayerTurn, RollResolution, ThrowStyle, TurnState } from '../game/types';
import type { SuddenDeathState } from '../game/suddenDeath';

/**
 * Validates and restores persisted data as untrusted input.
 * Unsupported or corrupt game state is rejected, not migrated, inferred or repaired.
 * Recovery never re-rolls committed results. Game and Sound schemas are independent.
 */
export const SESSION_GAME_KEY = 'ichi-go:game';
export const SESSION_SOUND_KEY = 'ichi-go:sound';
export const SESSION_SCHEMA_VERSION = 4 as const;
export const SOUND_SCHEMA_VERSION = 1 as const;

export interface StorageAdapter {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type RecoveryNotice = 'corrupt' | 'unavailable' | 'save-failed' | 'remove-failed';
export type GameLoadResult = Readonly<{ state?: FlowState; recovered: boolean; notice?: RecoveryNotice }>;
export type SoundLoadResult = Readonly<{ enabled: boolean; notice?: RecoveryNotice }>;

export function recoveryNoticeText(notice: RecoveryNotice): string {
  if (notice === 'corrupt') return 'ゲームデータを復旧できませんでした。新しいゲームを開始できます。';
  if (notice === 'save-failed') return '一時保存できませんでした。このまま遊べますが、直近の進行を復旧できない可能性があります。';
  return '一時保存を利用できません。ゲームは続けられますが、再読み込み後に復旧できない可能性があります。';
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isSafeCount = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

const isInitialPlayer = (player: PlayerTurn, diceMode: DiceMode) => player.score === 0 && player.activeDice === diceMode
  && player.strandedDice === 0 && player.removedDice === 0 && !player.completed && !player.turnFinished;

function validDie(value: unknown): value is DieResult {
  if (!isRecord(value)) return false;
  return value.status === 'out' ? value.value === null
    : value.status === 'safe' && Number.isInteger(value.value) && Number(value.value) >= 1 && Number(value.value) <= 6;
}

function validPlayer(value: unknown, diceMode: DiceMode): value is PlayerTurn {
  if (!isRecord(value)) return false;
  try {
    assertPlayerTurn(value as PlayerTurn, diceMode);
    return typeof value.completed === 'boolean' && typeof value.turnFinished === 'boolean';
  } catch {
    return false;
  }
}

function validRound(value: unknown): value is SuddenDeathState {
  // Dice Mode and rollLimit must be present and supported; recovery never supplies configuration defaults.
  if (!isRecord(value) || !Array.isArray(value.participants) || !Array.isArray(value.players)
    || !isSafeCount(value.totalCompletionCount) || !isSafeCount(value.suddenDeathCount)
    || !Number.isInteger(value.currentPlayerIndex) || !isDiceMode(value.diceMode) || !isRollLimit(value.rollLimit)) return false;
  // Series still has no runtime. Completion Target history is validated separately below.
  const config = { mode: value.mode, rollLimit: value.rollLimit };
  if (!isModeConfiguration(config) || config.mode.type === 'series') return false;
  const diceMode = value.diceMode;
  const participants = value.participants;
  const players = value.players;
  if (participants.some((participant) => !isRecord(participant) || typeof participant.id !== 'string' || typeof participant.name !== 'string')
    || !validateSetup({ participants: participants as never, throwStyle: value.throwStyle as never, diceMode, ...config })
    || participants.some((participant) => (participant as { name: string }).name !== (participant as { name: string }).name.trim())
    || players.length !== participants.length || Number(value.currentPlayerIndex) < 0
    || Number(value.currentPlayerIndex) >= players.length) return false;
  const ids = participants.map((participant) => isRecord(participant) ? participant.id : undefined);
  if (players.some((player, index) => !isRecord(player) || player.id !== ids[index] || !validPlayer(player, diceMode))) return false;
  if (value.throwStyle === 'careful' && players.some((player) => player.strandedDice !== 0)) return false;
  const maximumCompletions = participants.length * (Number(value.suddenDeathCount) + 1);
  const currentCompletions = players.filter((player) => (player as unknown as PlayerTurn).completed).length;
  const previousCompletions = Number(value.totalCompletionCount) - currentCompletions;
  if (!Number.isSafeInteger(maximumCompletions) || previousCompletions < 0
    || Number(value.totalCompletionCount) > maximumCompletions) return false;
  if (config.mode.type === 'completionTarget') {
    // Partial-completion prior rounds are legal. With no saved history, validate bounds, never infer events or clamp to target.
    return previousCompletions <= participants.length * Number(value.suddenDeathCount);
  }
  // Normal can advance only through all-complete or zero-completion tied rounds; retain its stricter invariant.
  return previousCompletions % participants.length === 0
    && previousCompletions / participants.length <= Number(value.suddenDeathCount)
    && Number(value.totalCompletionCount) <= maximumCompletions;
}

/** Reconstruct a candidate pre-roll state only for validation; never write it back as a repair. */
function previousPlayer(result: RollResolution, diceMode: DiceMode): PlayerTurn | undefined {
  const previous: PlayerTurn = {
    score: result.player.score - result.gainedScore,
    activeDice: result.player.activeDice + result.outCount + result.scoringCount,
    strandedDice: result.player.strandedDice - result.outCount,
    removedDice: result.player.removedDice - result.scoringCount,
    completed: false,
    turnFinished: false,
  };
  return validPlayer(previous, diceMode) && previous.activeDice > 0 ? previous : undefined;
}

function validTurn(value: unknown, game: SuddenDeathState, gameNumber: number, revision: number): value is TurnState {
  const roundPlayer = game.players[game.currentPlayerIndex]!;
  const currentPlayer: PlayerTurn = {
    score: roundPlayer.score,
    activeDice: roundPlayer.activeDice,
    strandedDice: roundPlayer.strandedDice,
    removedDice: roundPlayer.removedDice,
    completed: roundPlayer.completed,
    turnFinished: roundPlayer.turnFinished,
  };
  if (!isRecord(value) || (value.phase !== 'ready' && value.phase !== 'result')
    || typeof value.turnId !== 'string' || value.turnId !== `${gameNumber}/${game.suddenDeathCount}/${game.participants[game.currentPlayerIndex]!.id}`
    || value.throwStyle !== game.throwStyle || value.totalCompletionCount !== game.totalCompletionCount
    || !Number.isSafeInteger(value.nextRollNumber) || Number(value.nextRollNumber) < 1 || Number(value.nextRollNumber) > revision + 1
    || !validPlayer(value.player, game.diceMode) || !same(value.player, currentPlayer)) return false;
  if (value.phase === 'ready') {
    // READY must point to an allowed next roll; the committed RESULT case below has a different boundary.
    if (value.result !== undefined || value.rollNumber !== undefined || value.player.turnFinished
      || value.player.activeDice === 0
      || (game.rollLimit !== null && Number(value.nextRollNumber) > game.rollLimit)) return false;
    // Each previous continuing roll removed at least one scoring die.
    return value.nextRollNumber === 1 ? isInitialPlayer(value.player, game.diceMode)
      : value.player.removedDice >= Number(value.nextRollNumber) - 1;
  }
  // A committed final roll may advance nextRollNumber to limit + 1; this is progression, not permission to roll again.
  if (!Number.isSafeInteger(value.rollNumber) || Number(value.rollNumber) < 1
    || Number(value.rollNumber) > revision || value.nextRollNumber !== Number(value.rollNumber) + 1 || !isRecord(value.result)
    || !Array.isArray(value.result.dice) || !value.result.dice.every(validDie)) return false;
  const result = value.result as unknown as RollResolution;
  if (!same(result.player, currentPlayer)) return false;
  const previous = previousPlayer(result, game.diceMode);
  if (!previous) return false;
  if (value.rollNumber === 1 ? !isInitialPlayer(previous, game.diceMode)
    : previous.removedDice < Number(value.rollNumber) - 1) return false;
  try {
    // Reuse live termination semantics against saved dice; this consumes no randomness and repairs no fields.
    return same(resolveRoll(previous, result.dice, game.diceMode, Number(value.rollNumber), game.rollLimit), result);
  } catch {
    return false;
  }
}

function validPenaltyEntry(value: unknown, expected: PenaltyEntry, totalCompletionCount: number, diceMode: DiceMode, throwStyle: ThrowStyle): value is PenaltyEntry {
  if (!isRecord(value) || value.playerId !== expected.playerId || value.diceCount !== expected.diceCount
    || (value.status !== 'pending' && value.status !== 'resolved')) return false;
  if (value.status === 'pending') return value.penaltyRoll === undefined && value.basePenalty === undefined
    && value.multiplier === undefined && value.finalPenalty === undefined;
  // Preserve committed DieResult values: careful rejects OUT, and only arithmetic validation maps OUT to six.
  if (!Array.isArray(value.penaltyRoll) || value.penaltyRoll.length !== expected.diceCount
    || !value.penaltyRoll.every(validDie)
    || (throwStyle === 'careful' && value.penaltyRoll.some((die) => die.status === 'out'))) return false;
  try {
    const calculated = calculatePenalty(value.penaltyRoll as never, totalCompletionCount, diceMode);
    return same(calculated, {
      penaltyRoll: value.penaltyRoll,
      basePenalty: value.basePenalty,
      multiplier: value.multiplier,
      finalPenalty: value.finalPenalty,
    });
  } catch {
    return false;
  }
}

function validPenalty(value: unknown, game: SuddenDeathState, gameNumber: number, phase: 'penalty' | 'finished', penaltyIndex: unknown): boolean {
  if (!isRecord(value) || value.penaltyId !== `${gameNumber}/penalty`
    || value.totalCompletionCount !== game.totalCompletionCount || !Array.isArray(value.penalties)
    || !Number.isInteger(penaltyIndex)) return false;
  let expected;
  try { expected = createPenaltyState(game, `${gameNumber}/penalty`); } catch { return false; }
  const index = Number(penaltyIndex);
  if (value.penalties.length !== expected.penalties.length || index < 0 || index >= value.penalties.length) return false;
  if (value.penalties.some((entry, position) => !validPenaltyEntry(entry, expected.penalties[position]!, game.totalCompletionCount, game.diceMode, game.throwStyle))) return false;
  const entries = value.penalties as unknown as readonly PenaltyEntry[];
  if (phase === 'finished') return index === entries.length - 1 && entries.every((entry) => entry.status === 'resolved');
  return entries.every((entry, position) => position < index ? entry.status === 'resolved'
    : position > index ? entry.status === 'pending' : true);
}

/** Reject unreachable or contradictory snapshots; validation never fills defaults or writes reconstructed values back. */
export function validateStoredFlowState(value: unknown): value is FlowState {
  if (!isRecord(value) || !isSafeCount(value.revision) || !isSafeCount(value.gameNumber)
    || value.revision >= Number.MAX_SAFE_INTEGER || value.gameNumber >= Number.MAX_SAFE_INTEGER
    || typeof value.phase !== 'string') return false;
  if (value.phase === 'setup') {
    return (value.setupKind === 'initial' || value.setupKind === 'newGame' || value.setupKind === 'fullReset')
      && validateSetupDraft(value.draft) && value.gameNumber <= value.revision;
  }
  if (value.phase === 'replayPreparation') {
    if (value.gameNumber < 1 || value.gameNumber > value.revision
      || !validateSetupDraft(value.draft) || !validateSetupDraft(value.replaySource)) return false;
    // Replay may reorder participants, but names, identities and game settings stay locked to the source.
    if (!validateSetup(value.draft) || !validateSetup(value.replaySource)
      || !sameGameMode(value.draft.mode, value.replaySource.mode)
      || value.draft.diceMode !== value.replaySource.diceMode
      || value.draft.throwStyle !== value.replaySource.throwStyle
      || value.draft.rollLimit !== value.replaySource.rollLimit
      || value.draft.participants.some((participant) => participant.name !== participant.name.trim())
      || value.replaySource.participants.some((participant) => participant.name !== participant.name.trim())) return false;
    const sourceById = new Map(value.replaySource.participants.map((participant) => [participant.id, participant.name]));
    return value.draft.participants.length === sourceById.size
      && value.draft.participants.every((participant) => sourceById.get(participant.id) === participant.name);
  }
  if (!['turn', 'ranking', 'suddenDeath', 'loserReveal', 'penalty', 'finished'].includes(value.phase)
    || value.gameNumber < 1 || value.gameNumber > value.revision || !validRound(value.game)) return false;
  const game = value.game;
  const current = game.currentPlayerIndex;
  if (game.players.some((player, index) => index < current ? !player.turnFinished : index > current ? !isInitialPlayer(player, game.diceMode) : false)) return false;
  if (value.phase === 'turn') return validTurn(value.turn, game, value.gameNumber, value.revision);
  if (!game.players.every((player) => player.turnFinished)) return false;
  const tied = shouldStartNextRound(game);
  if (value.phase === 'suddenDeath') return tied;
  if (value.phase === 'ranking') return game.mode.type === 'normal' || !tied;
  if (value.phase === 'loserReveal') return !tied;
  if (value.phase !== 'penalty' && value.phase !== 'finished') return false;
  return !tied && validPenalty(value.penalty, game, value.gameNumber, value.phase, value.penaltyIndex);
}

type StoredEnvelope = Readonly<{ version: typeof SESSION_SCHEMA_VERSION; state: FlowState }>
  | Readonly<{ version: typeof SESSION_SCHEMA_VERSION; cleared: true }>;

/** sessionStorage boundary. It never throws into gameplay and never mutates game state. */
export class SessionRecovery {
  private storage: StorageAdapter | undefined;
  private checked = false;
  private unavailable = false;
  private ignoreStoredGame = false;
  private gameLoadResult: GameLoadResult | undefined;
  private soundLoadResult: SoundLoadResult | undefined;

  constructor(private readonly storageProvider: () => StorageAdapter) {}

  loadGame(): GameLoadResult {
    if (this.gameLoadResult) return this.gameLoadResult;
    if (this.ignoreStoredGame) return this.cacheGameLoad({ recovered: false });
    const storage = this.getStorage();
    if (!storage) return this.cacheGameLoad({ recovered: false, notice: 'unavailable' });
    let raw: string | null;
    try { raw = storage.getItem(SESSION_GAME_KEY); } catch {
      this.unavailable = true;
      return this.cacheGameLoad({ recovered: false, notice: 'unavailable' });
    }
    if (raw === null) return this.cacheGameLoad({ recovered: false });
    try {
      const envelope: unknown = JSON.parse(raw);
      if (isRecord(envelope) && envelope.version === SESSION_SCHEMA_VERSION && envelope.cleared === true) {
        return this.cacheGameLoad({ recovered: false });
      }
      if (!isRecord(envelope) || envelope.version !== SESSION_SCHEMA_VERSION) throw new Error('INVALID_RECOVERY_STATE');
      const state = envelope.state;
      if (!validateStoredFlowState(state)) throw new Error('INVALID_RECOVERY_STATE');
      return this.cacheGameLoad({ state, recovered: true });
    } catch {
      this.ignoreStoredGame = true;
      this.discardInvalid(storage);
      return this.cacheGameLoad({ recovered: false, notice: 'corrupt' });
    }
  }

  /** A storage failure is fail-open; a later reload can recover only the last successful checkpoint. */
  saveGame(state: FlowState): RecoveryNotice | undefined {
    const storage = this.getStorage();
    if (!storage) return 'unavailable';
    try {
      const envelope: StoredEnvelope = { version: SESSION_SCHEMA_VERSION, state };
      storage.setItem(SESSION_GAME_KEY, JSON.stringify(envelope));
      this.ignoreStoredGame = false;
      this.gameLoadResult = { state, recovered: true };
      return undefined;
    } catch { return 'save-failed'; }
  }

  clearGame(): RecoveryNotice | undefined {
    const storage = this.getStorage();
    if (!storage) return 'unavailable';
    // Ignore the old checkpoint in memory before attempting removal or the cleared-marker fallback.
    this.ignoreStoredGame = true;
    this.gameLoadResult = { recovered: false };
    try { storage.removeItem(SESSION_GAME_KEY); return undefined; } catch {
      try {
        const cleared: StoredEnvelope = { version: SESSION_SCHEMA_VERSION, cleared: true };
        storage.setItem(SESSION_GAME_KEY, JSON.stringify(cleared));
      } catch { /* the in-memory session still ignores the stale entry */ }
      return 'remove-failed';
    }
  }

  loadSound(): SoundLoadResult {
    if (this.soundLoadResult) return this.soundLoadResult;
    const storage = this.getStorage();
    if (!storage) return this.cacheSoundLoad({ enabled: true, notice: 'unavailable' });
    let raw: string | null;
    try { raw = storage.getItem(SESSION_SOUND_KEY); } catch {
      this.unavailable = true;
      return this.cacheSoundLoad({ enabled: true, notice: 'unavailable' });
    }
    if (raw === null) return this.cacheSoundLoad({ enabled: true });
    try {
      const value: unknown = JSON.parse(raw);
      if (isRecord(value) && value.version === SOUND_SCHEMA_VERSION && typeof value.enabled === 'boolean') {
        return this.cacheSoundLoad({ enabled: value.enabled });
      }
      try { storage.removeItem(SESSION_SOUND_KEY); } catch { /* sound remains fail-open */ }
      return this.cacheSoundLoad({ enabled: true });
    } catch {
      try { storage.removeItem(SESSION_SOUND_KEY); } catch { /* sound remains fail-open */ }
      return this.cacheSoundLoad({ enabled: true });
    }
  }

  saveSound(enabled: boolean): RecoveryNotice | undefined {
    const storage = this.getStorage();
    if (!storage) return 'unavailable';
    try {
      storage.setItem(SESSION_SOUND_KEY, JSON.stringify({ version: SOUND_SCHEMA_VERSION, enabled }));
      this.soundLoadResult = { enabled };
      return undefined;
    } catch { return 'save-failed'; }
  }

  private getStorage(): StorageAdapter | undefined {
    if (this.unavailable) return undefined;
    if (this.checked) return this.storage;
    this.checked = true;
    try { this.storage = this.storageProvider(); } catch { this.unavailable = true; }
    return this.storage;
  }

  private discardInvalid(storage: StorageAdapter): void {
    try { storage.removeItem(SESSION_GAME_KEY); } catch {
      // If removal fails, a marker prevents revival; if its write also fails, the caller ignores stale data only in memory.
      try { storage.setItem(SESSION_GAME_KEY, JSON.stringify({ version: SESSION_SCHEMA_VERSION, cleared: true })); } catch { /* memory-only */ }
    }
  }

  private cacheGameLoad(result: GameLoadResult): GameLoadResult {
    this.gameLoadResult = result;
    return result;
  }

  private cacheSoundLoad(result: SoundLoadResult): SoundLoadResult {
    this.soundLoadResult = result;
    return result;
  }
}

export function createBrowserSessionRecovery(): SessionRecovery {
  return new SessionRecovery(() => window.sessionStorage);
}
