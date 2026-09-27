export type DieValue = 1 | 2 | 3 | 4 | 5 | 6;
export type DieResult =
  | Readonly<{ status: 'safe'; value: DieValue }>
  | Readonly<{ status: 'out'; value: null }>;

export type ThrowStyle = 'rough' | 'normal' | 'careful';

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

type TurnBase = Readonly<{
  throwStyle: ThrowStyle;
  player: PlayerTurn;
  /** Starts at 1; identifies the next accepted roll within this turn. */
  nextRollNumber: number;
}>;

export type TurnState = TurnBase & (
  | Readonly<{ phase: 'ready' }>
  | Readonly<{ phase: 'result'; rollNumber: number; result: RollResolution }>
);
