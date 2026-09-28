import { DEFAULT_THROW_STYLE, OUT_PROBABILITIES } from './rollGenerator';
import type { Participant } from './suddenDeath';
import type { ThrowStyle } from './types';

export type Setup = Readonly<{ participants: readonly Participant[]; throwStyle: ThrowStyle }>;
export const initialSetup = (): Setup => ({
  participants: [{ id: 'p0', name: '' }, { id: 'p1', name: '' }], throwStyle: DEFAULT_THROW_STYLE,
});

const segmenter = new Intl.Segmenter('ja', { granularity: 'grapheme' });
export function nameError(name: string): string | undefined {
  const length = [...segmenter.segment(name.trim())].length;
  return length < 1 || length > 12 ? '名前は前後の空白を除いて1〜12文字で入力してください。' : undefined;
}

export function validateSetup(setup: Setup): boolean {
  return setup.participants.length >= 2 && setup.participants.length <= 10
    && new Set(setup.participants.map((p) => p.id)).size === setup.participants.length
    && setup.participants.every((p) => p.id.length > 0 && !nameError(p.name))
    && Object.hasOwn(OUT_PROBABILITIES, setup.throwStyle);
}
