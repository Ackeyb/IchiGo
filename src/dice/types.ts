import type { DieResult } from '../game/types';

export type DicePresentationKind = 'normal' | 'penalty';

export type DicePresentationRequest = Readonly<{
  id: string;
  dice: readonly DieResult[];
  kind: DicePresentationKind;
}>;

export interface DiceRenderer {
  initialize(): Promise<void>;
  present(request: DicePresentationRequest): Promise<void>;
  clear(): void;
  dispose(): void;
}

export type DiceRendererFactory = (container: HTMLElement) => Promise<DiceRenderer>;

export type DiceFallbackReason =
  | 'reduced-motion'
  | 'unsupported'
  | 'initialization'
  | 'presentation'
  | 'timeout'
  | 'context-lost';

export type DicePresentationOutcome =
  | Readonly<{ mode: 'three' }>
  | Readonly<{ mode: 'fallback'; reason: DiceFallbackReason }>;

export class DiceRendererError extends Error {
  constructor(readonly reason: Exclude<DiceFallbackReason, 'reduced-motion' | 'unsupported' | 'timeout'>, message: string) {
    super(message);
    this.name = 'DiceRendererError';
  }
}
