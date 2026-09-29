import { describe, expect, it } from 'vitest';
import { getDiceSettlePositions } from '../../src/dice/three/diceLayout';

describe('Three.js dice settle layout', () => {
  it.each([5, 6, 7, 8, 9, 10])('places %i dice without overlap or a seven-die ceiling', (count) => {
    const positions = getDiceSettlePositions(count);
    expect(positions).toHaveLength(count);
    expect(new Set(positions.map(({ z }) => z)).size).toBe(count > 5 ? 2 : 1);
    expect(positions.every(({ x }) => Math.abs(x) <= 3.2)).toBe(true);

    for (let left = 0; left < positions.length; left++) {
      for (let right = left + 1; right < positions.length; right++) {
        const x = positions[left]!.x - positions[right]!.x;
        const z = positions[left]!.z - positions[right]!.z;
        expect(Math.hypot(x, z)).toBeGreaterThanOrEqual(1.6);
      }
    }
  });

  it('keeps five dice in one readable row and ten dice in two rows of five', () => {
    expect(getDiceSettlePositions(5).map(({ x }) => x)).toEqual([-3.2, -1.6, 0, 1.6, 3.2]);
    const ten = getDiceSettlePositions(10);
    expect(ten.slice(0, 5).map(({ x }) => x)).toEqual([-3.2, -1.6, 0, 1.6, 3.2]);
    expect(ten.slice(5).map(({ x }) => x)).toEqual([-3.2, -1.6, 0, 1.6, 3.2]);
  });
});
