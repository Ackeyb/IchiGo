import type {
  DiceFallbackReason,
  DicePresentationOutcome,
  DicePresentationRequest,
  DiceRenderer,
  DiceRendererFactory,
} from './types';
import { DiceRendererError } from './types';

export type DicePresentationControllerOptions = Readonly<{
  createRenderer: DiceRendererFactory;
  timeoutMs?: number;
  prefersReducedMotion?: () => boolean;
}>;

const defaultReducedMotion = () =>
  typeof window === 'undefined' || typeof window.matchMedia !== 'function'
    ? true
    : window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Coordinates presentation only. It never generates or resolves a die result. */
export class DicePresentationController {
  private renderer: DiceRenderer | undefined;
  private initialization: Promise<DiceRenderer> | undefined;
  private current: Readonly<{ id: string; completion: Promise<DicePresentationOutcome> }> | undefined;
  private disposed = false;
  private unavailableReason: DiceFallbackReason | undefined;

  constructor(
    private readonly container: HTMLElement,
    private readonly options: DicePresentationControllerOptions,
  ) {}

  present(request: DicePresentationRequest): DicePresentationOutcome | Promise<DicePresentationOutcome> {
    if (this.disposed || this.unavailableReason) {
      return { mode: 'fallback', reason: this.unavailableReason ?? 'unsupported' };
    }
    if ((this.options.prefersReducedMotion ?? defaultReducedMotion)()) {
      return { mode: 'fallback', reason: 'reduced-motion' };
    }
    if (this.current?.id === request.id) return this.current.completion;

    const completion = this.run(request);
    this.current = { id: request.id, completion };
    return completion;
  }

  clear(): void {
    this.current = undefined;
    this.renderer?.clear();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.current = undefined;
    this.renderer?.dispose();
    this.renderer = undefined;
  }

  private async run(request: DicePresentationRequest): Promise<DicePresentationOutcome> {
    // StrictMode cleans up the first effect before this microtask, avoiding duplicate WebGL setup.
    await Promise.resolve();
    if (this.disposed) return { mode: 'fallback', reason: 'unsupported' };

    try {
      const renderer = await this.getRenderer();
      const timeoutMs = this.options.timeoutMs ?? 4_000;
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('DICE_PRESENTATION_TIMEOUT')), timeoutMs);
      });
      try {
        await Promise.race([renderer.present(request), timeout]);
      } finally {
        if (timeoutId !== undefined) clearTimeout(timeoutId);
      }
      if (this.disposed) return { mode: 'fallback', reason: 'unsupported' };
      return { mode: 'three' };
    } catch (error) {
      const reason = this.failureReason(error);
      this.unavailableReason = reason;
      this.renderer?.dispose();
      this.renderer = undefined;
      this.initialization = undefined;
      return { mode: 'fallback', reason };
    }
  }

  private getRenderer(): Promise<DiceRenderer> {
    if (this.renderer) return Promise.resolve(this.renderer);
    if (!this.initialization) {
      this.initialization = this.options.createRenderer(this.container).then(async (renderer) => {
        try {
          if (this.disposed) throw new Error('DICE_RENDERER_DISPOSED');
          await renderer.initialize();
          this.renderer = renderer;
          return renderer;
        } catch (error) {
          renderer.dispose();
          throw error;
        }
      });
    }
    return this.initialization;
  }

  private failureReason(error: unknown): DiceFallbackReason {
    if (error instanceof DiceRendererError) return error.reason;
    if (error instanceof Error && error.message === 'DICE_PRESENTATION_TIMEOUT') return 'timeout';
    return this.renderer ? 'presentation' : 'initialization';
  }
}
