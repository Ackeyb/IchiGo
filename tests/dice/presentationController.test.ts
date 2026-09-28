import { afterEach, describe, expect, it, vi } from 'vitest';
import { DicePresentationController } from '../../src/dice/presentationController';
import type { DicePresentationRequest, DiceRenderer } from '../../src/dice/types';
import { DiceRendererError } from '../../src/dice/types';

const request: DicePresentationRequest = {
  id: 'normal/4',
  kind: 'normal',
  dice: [{ status: 'safe', value: 3 }, { status: 'out', value: null }],
};

function fakeRenderer(overrides: Partial<DiceRenderer> = {}): DiceRenderer {
  return {
    initialize: vi.fn(async () => undefined),
    present: vi.fn(async () => undefined),
    clear: vi.fn(),
    dispose: vi.fn(),
    ...overrides,
  };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

const container = {} as HTMLElement;

afterEach(() => {
  vi.useRealTimers();
});

describe('DicePresentationController', () => {
  it('uses an immediate 2D fallback for reduced motion without initializing WebGL', () => {
    const factory = vi.fn(async () => fakeRenderer());
    const controller = new DicePresentationController(container, { createRenderer: factory, prefersReducedMotion: () => true });
    expect(controller.present(request)).toEqual({ mode: 'fallback', reason: 'reduced-motion' });
    expect(factory).not.toHaveBeenCalled();
  });

  it('falls back when dynamic import or renderer initialization fails', async () => {
    const importFailure = new DicePresentationController(container, {
      createRenderer: async () => { throw new Error('import failed'); },
      prefersReducedMotion: () => false,
    });
    await expect(importFailure.present(request)).resolves.toEqual({ mode: 'fallback', reason: 'initialization' });

    const renderer = fakeRenderer({ initialize: vi.fn(async () => { throw new DiceRendererError('initialization', 'no WebGL'); }) });
    const initializeFailure = new DicePresentationController(container, {
      createRenderer: async () => renderer,
      prefersReducedMotion: () => false,
    });
    await expect(initializeFailure.present(request)).resolves.toEqual({ mode: 'fallback', reason: 'initialization' });
    expect(renderer.dispose).toHaveBeenCalledOnce();
  });

  it.each([
    ['presentation', new Error('render failed')],
    ['context-lost', new DiceRendererError('context-lost', 'lost')],
  ] as const)('falls back for %s failure using the same committed request', async (reason, failure) => {
    const renderer = fakeRenderer({ present: vi.fn(async (received) => {
      expect(received).toBe(request);
      throw failure;
    }) });
    const controller = new DicePresentationController(container, {
      createRenderer: async () => renderer,
      prefersReducedMotion: () => false,
    });
    await expect(controller.present(request)).resolves.toEqual({ mode: 'fallback', reason });
    expect(renderer.present).toHaveBeenCalledOnce();
    expect(renderer.dispose).toHaveBeenCalledOnce();
  });

  it('still resolves fallback when renderer cleanup throws after a presentation failure', async () => {
    const renderer = fakeRenderer({
      present: vi.fn(async () => { throw new Error('render failed'); }),
      dispose: vi.fn(() => { throw new Error('dispose failed'); }),
    });
    const controller = new DicePresentationController(container, {
      createRenderer: async () => renderer,
      prefersReducedMotion: () => false,
    });

    await expect(controller.present(request)).resolves.toEqual({ mode: 'fallback', reason: 'presentation' });
    expect(renderer.dispose).toHaveBeenCalledOnce();
  });

  it('times out, disposes the renderer and falls back without requesting another result', async () => {
    vi.useFakeTimers();
    const renderer = fakeRenderer({ present: vi.fn(() => new Promise<void>(() => undefined)) });
    const controller = new DicePresentationController(container, {
      createRenderer: async () => renderer,
      prefersReducedMotion: () => false,
      timeoutMs: 25,
    });
    const completion = controller.present(request);
    await vi.runAllTimersAsync();
    await expect(completion).resolves.toEqual({ mode: 'fallback', reason: 'timeout' });
    expect(renderer.present).toHaveBeenCalledOnce();
    expect(renderer.dispose).toHaveBeenCalledOnce();
  });

  it('times out renderer initialization instead of leaving the UI permanently busy', async () => {
    vi.useFakeTimers();
    const renderer = fakeRenderer({ initialize: vi.fn(() => new Promise<void>(() => undefined)) });
    const controller = new DicePresentationController(container, {
      createRenderer: async () => renderer,
      prefersReducedMotion: () => false,
      timeoutMs: 25,
    });

    const completion = controller.present(request);
    await Promise.resolve();
    await Promise.resolve();
    await vi.runAllTimersAsync();

    await expect(completion).resolves.toEqual({ mode: 'fallback', reason: 'timeout' });
    expect(renderer.present).not.toHaveBeenCalled();
    expect(renderer.dispose).toHaveBeenCalledOnce();
  });

  it('does not resurrect or present a renderer disposed during initialization', async () => {
    const initialization = deferred();
    const renderer = fakeRenderer({ initialize: vi.fn(() => initialization.promise) });
    const controller = new DicePresentationController(container, {
      createRenderer: async () => renderer,
      prefersReducedMotion: () => false,
    });

    const completion = controller.present(request);
    await vi.waitFor(() => expect(renderer.initialize).toHaveBeenCalledOnce());
    controller.dispose();
    initialization.resolve();
    await completion;

    expect(renderer.present).not.toHaveBeenCalled();
    expect(renderer.dispose).toHaveBeenCalledOnce();
  });

  it('deduplicates the same presentation and reuses one initialized renderer', async () => {
    const renderer = fakeRenderer();
    const factory = vi.fn(async () => renderer);
    const controller = new DicePresentationController(container, { createRenderer: factory, prefersReducedMotion: () => false });
    const first = controller.present(request);
    const duplicate = controller.present(request);
    expect(duplicate).toBe(first);
    await first;
    await controller.present({ ...request, id: 'normal/5' });
    expect(factory).toHaveBeenCalledOnce();
    expect(renderer.initialize).toHaveBeenCalledOnce();
    expect(renderer.present).toHaveBeenCalledTimes(2);
  });

  it('clears and disposes resources idempotently', async () => {
    const renderer = fakeRenderer();
    const controller = new DicePresentationController(container, { createRenderer: async () => renderer, prefersReducedMotion: () => false });
    await controller.present(request);
    controller.clear();
    controller.dispose();
    controller.dispose();
    expect(renderer.clear).toHaveBeenCalledOnce();
    expect(renderer.dispose).toHaveBeenCalledOnce();
  });
});
