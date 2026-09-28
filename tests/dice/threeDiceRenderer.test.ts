import { describe, expect, it, vi } from 'vitest';
import { ThreeDiceRenderer } from '../../src/dice/three/ThreeDiceRenderer';
import { DiceRendererError } from '../../src/dice/types';

describe('ThreeDiceRenderer lifecycle', () => {
  it('redraws the committed scene when resizing an idle canvas', () => {
    const renderer = new ThreeDiceRenderer({ clientWidth: 320, clientHeight: 190 } as HTMLElement);
    const render = vi.fn();
    const scene = {};
    const camera = { aspect: 0, updateProjectionMatrix: vi.fn() };
    Object.assign(renderer, { renderer: { setSize: vi.fn(), render }, scene, camera });
    (renderer as unknown as { resize(): void }).resize();
    expect(camera.aspect).toBe(320 / 190);
    expect(render).toHaveBeenCalledWith(scene, camera);
  });

  it('continues releasing every resource when renderer disposal throws', () => {
    const renderer = new ThreeDiceRenderer({} as HTMLElement);
    const resource = () => ({ dispose: vi.fn() });
    const geometry = resource();
    const material = resource();
    const texture = resource();
    const remove = vi.fn();
    const dispose = vi.fn(() => { throw new Error('GPU cleanup failure'); });
    Object.assign(renderer, { geometry, materials: [material], textures: [texture],
      renderer: { dispose, domElement: { removeEventListener: vi.fn(), remove } },
    });
    expect(() => renderer.dispose()).not.toThrow();
    expect(remove).toHaveBeenCalledOnce();
    expect(geometry.dispose).toHaveBeenCalledOnce();
    expect(material.dispose).toHaveBeenCalledOnce();
    expect(texture.dispose).toHaveBeenCalledOnce();
    renderer.dispose();
    expect(dispose).toHaveBeenCalledOnce();
  });

  it('rejects the next presentation after context loss while idle', async () => {
    const renderer = new ThreeDiceRenderer({} as HTMLElement);
    const contextLost = new Event('webglcontextlost', { cancelable: true });
    const internals = renderer as unknown as { onContextLost: (event: Event) => void };

    internals.onContextLost(contextLost);

    await expect(renderer.present({
      id: 'normal/1',
      kind: 'normal',
      dice: [{ status: 'safe', value: 1 }],
    })).rejects.toEqual(expect.objectContaining<Partial<DiceRendererError>>({ reason: 'context-lost' }));
    expect(contextLost.defaultPrevented).toBe(true);
  });
});
