import { DEFAULT_THROW_STYLE, OUT_PROBABILITIES } from './rollGenerator';
import type { Participant } from './suddenDeath';
import { DEFAULT_DICE_MODE, DEFAULT_ROLL_LIMIT, isDiceMode, isRollLimit } from './types';
import type { DiceMode, RollLimit, ThrowStyle } from './types';

export type Setup = Readonly<{ participants: readonly Participant[]; throwStyle: ThrowStyle; diceMode: DiceMode; rollLimit: RollLimit }>;
export const initialSetup = (): Setup => ({
  participants: [{ id: 'p0', name: '' }, { id: 'p1', name: '' }],
  throwStyle: DEFAULT_THROW_STYLE,
  diceMode: DEFAULT_DICE_MODE,
  rollLimit: DEFAULT_ROLL_LIMIT,
});

const segmenter = new Intl.Segmenter('ja', { granularity: 'grapheme' });
export function nameError(name: string): string | undefined {
  const length = [...segmenter.segment(name.trim())].length;
  return length < 1 || length > 12 ? '名前は前後の空白を除いて1〜12文字で入力してください。' : undefined;
}

export function validateSetup(setup: Setup): boolean {
  return validateSetupDraft(setup) && setup.participants.every((participant) => !nameError(participant.name));
}

/** Structural validation for an editable, recoverable draft. Blank names are valid until START. */
export function validateSetupDraft(value: unknown): value is Setup {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const setup = value as Record<string, unknown>;
  if (!Array.isArray(setup.participants) || setup.participants.length < 2 || setup.participants.length > 10
    || !Object.hasOwn(OUT_PROBABILITIES, setup.throwStyle as PropertyKey) || !isDiceMode(setup.diceMode)
    || !isRollLimit(setup.rollLimit)) return false;
  const participants = setup.participants;
  if (participants.some((participant) => typeof participant !== 'object' || participant === null || Array.isArray(participant)
    || typeof (participant as Record<string, unknown>).id !== 'string'
    || (participant as Record<string, unknown>).id === ''
    || typeof (participant as Record<string, unknown>).name !== 'string')) return false;
  return new Set(participants.map((participant) => (participant as { id: string }).id)).size === participants.length;
}
