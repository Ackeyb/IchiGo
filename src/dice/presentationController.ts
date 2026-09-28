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

export const prefersReducedMotion = () =>
  typeof window === 'undefined' || typeof window.matchMedia !== 'function'
    ? true
    : window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Coordinates presentation only. It never generates or resolves a die result. */
export class DicePresentationController {
  private renderer: DiceRenderer | undefined;
  private initializingRenderer: DiceRenderer | undefined;
  private initialization: Promise<DiceRenderer> | undefined;
  private current: Readonly<{ id: string; completion: Promise<DicePresentationOutcome> }> | undefined;
  private disposed = false;
  private unavailableReason: DiceFallbackReason | undefined;
  private readonly disposedRenderers = new WeakSet<DiceRenderer>();

  constructor(
    private readonly container: HTMLElement,
    private readonly options: DicePresentationControllerOptions,
  ) {}

  present(request: DicePresentationRequest): DicePresentationOutcome | Promise<DicePresentationOutcome> {
    if (this.disposed || this.unavailableReason) {
      return { mode: 'fallback', reason: this.unavailableReason ?? 'unsupported' };
    }
    if ((this.options.prefersReducedMotion ?? prefersReducedMotion)()) {
      return { mode: 'fallback', reason: 'reduced-motion' };
    }
    if (this.current?.id === request.id) return this.current.completion;

    const completion = this.run(request);
    this.current = { id: request.id, completion };
    return completion;
  }

  clear(): void {
    this.current = undefined;
    try { this.renderer?.clear(); } catch { /* cleanup failure must not block fallback or navigation */ }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.current = undefined;
    this.disposeRenderer(this.renderer);
    this.disposeRenderer(this.initializingRenderer);
    this.renderer = undefined;
    this.initializingRenderer = undefined;
    this.initialization = undefined;
  }

  private async run(request: DicePresentationRequest): Promise<DicePresentationOutcome> {
    // StrictMode cleans up the first effect before this microtask, avoiding duplicate WebGL setup.
    await Promise.resolve();
    if (this.disposed) return { mode: 'fallback', reason: 'unsupported' };

    try {
      const renderer = await this.withTimeout(this.getRenderer());
      await this.withTimeout(renderer.present(request));
      if (this.disposed) return { mode: 'fallback', reason: 'unsupported' };
      return { mode: 'three' };
    } catch (error) {
      const reason = this.failureReason(error);
      this.unavailableReason = reason;
      this.disposeRenderer(this.renderer);
      this.disposeRenderer(this.initializingRenderer);
      this.renderer = undefined;
      this.initializingRenderer = undefined;
      this.initialization = undefined;
      return { mode: 'fallback', reason };
    }
  }

  private getRenderer(): Promise<DiceRenderer> {
    if (this.renderer) return Promise.resolve(this.renderer);
    if (!this.initialization) {
      this.initialization = this.options.createRenderer(this.container).then(async (renderer) => {
        this.initializingRenderer = renderer;
        try {
          if (this.disposed || this.unavailableReason) throw new Error('DICE_RENDERER_DISPOSED');
          await renderer.initialize();
          if (this.disposed || this.unavailableReason) throw new Error('DICE_RENDERER_DISPOSED');
          this.renderer = renderer;
          return renderer;
        } catch (error) {
          this.disposeRenderer(renderer);
          throw error;
        } finally {
          if (this.initializingRenderer === renderer) this.initializingRenderer = undefined;
        }
      });
    }
    return this.initialization;
  }

  private async withTimeout<T>(operation: Promise<T>): Promise<T> {
    const timeoutMs = this.options.timeoutMs ?? 4_000;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error('DICE_PRESENTATION_TIMEOUT')), timeoutMs);
    });
    try {
      return await Promise.race([operation, timeout]);
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    }
  }

  private disposeRenderer(renderer: DiceRenderer | undefined): void {
    if (!renderer || this.disposedRenderers.has(renderer)) return;
    this.disposedRenderers.add(renderer);
    try { renderer.dispose(); } catch { /* a cleanup error must still resolve to 2D fallback */ }
  }

  private failureReason(error: unknown): DiceFallbackReason {
    if (error instanceof DiceRendererError) return error.reason;
    if (error instanceof Error && error.message === 'DICE_PRESENTATION_TIMEOUT') return 'timeout';
    return this.renderer ? 'presentation' : 'initialization';
  }
}
