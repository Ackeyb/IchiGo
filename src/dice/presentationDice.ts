import type { DieResult, DieValue } from '../game/types';
import type { DicePresentationKind } from './types';

export type PresentedDie =
  | Readonly<{ index: number; status: 'safe'; value: DieValue; scoring: boolean }>
  | Readonly<{ index: number; status: 'out' }>;

export function toPresentedDice(dice: readonly DieResult[], kind: DicePresentationKind): readonly PresentedDie[] {
  return dice.map((die, index) => die.status === 'out'
    ? { index, status: 'out' }
    : { index, status: 'safe', value: die.value, scoring: kind === 'normal' && (die.value === 1 || die.value === 5) });
}
