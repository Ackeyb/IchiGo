import {
  AmbientLight,
  BoxGeometry,
  CanvasTexture,
  Color,
  DirectionalLight,
  Group,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Quaternion,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from 'three';
import type { DieValue } from '../../game/types';
import { getD6TargetQuaternion } from '../d6Orientation';
import { getOutTrajectory, isOutAnimationComplete } from '../outTrajectory';
import { toPresentedDice } from '../presentationDice';
import type { PresentedDie } from '../presentationDice';
import type { DicePresentationRequest, DiceRenderer } from '../types';
import { DiceRendererError } from '../types';

type AnimatedDie = Readonly<{
  mesh: Mesh<BoxGeometry, MeshStandardMaterial[]>;
  result: PresentedDie;
  start: Vector3;
  target: Vector3;
  targetQuaternion: Quaternion | undefined;
  spin: Vector3;
}>;

const MATERIAL_VALUES = [2, 5, 1, 6, 3, 4] as const;
const PIPS: Readonly<Record<DieValue, readonly (readonly [number, number])[]>> = {
  1: [[2, 2]],
  2: [[1, 1], [3, 3]],
  3: [[1, 1], [2, 2], [3, 3]],
  4: [[1, 1], [3, 1], [1, 3], [3, 3]],
  5: [[1, 1], [3, 1], [2, 2], [1, 3], [3, 3]],
  6: [[1, 1], [3, 1], [1, 2], [3, 2], [1, 3], [3, 3]],
};

function makeFaceTexture(value: DieValue): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  if (!context) throw new DiceRendererError('initialization', '2D texture context is unavailable');
  context.fillStyle = '#fffdf4';
  context.fillRect(0, 0, 128, 128);
  context.fillStyle = '#263c32';
  for (const [x, y] of PIPS[value]) {
    context.beginPath();
    context.arc(x * 32, y * 32, 9, 0, Math.PI * 2);
    context.fill();
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

function smoothstep(value: number): number {
  return value * value * (3 - 2 * value);
}

export class ThreeDiceRenderer implements DiceRenderer {
  private renderer: WebGLRenderer | undefined;
  private scene: Scene | undefined;
  private camera: PerspectiveCamera | undefined;
  private group: Group | undefined;
  private geometry: BoxGeometry | undefined;
  private materials: MeshStandardMaterial[] | undefined;
  private outMaterials: MeshStandardMaterial[] | undefined;
  private textures: CanvasTexture[] | undefined;
  private trayGeometry: BoxGeometry | undefined;
  private trayMaterial: MeshStandardMaterial | undefined;
  private resizeObserver: ResizeObserver | undefined;
  private frame: number | undefined;
  private activeReject: ((reason: unknown) => void) | undefined;
  private initialized = false;
  private disposed = false;
  private contextLost = false;
  private readonly onContextLost = (event: Event) => {
    event.preventDefault();
    this.contextLost = true;
    const reject = this.activeReject;
    this.activeReject = undefined;
    reject?.(new DiceRendererError('context-lost', 'WebGL context was lost'));
  };

  constructor(private readonly container: HTMLElement) {}

  async initialize(): Promise<void> {
    if (this.initialized) return;
    if (this.disposed) throw new DiceRendererError('initialization', 'Renderer was disposed');
    try {
      const renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
      this.renderer = renderer;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
      renderer.shadowMap.enabled = false;
      renderer.outputColorSpace = SRGBColorSpace;
      renderer.domElement.className = 'three-dice-canvas';
      renderer.domElement.setAttribute('aria-hidden', 'true');
      renderer.domElement.addEventListener('webglcontextlost', this.onContextLost, false);
      this.container.replaceChildren(renderer.domElement);

      const scene = new Scene();
      this.scene = scene;
      scene.background = new Color('#244536');
      const camera = new PerspectiveCamera(34, 1, 0.1, 100);
      this.camera = camera;
      camera.position.set(0, 7.5, 10);
      camera.lookAt(0, 0, 0);
      const group = new Group();
      this.group = group;
      scene.add(group, new AmbientLight(0xffffff, 1.5));
      const light = new DirectionalLight(0xfff4d8, 2.2);
      light.position.set(-4, 8, 5);
      scene.add(light);

      const trayGeometry = new BoxGeometry(13, 0.38, 7);
      const trayMaterial = new MeshStandardMaterial({ color: '#315b48', roughness: 0.92, metalness: 0 });
      this.trayGeometry = trayGeometry;
      this.trayMaterial = trayMaterial;
      const tray = new Mesh(trayGeometry, trayMaterial);
      tray.position.y = -0.83;
      scene.add(tray);

      const geometry = new BoxGeometry(1.28, 1.28, 1.28, 2, 2, 2);
      this.geometry = geometry;
      const textures: CanvasTexture[] = [];
      this.textures = textures;
      for (const value of MATERIAL_VALUES) textures.push(makeFaceTexture(value));
      const materials = textures.map((map) => new MeshStandardMaterial({ map, roughness: 0.68, metalness: 0 }));
      const outMaterials = MATERIAL_VALUES.map(() => new MeshStandardMaterial({ color: '#b44b2a', roughness: 0.76, metalness: 0 }));

      this.materials = materials;
      this.outMaterials = outMaterials;
      this.resize();
      if (typeof ResizeObserver === 'function') {
        this.resizeObserver = new ResizeObserver(() => this.resize());
        this.resizeObserver.observe(this.container);
      }
      renderer.render(scene, camera);
      this.initialized = true;
    } catch (error) {
      this.dispose();
      if (error instanceof DiceRendererError) throw error;
      throw new DiceRendererError('initialization', error instanceof Error ? error.message : 'WebGL initialization failed');
    }
  }

  present(request: DicePresentationRequest): Promise<void> {
    if (this.contextLost) {
      return Promise.reject(new DiceRendererError('context-lost', 'WebGL context was lost'));
    }
    if (!this.initialized || !this.renderer || !this.scene || !this.camera || !this.group || !this.geometry || !this.materials) {
      return Promise.reject(new DiceRendererError('presentation', 'Renderer is not initialized'));
    }
    this.clear();
    const shown = toPresentedDice(request.dice, request.kind);
    const animated = shown.map((result) => this.createAnimatedDie(result, shown.length));
    const renderer = this.renderer;
    const scene = this.scene;
    const camera = this.camera;
    const duration = 1_050;

    return new Promise<void>((resolve, reject) => {
      this.activeReject = reject;
      const started = performance.now();
      const draw = (time: number) => {
        try {
          const progress = Math.min(1, (time - started) / duration);
          this.updateDice(animated, progress);
          renderer.render(scene, camera);
          if (progress < 1) {
            this.frame = requestAnimationFrame(draw);
            return;
          }
          for (const die of animated) {
            if (die.result.status === 'out' && isOutAnimationComplete(progress)) this.group?.remove(die.mesh);
          }
          renderer.render(scene, camera);
          this.frame = undefined;
          this.activeReject = undefined;
          resolve();
        } catch (error) {
          this.frame = undefined;
          this.activeReject = undefined;
          reject(new DiceRendererError('presentation', error instanceof Error ? error.message : 'Animation failed'));
        }
      };
      this.frame = requestAnimationFrame(draw);
    });
  }

  clear(): void {
    if (this.frame !== undefined) cancelAnimationFrame(this.frame);
    this.frame = undefined;
    const reject = this.activeReject;
    this.activeReject = undefined;
    reject?.(new DiceRendererError('presentation', 'Dice presentation was cancelled'));
    this.group?.clear();
    if (this.renderer && this.scene && this.camera) {
      try { this.renderer.render(this.scene, this.camera); } catch { /* teardown still releases resources */ }
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    // A failed driver/resource cleanup must not skip the remaining releases.
    const release = (cleanup: () => void) => { try { cleanup(); } catch { /* best-effort teardown */ } };
    release(() => this.clear());
    release(() => this.resizeObserver?.disconnect());
    this.resizeObserver = undefined;
    if (this.renderer) {
      const renderer = this.renderer;
      release(() => renderer.domElement.removeEventListener('webglcontextlost', this.onContextLost, false));
      release(() => renderer.dispose());
      release(() => renderer.domElement.remove());
    }
    release(() => this.geometry?.dispose());
    this.materials?.forEach((material) => release(() => material.dispose()));
    this.outMaterials?.forEach((material) => release(() => material.dispose()));
    this.textures?.forEach((texture) => release(() => texture.dispose()));
    release(() => this.trayGeometry?.dispose());
    release(() => this.trayMaterial?.dispose());
    this.geometry = undefined;
    this.materials = undefined;
    this.outMaterials = undefined;
    this.textures = undefined;
    this.trayGeometry = undefined;
    this.trayMaterial = undefined;
    this.renderer = undefined;
    this.scene = undefined;
    this.camera = undefined;
    this.group = undefined;
    this.initialized = false;
  }

  private createAnimatedDie(result: PresentedDie, count: number): AnimatedDie {
    const mesh = new Mesh(this.geometry!, result.status === 'out' ? this.outMaterials! : this.materials!);
    mesh.userData.presentationIndex = result.index;
    const column = result.index - (count - 1) / 2;
    const firstRowCount = count > 4 ? Math.ceil(count / 2) : count;
    const secondRow = result.index >= firstRowCount;
    const rowCount = secondRow ? count - firstRowCount : firstRowCount;
    const rowIndex = secondRow ? result.index - firstRowCount : result.index;
    const localColumn = rowIndex - (rowCount - 1) / 2;
    const target = result.status === 'out'
      ? new Vector3(result.index % 2 ? 9 : -9, 2.5 + result.index * 0.18, -1)
      : new Vector3(localColumn * 1.6, 0, count > 4 ? (secondRow ? 0.65 : -0.9) : -0.2);
    const start = new Vector3(column * 0.82 + Math.sin(result.index * 1.7) * 0.45, 5.8 + (result.index % 3) * 0.55, -6.2);
    mesh.position.copy(start);
    mesh.rotation.set(result.index * 0.7, result.index * 0.4, result.index * 0.9);
    this.group!.add(mesh);
    return {
      mesh,
      result,
      start,
      target,
      targetQuaternion: result.status === 'safe' ? getD6TargetQuaternion(result.value, result.index * 0.61) : undefined,
      spin: new Vector3(11 + result.index * 1.3, 13 + result.index * 0.9, 9.5 + result.index * 0.7),
    };
  }

  private updateDice(dice: readonly AnimatedDie[], progress: number): void {
    const travel = smoothstep(Math.min(1, progress / 0.82));
    for (const die of dice) {
      if (die.result.status === 'safe') {
        die.mesh.position.lerpVectors(die.start, die.target, travel);
        const direction = die.result.index % 2 === 0 ? -1 : 1;
        die.mesh.position.x += Math.sin(travel * Math.PI) * direction * (0.5 + (die.result.index % 3) * 0.12);
        die.mesh.position.z += Math.sin(travel * Math.PI * 2) * direction * 0.28;
        die.mesh.position.y += Math.abs(Math.sin(travel * Math.PI * 4)) * (1 - travel) * 1.05;
        if (progress < 0.76) {
          die.mesh.rotation.set(die.spin.x * progress, die.spin.y * progress, die.spin.z * progress);
        } else {
          die.mesh.quaternion.slerp(die.targetQuaternion!, smoothstep((progress - 0.76) / 0.24));
        }
        if (progress === 1) die.mesh.quaternion.copy(die.targetQuaternion!);
      } else {
        const position = getOutTrajectory(die.start, die.result.index, progress);
        die.mesh.position.set(position.x, position.y, position.z);
        die.mesh.rotation.set(die.spin.x * progress * 1.25, die.spin.y * progress * 1.4, die.spin.z * progress * 1.2);
      }
    }
  }

  private resize(): void {
    if (!this.renderer || !this.camera) return;
    const width = Math.max(1, this.container.clientWidth || 640);
    const height = Math.max(1, this.container.clientHeight || 250);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    // setSize clears the drawing buffer; idle scenes have no RAF to repaint it.
    if (this.scene) this.renderer.render(this.scene, this.camera);
  }
}

export async function createThreeDiceRenderer(container: HTMLElement): Promise<DiceRenderer> {
  return new ThreeDiceRenderer(container);
}
