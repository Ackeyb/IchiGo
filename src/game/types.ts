export type DieValue = 1 | 2 | 3 | 4 | 5 | 6;
export type DieResult =
  | Readonly<{ status: 'safe'; value: DieValue }>
  | Readonly<{ status: 'out'; value: null }>;

export type ThrowStyle = 'rough' | 'normal' | 'careful';
export type DiceMode = 5 | 7 | 10 | 14;
export const DEFAULT_DICE_MODE: DiceMode = 7;

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

export type RollResolution = Readonly<{
  dice: readonly DieResult[];
  gainedScore: number;
  scoringCount: number;
  outCount: number;
  outcome: 'continue' | 'turnEnd' | 'complete';
  player: PlayerTurn;
}>;

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
