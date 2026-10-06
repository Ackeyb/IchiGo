import { DEFAULT_THROW_STYLE, OUT_PROBABILITIES } from './rollGenerator';
import type { Participant } from './suddenDeath';
import { DEFAULT_DICE_MODE, DEFAULT_ROLL_LIMIT, isDiceMode, isModeConfiguration } from './types';
import type { DiceMode, GameMode, ModeConfiguration, ThrowStyle } from './types';

export type Setup = Readonly<{ participants: readonly Participant[]; throwStyle: ThrowStyle; diceMode: DiceMode }> & ModeConfiguration;
export const initialSetup = (): Setup & { mode: Extract<GameMode, { type: 'normal' }> } => ({
  mode: { type: 'normal' },
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
    || !isModeConfiguration({ mode: setup.mode, rollLimit: setup.rollLimit })) return false;
  const participants = setup.participants;
  if (participants.some((participant) => typeof participant !== 'object' || participant === null || Array.isArray(participant)
    || typeof (participant as Record<string, unknown>).id !== 'string'
    || (participant as Record<string, unknown>).id === ''
    || typeof (participant as Record<string, unknown>).name !== 'string')) return false;
  return new Set(participants.map((participant) => (participant as { id: string }).id)).size === participants.length;
}

/** Leaving a mode discards its setting; returning starts with its default, never a hidden old value. */
export function switchSetupMode(setup: Setup, type: GameMode['type']): Setup {
  if (setup.mode.type === type) return setup;
  const common = { participants: setup.participants, diceMode: setup.diceMode, throwStyle: setup.throwStyle };
  if (type === 'completionTarget') return { ...common, mode: { type, targetCompletions: 1 }, rollLimit: null };
  if (type === 'series') return { ...common, mode: { type, gameCount: 2 }, rollLimit: setup.rollLimit };
  return { ...common, mode: { type }, rollLimit: setup.rollLimit };
}
