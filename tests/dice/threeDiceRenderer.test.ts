import { describe, expect, it } from 'vitest';
import { ThreeDiceRenderer } from '../../src/dice/three/ThreeDiceRenderer';
import { DiceRendererError } from '../../src/dice/types';

describe('ThreeDiceRenderer lifecycle', () => {
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
