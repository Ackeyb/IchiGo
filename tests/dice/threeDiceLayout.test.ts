import { describe, expect, it } from 'vitest';
import { getDiceSettlePositions } from '../../src/dice/three/diceLayout';

describe('Three.js dice settle layout', () => {
  it.each([11, 12, 13, 14])('fits %i positions inside the existing tray without duplicate centers', (count) => {
    const positions = getDiceSettlePositions(count);
    expect(positions).toHaveLength(count);
    expect(new Set(positions.map(({ x, z }) => `${x}/${z}`)).size).toBe(count);
    expect(positions.every(({ x, z }) => Number.isFinite(x) && Number.isFinite(z)
      && Math.abs(x) + 1.28 / Math.sqrt(2) < 6.5 && Math.abs(z) + 1.28 / Math.sqrt(2) < 3.5)).toBe(true);
    for (let i = 0; i < count; i++) for (let j = i + 1; j < count; j++) {
      expect(Math.hypot(positions[i]!.x - positions[j]!.x, positions[i]!.z - positions[j]!.z)).toBeGreaterThanOrEqual(1.69);
    }
  });
  it.each([15, -1, 1.5, NaN, Infinity])('rejects unsupported count %s', (count) => {
    expect(() => getDiceSettlePositions(count)).toThrow(RangeError);
  });
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
