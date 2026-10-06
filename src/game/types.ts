export type DieValue = 1 | 2 | 3 | 4 | 5 | 6;
export type DieResult =
  | Readonly<{ status: 'safe'; value: DieValue }>
  | Readonly<{ status: 'out'; value: null }>;

export type ThrowStyle = 'rough' | 'normal' | 'careful';
export type DiceMode = 5 | 7 | 10 | 14;
export const DEFAULT_DICE_MODE: DiceMode = 7;
/** Game-wide setting; null is unlimited. Track usage through TurnState progression, not a duplicate limit. */
export type RollLimit = null | 1 | 2 | 3 | 4 | 5;
export const DEFAULT_ROLL_LIMIT: RollLimit = null;

export type CompletionTarget = 1 | 2 | 3 | 4 | 5;
export type SeriesGameCount = 2 | 3 | 4 | 5;
export type GameMode =
  | Readonly<{ type: 'normal'; targetCompletions?: never; gameCount?: never }>
  | Readonly<{ type: 'completionTarget'; targetCompletions: CompletionTarget; gameCount?: never }>
  | Readonly<{ type: 'series'; gameCount: SeriesGameCount; targetCompletions?: never }>;
export type ModeConfiguration =
  | Readonly<{ mode: Extract<GameMode, { type: 'normal' | 'series' }>; rollLimit: RollLimit }>
  | Readonly<{ mode: Extract<GameMode, { type: 'completionTarget' }>; rollLimit: null }>;

export function isCompletionTarget(value: unknown): value is CompletionTarget {
  return value === 1 || value === 2 || value === 3 || value === 4 || value === 5;
}

export function isSeriesGameCount(value: unknown): value is SeriesGameCount {
  return value === 2 || value === 3 || value === 4 || value === 5;
}

export function isGameMode(value: unknown): value is GameMode {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const mode = value as Record<string, unknown>;
  const keys = Object.keys(mode);
  if (mode.type === 'normal') return keys.length === 1;
  if (mode.type === 'completionTarget') return keys.length === 2 && isCompletionTarget(mode.targetCompletions);
  return mode.type === 'series' && keys.length === 2 && isSeriesGameCount(mode.gameCount);
}

export function isModeConfiguration(value: unknown): value is ModeConfiguration {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const config = value as Record<string, unknown>;
  return isGameMode(config.mode) && isRollLimit(config.rollLimit)
    && (config.mode.type !== 'completionTarget' || config.rollLimit === null);
}

/** Copy only configuration; preserve the mode/limit correlation without carrying progress. */
export function modeConfiguration(config: ModeConfiguration): ModeConfiguration {
  return config.mode.type === 'completionTarget'
    ? { mode: config.mode, rollLimit: null }
    : { mode: config.mode, rollLimit: config.rollLimit };
}

export function sameGameMode(left: GameMode, right: GameMode): boolean {
  return left.type === right.type && left.targetCompletions === right.targetCompletions && left.gameCount === right.gameCount;
}

export function isRollLimit(value: unknown): value is RollLimit {
  return value === null || value === 1 || value === 2 || value === 3 || value === 4 || value === 5;
}

export function isDiceMode(value: unknown): value is DiceMode {
  return value === 5 || value === 7 || value === 10 || value === 14;
}

export type PlayerTurn = Readonly<{
  score: number;
  activeDice: number;
  strandedDice: number;
  removedDice: number;
  completed: boolean;
  turnFinished: boolean;
}>;

export type RollOutcome =
  | Readonly<{ outcome: 'continue' | 'complete'; reason?: never }>
  | Readonly<{ outcome: 'turnEnd'; reason: 'noScore' | 'rollLimit' | 'noActiveDice' }>;

export type RollResolution = Readonly<{
  dice: readonly DieResult[];
  gainedScore: number;
  scoringCount: number;
  outCount: number;
  player: PlayerTurn;
}> & RollOutcome;

export type TurnContext = Readonly<{
  /** Unique across games, rounds and players; supplied by the caller. */
  turnId: string;
  totalCompletionCount: number;
  diceMode?: DiceMode;
}>;

type TurnBase = Readonly<{
  turnId: string;
  totalCompletionCount: number;
  throwStyle: ThrowStyle;
  player: PlayerTurn;
  /** Starts at 1; identifies the next accepted roll within this turn. */
  nextRollNumber: number;
}>;

export type TurnState = TurnBase & (
  | Readonly<{ phase: 'ready' }>
  | Readonly<{ phase: 'result'; rollNumber: number; result: RollResolution }>
);
