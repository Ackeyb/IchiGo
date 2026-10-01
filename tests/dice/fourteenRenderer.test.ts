import { afterEach, describe, expect, it, vi } from 'vitest';
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, PerspectiveCamera, Scene, Vector3 } from 'three';
import { ThreeDiceRenderer } from '../../src/dice/three/ThreeDiceRenderer';
import { getDisplayedTopValue } from '../../src/dice/d6Orientation';
import type { DieResult, DieValue } from '../../src/game/types';
import { mathRandomSource } from '../../src/game/randomSource';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const safe = (count: number): DieResult[] => Array.from({ length: count }, (_, i) => ({ status: 'safe', value: (i % 6 + 1) as DieValue }));
function fixture() {
  const container = { clientWidth: 244, clientHeight: 80 } as HTMLElement;
  const renderer = new ThreeDiceRenderer(container);
  const group = new Group();
  const geometry = new BoxGeometry(1.28, 1.28, 1.28);
  const materials = Array.from({ length: 6 }, () => new MeshStandardMaterial());
  const outMaterials = Array.from({ length: 6 }, () => new MeshStandardMaterial());
  const camera = new PerspectiveCamera(34, 244 / 80, 0.1, 100);
  camera.position.set(0, 7.5, 10); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
  const scene = new Scene(); scene.add(group);
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal('performance', { now: () => 0 });
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { frames.push(cb); return frames.length; });
  const cancel = vi.fn(); vi.stubGlobal('cancelAnimationFrame', cancel);
  const gpu = { render: vi.fn(), setSize: vi.fn(), dispose: vi.fn(),
    domElement: { removeEventListener: vi.fn(), remove: vi.fn() } };
  const observer = { disconnect: vi.fn() };
  Object.assign(renderer, { initialized: true, renderer: gpu, scene, camera, group, geometry, materials, outMaterials, resizeObserver: observer });
  return { renderer, group, camera, geometry, materials, outMaterials, frames, gpu, observer, cancel };
}
describe('14 committed dice renderer', () => {
  it.each([11, 12, 13, 14])('settles %i SAFE faces for both kinds without game randomness', async (count) => {
    for (const kind of ['normal', 'penalty'] as const) {
    const f = fixture();
    const random = vi.spyOn(mathRandomSource, 'next').mockImplementation(() => { throw new Error('No game random draw'); });
    const dice = safe(count);
    const saved = structuredClone(dice);
    const done = f.renderer.present({ id: kind, dice, kind });
    expect(f.group.children).toHaveLength(count);
    for (const time of Array.from({ length: 22 }, (_, i) => i * 50)) {
      f.frames.shift()!(time);
      f.group.updateMatrixWorld(true);
      for (const child of f.group.children) {
        // Include all eight corners, not only the center, in viewport verification.
        for (const x of [-0.64, 0.64]) for (const y of [-0.64, 0.64]) for (const z of [-0.64, 0.64]) {
          const p = new Vector3(x, y, z).applyMatrix4(child.matrixWorld).project(f.camera);
          expect(Math.abs(p.x)).toBeLessThan(1);
          expect(Math.abs(p.y)).toBeLessThan(1);
        }
      }
    }
    await done;
    f.group.children.forEach((mesh, i) => {
      expect(getDisplayedTopValue(mesh.quaternion)).toBe((dice[i] as { value: DieValue }).value);
      expect((mesh as Mesh).geometry).toBe(f.geometry);
      expect((mesh as Mesh).material).toBe(f.materials);
    });
    expect(dice).toEqual(saved);
    expect(random).not.toHaveBeenCalled(); random.mockRestore();
    f.renderer.dispose();
    }
  });
  it('rejects 15 before adding meshes', () => {
    const f = fixture();
    expect(() => f.renderer.present({ id: '15', kind: 'normal', dice: safe(15) })).toThrow(RangeError);
    expect(f.group.children).toHaveLength(0);
    f.renderer.dispose();
  });
  it('rejects a GPU frame failure for 14 and cleans up its meshes', async () => {
    const f = fixture();
    const done = f.renderer.present({ id: '14', kind: 'normal', dice: safe(14) });
    f.gpu.render.mockImplementation(() => { throw new Error('GPU failure'); });
    f.frames.shift()!(500);
    await expect(done).rejects.toMatchObject({ reason: 'presentation' });
    f.renderer.dispose(); expect(f.group.children).toHaveLength(0);
  });
  it.each(['mixed', 'all'] as const)('finishes %s OUT without assigning a SAFE face', async (variant) => {
    const f = fixture();
    const dice = safe(14).map((die, i): DieResult => variant === 'all' || i % 3 === 0 ? { status: 'out', value: null } : die);
    const done = f.renderer.present({ id: variant, dice, kind: 'penalty' });
    const original = [...f.group.children];
    dice.forEach((die, i) => expect((original[i] as Mesh).material).toBe(die.status === 'out' ? f.outMaterials : f.materials));
    f.frames.shift()!(700);
    expect(f.group.children).toHaveLength(14);
    f.frames.shift()!(1050); await done;
    expect(f.group.children).toHaveLength(dice.filter((d) => d.status === 'safe').length);
    f.group.children.forEach((mesh) => {
      const die = dice[mesh.userData.presentationIndex as number]!;
      expect(die.status).toBe('safe');
      if (die.status === 'safe') expect(getDisplayedTopValue(mesh.quaternion)).toBe(die.value);
    });
    f.renderer.dispose();
  });
  it('reuses resources across 5 → 14 → 7 → 10 → 14 → 5 and clears old meshes', async () => {
    const f = fixture();
    for (const count of [5, 14, 7, 10, 14, 5]) {
      const done = f.renderer.present({ id: String(count), kind: 'normal', dice: safe(count) });
      expect(f.group.children).toHaveLength(count);
      expect(f.group.children.every((m) => (m as Mesh).geometry === f.geometry)).toBe(true);
      f.frames.shift()!(1050); await done;
    }
    const geometryDispose = vi.spyOn(f.geometry, 'dispose');
    f.renderer.dispose(); f.renderer.dispose();
    expect(f.group.children).toHaveLength(0);
    expect(geometryDispose).toHaveBeenCalledOnce();
    expect(f.gpu.dispose).toHaveBeenCalledOnce();
    expect(f.observer.disconnect).toHaveBeenCalledOnce();
  });
  it('retains 14 meshes on resize and rejects active context loss through the existing path', async () => {
    const f = fixture();
    const done = f.renderer.present({ id: '14', kind: 'normal', dice: safe(14) });
    (f.renderer as unknown as { resize(): void }).resize();
    expect(f.gpu.setSize).toHaveBeenCalledWith(244, 80, false);
    expect(f.group.children).toHaveLength(14);
    (f.renderer as unknown as { onContextLost(e: Event): void }).onContextLost(new Event('webglcontextlost'));
    await expect(done).rejects.toMatchObject({ reason: 'context-lost' });
    f.renderer.dispose(); expect(f.cancel).toHaveBeenCalled();
  });
  it('frames 14 in a narrow stage, redraws on resize, and resets framing for 5', async () => {
    const f = fixture();
    f.camera.aspect = 1;
    const done = f.renderer.present({ id: '14', kind: 'normal', dice: safe(14) });
    f.frames.shift()!(1050); await done;
    expect(f.camera.position.toArray()).toEqual([0, 15, 20]);
    f.camera.updateMatrixWorld(); f.group.updateMatrixWorld(true);
    for (const mesh of f.group.children) {
      const p = mesh.position.clone().project(f.camera);
      expect(Math.abs(p.x)).toBeLessThan(0.85);
    }
    (f.renderer as unknown as { resize(): void }).resize();
    expect(f.group.children).toHaveLength(14);
    expect(f.camera.position.toArray()).toEqual([0, 7.5, 10]);
    const next = f.renderer.present({ id: '5', kind: 'normal', dice: safe(5) });
    f.frames.shift()!(1050); await next;
    expect(f.camera.position.toArray()).toEqual([0, 7.5, 10]);
    f.renderer.dispose();
  });
});
