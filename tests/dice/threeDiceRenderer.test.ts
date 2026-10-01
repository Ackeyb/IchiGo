import { afterEach, describe, expect, it, vi } from 'vitest';
import { BoxGeometry, Group, MeshStandardMaterial, PerspectiveCamera } from 'three';
import { ThreeDiceRenderer } from '../../src/dice/three/ThreeDiceRenderer';
import { DiceRendererError } from '../../src/dice/types';

afterEach(() => vi.unstubAllGlobals());

describe('ThreeDiceRenderer lifecycle', () => {
  it.each([5, 7, 10])('uses the existing OUT trajectory for %i penalty dice without converting OUT to a face', async (count) => {
    const renderer = new ThreeDiceRenderer({} as HTMLElement);
    const group = new Group();
    const geometry = new BoxGeometry(1.28, 1.28, 1.28);
    const materials = Array.from({ length: 6 }, () => new MeshStandardMaterial());
    const outMaterials = Array.from({ length: 6 }, () => new MeshStandardMaterial());
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('performance', { now: () => 0 });
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.push(callback); return frames.length; });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    Object.assign(renderer, { initialized: true, renderer: { render: vi.fn() }, scene: {}, camera: new PerspectiveCamera(), group, geometry, materials, outMaterials });
    const completion = renderer.present({ id: `penalty/${count}`, kind: 'penalty', dice: [
      { status: 'out', value: null }, ...Array.from({ length: count - 1 }, () => ({ status: 'safe' as const, value: 5 as const })),
    ] });
    expect(group.children).toHaveLength(count);
    const outMesh = group.children[0]!;
    expect((outMesh as unknown as { material: unknown }).material).toBe(outMaterials);
    frames.shift()!(900);
    expect(outMesh.position.y).toBeLessThan(0);
    expect(group.children).toContain(outMesh);
    frames.shift()!(1050);
    await completion;
    expect(group.children).toHaveLength(count - 1);
    expect(group.children).not.toContain(outMesh);
    renderer.dispose();
  });

  it('redraws the committed scene when resizing an idle canvas', () => {
    const renderer = new ThreeDiceRenderer({ clientWidth: 320, clientHeight: 190 } as HTMLElement);
    const render = vi.fn();
    const scene = {};
    const camera = { aspect: 0, updateProjectionMatrix: vi.fn(), position: { set: vi.fn() }, lookAt: vi.fn() };
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

  it('keeps ten committed dice through resize and rejects that same presentation on active context loss', async () => {
    const renderer = new ThreeDiceRenderer({ clientWidth: 320, clientHeight: 190 } as HTMLElement);
    const group = new Group();
    const geometry = new BoxGeometry(1.28, 1.28, 1.28);
    const materials = Array.from({ length: 6 }, () => new MeshStandardMaterial());
    const outMaterials = Array.from({ length: 6 }, () => new MeshStandardMaterial());
    const setSize = vi.fn();
    const camera = { aspect: 0, updateProjectionMatrix: vi.fn(), position: { set: vi.fn() }, lookAt: vi.fn() };
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    Object.assign(renderer, {
      initialized: true,
      renderer: { render: vi.fn(), setSize },
      scene: {},
      camera,
      group,
      geometry,
      materials,
      outMaterials,
    });
    const dice = Array.from({ length: 10 }, (_, index) => ({
      status: 'safe' as const,
      value: ((index % 6) + 1) as 1 | 2 | 3 | 4 | 5 | 6,
    }));

    const completion = renderer.present({ id: 'normal/10', kind: 'normal', dice });
    expect(group.children).toHaveLength(10);
    (renderer as unknown as { resize(): void }).resize();
    expect(setSize).toHaveBeenCalledWith(320, 190, false);
    expect(camera.aspect).toBe(320 / 190);
    expect(group.children).toHaveLength(10);
    const contextLost = new Event('webglcontextlost', { cancelable: true });
    (renderer as unknown as { onContextLost: (event: Event) => void }).onContextLost(contextLost);

    await expect(completion).rejects.toEqual(expect.objectContaining<Partial<DiceRendererError>>({ reason: 'context-lost' }));
    renderer.dispose();
  });
});
