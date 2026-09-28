import { createPenaltyState, calculatePenalty } from '../game/penalty';
import { resolveRoll, assertPlayerTurn } from '../game/rollResolver';
import { validateSetup } from '../game/setup';
import { shouldStartSuddenDeath } from '../game/suddenDeath';
import type { FlowState } from '../game/gameFlow';
import type { PenaltyEntry } from '../game/penalty';
import type { DieResult, PlayerTurn, RollResolution, TurnState } from '../game/types';
import type { SuddenDeathState } from '../game/suddenDeath';

export const SESSION_GAME_KEY = 'ichi-go:game';
export const SESSION_SOUND_KEY = 'ichi-go:sound';
export const SESSION_SCHEMA_VERSION = 1 as const;

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
const isInitialPlayer = (player: PlayerTurn) => player.score === 0 && player.activeDice === 7
  && player.strandedDice === 0 && player.removedDice === 0 && !player.completed && !player.turnFinished;

function validDie(value: unknown): value is DieResult {
  if (!isRecord(value)) return false;
  return value.status === 'out' ? value.value === null
    : value.status === 'safe' && Number.isInteger(value.value) && Number(value.value) >= 1 && Number(value.value) <= 6;
}

function validPlayer(value: unknown): value is PlayerTurn {
  if (!isRecord(value)) return false;
  try {
    assertPlayerTurn(value as PlayerTurn);
    return typeof value.completed === 'boolean' && typeof value.turnFinished === 'boolean';
  } catch {
    return false;
  }
}

function validRound(value: unknown): value is SuddenDeathState {
  if (!isRecord(value) || !Array.isArray(value.participants) || !Array.isArray(value.players)
    || !isSafeCount(value.totalCompletionCount) || !isSafeCount(value.suddenDeathCount)
    || !Number.isInteger(value.currentPlayerIndex)) return false;
  const participants = value.participants;
  const players = value.players;
  if (participants.some((participant) => !isRecord(participant) || typeof participant.id !== 'string' || typeof participant.name !== 'string')
    || !validateSetup({ participants: participants as never, throwStyle: value.throwStyle as never })
    || participants.some((participant) => (participant as { name: string }).name !== (participant as { name: string }).name.trim())
    || players.length !== participants.length || Number(value.currentPlayerIndex) < 0
    || Number(value.currentPlayerIndex) >= players.length) return false;
  const ids = participants.map((participant) => isRecord(participant) ? participant.id : undefined);
  if (players.some((player, index) => !isRecord(player) || player.id !== ids[index] || !validPlayer(player))) return false;
  const maximumCompletions = participants.length * (Number(value.suddenDeathCount) + 1);
  const currentCompletions = players.filter((player) => (player as unknown as PlayerTurn).completed).length;
  const previousCompletions = Number(value.totalCompletionCount) - currentCompletions;
  return Number.isSafeInteger(maximumCompletions)
    && previousCompletions >= 0 && previousCompletions % participants.length === 0
    && previousCompletions / participants.length <= Number(value.suddenDeathCount)
    && Number(value.totalCompletionCount) <= maximumCompletions;
}

function previousPlayer(result: RollResolution): PlayerTurn | undefined {
  const previous: PlayerTurn = {
    score: result.player.score - result.gainedScore,
    activeDice: result.player.activeDice + result.outCount + result.scoringCount,
    strandedDice: result.player.strandedDice - result.outCount,
    removedDice: result.player.removedDice - result.scoringCount,
    completed: false,
    turnFinished: false,
  };
  return validPlayer(previous) && previous.activeDice > 0 ? previous : undefined;
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
    || !validPlayer(value.player) || !same(value.player, currentPlayer)) return false;
  if (value.phase === 'ready') return !value.player.turnFinished && value.player.activeDice > 0;
  if (!Number.isSafeInteger(value.rollNumber) || Number(value.rollNumber) < 1
    || Number(value.rollNumber) > revision || value.nextRollNumber !== Number(value.rollNumber) + 1 || !isRecord(value.result)
    || !Array.isArray(value.result.dice) || !value.result.dice.every(validDie)) return false;
  const result = value.result as unknown as RollResolution;
  const previous = previousPlayer(result);
  if (!previous) return false;
  try {
    return same(resolveRoll(previous, result.dice), result);
  } catch {
    return false;
  }
}

function validPenaltyEntry(value: unknown, expected: PenaltyEntry, totalCompletionCount: number): value is PenaltyEntry {
  if (!isRecord(value) || value.playerId !== expected.playerId || value.diceCount !== expected.diceCount
    || (value.status !== 'pending' && value.status !== 'resolved')) return false;
  if (value.status === 'pending') return true;
  if (!Array.isArray(value.penaltyRoll)) return false;
  try {
    const calculated = calculatePenalty(value.penaltyRoll as never, totalCompletionCount);
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
  if (value.penalties.some((entry, position) => !validPenaltyEntry(entry, expected.penalties[position]!, game.totalCompletionCount))) return false;
  const entries = value.penalties as unknown as readonly PenaltyEntry[];
  if (phase === 'finished') return index === entries.length - 1 && entries.every((entry) => entry.status === 'resolved');
  return entries.every((entry, position) => position < index ? entry.status === 'resolved'
    : position > index ? entry.status === 'pending' : true);
}

/** Rejects unreachable or internally inconsistent snapshots instead of repairing them. */
export function validateStoredFlowState(value: unknown): value is FlowState {
  if (!isRecord(value) || !isSafeCount(value.revision) || !isSafeCount(value.gameNumber)
    || value.revision >= Number.MAX_SAFE_INTEGER || value.gameNumber >= Number.MAX_SAFE_INTEGER
    || typeof value.phase !== 'string') return false;
  if (value.phase === 'setup') return value.gameNumber <= value.revision;
  if (!['turn', 'ranking', 'suddenDeath', 'loserReveal', 'penalty', 'finished'].includes(value.phase)
    || value.gameNumber < 1 || value.gameNumber > value.revision || !validRound(value.game)) return false;
  const game = value.game;
  const current = game.currentPlayerIndex;
  if (game.players.some((player, index) => index < current ? !player.turnFinished : index > current ? !isInitialPlayer(player) : false)) return false;
  if (value.phase === 'turn') return validTurn(value.turn, game, value.gameNumber, value.revision);
  if (!game.players.every((player) => player.turnFinished)) return false;
  const tied = shouldStartSuddenDeath(game.players);
  if (value.phase === 'suddenDeath') return tied;
  if (value.phase === 'ranking') return true;
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
      if (!isRecord(envelope) || envelope.version !== SESSION_SCHEMA_VERSION || !validateStoredFlowState(envelope.state)
        || envelope.state.phase === 'setup') throw new Error('INVALID_RECOVERY_STATE');
      return this.cacheGameLoad({ state: envelope.state, recovered: true });
    } catch {
      this.ignoreStoredGame = true;
      this.discardInvalid(storage);
      return this.cacheGameLoad({ recovered: false, notice: 'corrupt' });
    }
  }

  saveGame(state: FlowState): RecoveryNotice | undefined {
    if (state.phase === 'setup') return this.clearGame();
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
      if (isRecord(value) && value.version === SESSION_SCHEMA_VERSION && typeof value.enabled === 'boolean') {
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
      storage.setItem(SESSION_SOUND_KEY, JSON.stringify({ version: SESSION_SCHEMA_VERSION, enabled }));
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
